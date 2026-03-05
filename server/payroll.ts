const TZ = "America/Costa_Rica";

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function diffMinutes(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}

export interface HrConfig {
  overtimeDailyThresholdHours: string | number;
  overtimeMultiplier: string | number;
  latenessGraceMinutes: number;
  serviceChargeRate: string | number;
  paidStartPolicy?: string;
  overtimeRequiresApproval?: boolean;
  ignoreZeroDurationPunches?: boolean;
  mergeOverlappingPunches?: boolean;
  breakDeductEnabled?: boolean;
  breakThresholdMinutes?: number;
  breakDeductMinutes?: number;
  socialChargesEnabled?: boolean;
  ccssEmployeeRate?: string | number;
  ccssEmployerRate?: string | number;
  ccssIncludeService?: boolean;
}

export interface PunchRecord {
  id: number;
  employeeId: number;
  businessDate: string;
  clockInAt: Date | string;
  clockOutAt: Date | string | null;
  clockOutType: string | null;
  scheduledStartAt: Date | string | null;
  scheduledEndAt: Date | string | null;
  lateMinutes: number;
  workedMinutes: number;
  overtimeMinutesDaily: number;
}

export interface ScheduleDay {
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  isDayOff: boolean;
  employeeId: number;
  weekStartDate: string;
}

export interface NormalizedInterval {
  start: Date;
  end: Date;
  clockOutType: string;
}

export interface NormalizePunchesResult {
  intervals: NormalizedInterval[];
  flags: string[];
}

export function normalizePunches(
  punches: PunchRecord[],
  hrConfig: HrConfig
): NormalizePunchesResult {
  const ignoreZero = hrConfig.ignoreZeroDurationPunches !== false;
  const mergeOverlaps = hrConfig.mergeOverlappingPunches !== false;
  const flags: string[] = [];

  let intervals: NormalizedInterval[] = [];
  for (const p of punches) {
    const start = toDate(p.clockInAt);
    const end = toDate(p.clockOutAt);
    if (!start) continue;
    if (!end) {
      intervals.push({ start, end: start, clockOutType: p.clockOutType || "OPEN" });
      continue;
    }
    if (ignoreZero && start.getTime() === end.getTime()) {
      flags.push("PUNCH_FILTRADO_CERO", "PUNCH_BASURA_FILTRADO");
      continue;
    }
    if (end.getTime() < start.getTime()) {
      flags.push("PUNCH_FILTRADO_CORRUPTO", "PUNCH_BASURA_FILTRADO");
      continue;
    }
    intervals.push({ start, end, clockOutType: p.clockOutType || "MANUAL" });
  }

  intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

  if (mergeOverlaps && intervals.length > 1) {
    const merged: NormalizedInterval[] = [intervals[0]];
    for (let i = 1; i < intervals.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = intervals[i];
      const gapMs = curr.start.getTime() - prev.end.getTime();

      if (gapMs <= 0) {
        if (curr.end.getTime() > prev.end.getTime()) {
          prev.end = curr.end;
          prev.clockOutType = curr.clockOutType;
        }
        flags.push("PUNCH_FUSIONADO_OVERLAP", "PUNCH_BASURA_FILTRADO");
      } else if (gapMs <= 60000) {
        prev.end = curr.end;
        prev.clockOutType = curr.clockOutType;
        flags.push("PUNCH_FUSIONADO_ADYACENTE", "PUNCH_BASURA_FILTRADO");
      } else {
        merged.push(curr);
      }
    }
    intervals = merged;
  }

  return { intervals, flags };
}

export interface DailyPayrollResult {
  normalMinutesRaw: number;
  normalMinutesPaid: number;
  overtimeCalculatedMinutes: number;
  overtimePaidMinutes: number;
  unpaidBreakMinutes: number;
  paidWorkedMinutes: number;
  workedMinutesForService: number;
  tardyMinutes: number;
  normalPay: number;
  overtimePay: number;
  basePay: number;
  hourlyRate: number;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  flags: string[];
  late: boolean;
  noShow: boolean;
  autoCheckout: boolean;
  midnightShift: boolean;
  hasMultiplePunches: boolean;
  workedMinutes: number;
  normalMinutes: number;
  overtimeMinutes: number;
  baseTotalPayDay: number;
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function parseDateInTZ(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr}:00-06:00`);
}

function getScheduleTimesForDate(
  dateStr: string,
  schedule: ScheduleDay | null
): { scheduledStart: Date | null; scheduledEnd: Date | null } {
  if (!schedule || schedule.isDayOff || !schedule.startTime || !schedule.endTime) {
    return { scheduledStart: null, scheduledEnd: null };
  }
  const scheduledStart = parseDateInTZ(dateStr, schedule.startTime);
  let scheduledEnd = parseDateInTZ(dateStr, schedule.endTime);
  if (scheduledEnd <= scheduledStart) {
    scheduledEnd.setDate(scheduledEnd.getDate() + 1);
  }
  return { scheduledStart, scheduledEnd };
}

function formatTimeStr(d: Date | null): string | null {
  if (!d) return null;
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function computeDailyPayroll(args: {
  punchesForDay: PunchRecord[];
  scheduleForDay: ScheduleDay | null;
  dailyRate: number;
  hrConfig: HrConfig;
  dateStr: string;
}): DailyPayrollResult {
  const { punchesForDay, scheduleForDay, dailyRate, hrConfig, dateStr } = args;
  const jornadaHoras = Number(hrConfig.overtimeDailyThresholdHours) || 8;
  const multiplier = Number(hrConfig.overtimeMultiplier) || 1.5;
  const graceMinutes = hrConfig.latenessGraceMinutes || 0;
  const hourlyRate = dailyRate / jornadaHoras;
  const paidStartPolicy = hrConfig.paidStartPolicy || "SCHEDULE_START_CAP";
  const overtimeRequiresApproval = hrConfig.overtimeRequiresApproval !== false;
  const breakDeductEnabled = hrConfig.breakDeductEnabled !== false;
  const breakThresholdMin = hrConfig.breakThresholdMinutes ?? 540;
  const breakDeductMin = hrConfig.breakDeductMinutes ?? 60;

  const hasSchedule = scheduleForDay && !scheduleForDay.isDayOff && scheduleForDay.startTime && scheduleForDay.endTime;
  const isDayOff = scheduleForDay?.isDayOff === true;

  const { scheduledStart, scheduledEnd } = getScheduleTimesForDate(dateStr, scheduleForDay || null);

  const schedStartStr = scheduledStart ? formatTimeStr(scheduledStart) : null;
  const schedEndStr = scheduledEnd ? formatTimeStr(scheduledEnd) : null;

  const emptyResult = (extraFlags: string[] = [], noShow = false): DailyPayrollResult => ({
    normalMinutesRaw: 0, normalMinutesPaid: 0,
    overtimeCalculatedMinutes: 0, overtimePaidMinutes: 0,
    unpaidBreakMinutes: 0, paidWorkedMinutes: 0, workedMinutesForService: 0, tardyMinutes: 0,
    normalPay: 0, overtimePay: 0, basePay: 0, hourlyRate,
    scheduledStartTime: schedStartStr, scheduledEndTime: schedEndStr,
    flags: noShow ? [...extraFlags, "NO_SHOW"] : extraFlags,
    late: false, noShow, autoCheckout: false, midnightShift: false, hasMultiplePunches: false,
    workedMinutes: 0, normalMinutes: 0, overtimeMinutes: 0, baseTotalPayDay: 0,
  });

  const { intervals, flags: normalizeFlags } = normalizePunches(punchesForDay, hrConfig);
  const rawPunchCount = punchesForDay.length;

  if (intervals.length === 0) {
    return emptyResult(normalizeFlags, !!hasSchedule);
  }

  const flags: string[] = [...normalizeFlags];
  if (rawPunchCount > 1) {
    flags.push("PUNCHES_MULTIPLES");
  }

  const firstClockIn = intervals[0].start;
  const lastInterval = intervals[intervals.length - 1];
  let lastClockOut = lastInterval.end;
  let lastClockOutType = lastInterval.clockOutType;
  const hasMultiplePunches = intervals.length > 1;
  let autoCheckout = false;

  const isCase1 = !hasSchedule || isDayOff;

  if (isCase1) {
    if (isDayOff) flags.push("DIA_LIBRE");
    flags.push("SIN_HORARIO");

    const paidStart = firstClockIn;
    let ordinaryEnd: Date;

    if (lastClockOutType === "OPEN" || lastClockOut.getTime() === firstClockIn.getTime()) {
      ordinaryEnd = new Date(firstClockIn.getTime() + jornadaHoras * 3600000);
      flags.push("AUTO_NO_SCHEDULE");
      lastClockOutType = "AUTO_NO_SCHEDULE";
      autoCheckout = true;
    } else {
      ordinaryEnd = lastClockOut;
      autoCheckout = lastClockOutType === "AUTO" || lastClockOutType === "AUTO_NO_SCHEDULE" || lastClockOutType === "GEO_AUTO";
    }

    const normalMinutesRaw = Math.max(0, diffMinutes(paidStart, ordinaryEnd));
    const overtimeCalculatedMinutes = 0;
    const overtimePaidMinutes = 0;
    const unpaidBreakMinutes = 0;
    const normalMinutesPaid = normalMinutesRaw;
    const paidWorkedMinutes = normalMinutesPaid;

    const normalPay = round2((normalMinutesPaid / 60) * hourlyRate);
    const overtimePay = 0;
    const basePay = normalPay;

    if (autoCheckout && !flags.includes("AUTO_OUT") && !flags.includes("AUTO_NO_SCHEDULE")) {
      flags.push("AUTO_OUT");
    }

    return {
      normalMinutesRaw, normalMinutesPaid,
      overtimeCalculatedMinutes, overtimePaidMinutes,
      unpaidBreakMinutes, paidWorkedMinutes, workedMinutesForService: paidWorkedMinutes, tardyMinutes: 0,
      normalPay, overtimePay, basePay, hourlyRate,
      scheduledStartTime: schedStartStr, scheduledEndTime: schedEndStr,
      flags,
      late: false, noShow: false, autoCheckout, midnightShift: false, hasMultiplePunches,
      workedMinutes: normalMinutesRaw, normalMinutes: normalMinutesPaid, overtimeMinutes: 0, baseTotalPayDay: basePay,
    };
  }

  let paidStart: Date;
  if (paidStartPolicy === "SCHEDULE_START_CAP" && scheduledStart) {
    paidStart = firstClockIn.getTime() > scheduledStart.getTime() ? firstClockIn : scheduledStart;
  } else {
    paidStart = firstClockIn;
  }

  if (lastClockOutType === "OPEN" || (lastClockOut.getTime() === lastInterval.start.getTime() && lastInterval.start.getTime() === lastInterval.end.getTime())) {
    if (scheduledEnd) {
      lastClockOut = scheduledEnd;
      flags.push("AUTO_OUT");
      lastClockOutType = "AUTO";
      autoCheckout = true;
    } else {
      lastClockOut = new Date(firstClockIn.getTime() + jornadaHoras * 3600000);
      flags.push("AUTO_NO_SCHEDULE");
      lastClockOutType = "AUTO_NO_SCHEDULE";
      autoCheckout = true;
    }
  } else {
    autoCheckout = lastClockOutType === "AUTO" || lastClockOutType === "AUTO_NO_SCHEDULE" || lastClockOutType === "GEO_AUTO";
    if (autoCheckout) flags.push("AUTO_OUT");
  }

  const ordinaryEnd = new Date(paidStart.getTime() + jornadaHoras * 3600000);

  const normalMinutesRaw = Math.max(0, diffMinutes(paidStart,
    lastClockOut.getTime() < ordinaryEnd.getTime() ? lastClockOut : ordinaryEnd
  ));

  let overtimeCalculatedMinutes = 0;
  const isManualOut = lastClockOutType === "MANUAL";
  if (isManualOut && lastClockOut.getTime() > ordinaryEnd.getTime()) {
    overtimeCalculatedMinutes = diffMinutes(ordinaryEnd, lastClockOut);
  }

  let overtimePaidMinutes = overtimeCalculatedMinutes;
  if (overtimeRequiresApproval && overtimeCalculatedMinutes > 0) {
    overtimePaidMinutes = 0;
    flags.push("OVERTIME_PENDIENTE_APROBACION");
  }

  let unpaidBreakMinutes = 0;
  let normalMinutesPaid = normalMinutesRaw;
  let overtimePaidAfterBreak = overtimePaidMinutes;

  if (breakDeductEnabled) {
    const totalEffectiveMinutes = normalMinutesRaw + overtimeCalculatedMinutes;
    if (totalEffectiveMinutes >= breakThresholdMin) {
      unpaidBreakMinutes = breakDeductMin;
      const deductFromOvertime = Math.min(unpaidBreakMinutes, overtimePaidAfterBreak);
      overtimePaidAfterBreak = Math.max(0, overtimePaidAfterBreak - deductFromOvertime);
      const remaining = unpaidBreakMinutes - deductFromOvertime;
      normalMinutesPaid = Math.max(0, normalMinutesRaw - remaining);
    }
  }

  overtimePaidMinutes = overtimePaidAfterBreak;

  let tardyMinutes = 0;
  let late = false;
  if (scheduledStart && firstClockIn.getTime() > scheduledStart.getTime()) {
    const diff = diffMinutes(scheduledStart, firstClockIn);
    if (diff > graceMinutes) {
      tardyMinutes = diff;
      late = true;
      flags.push("TARDE");
    }
  }

  const workedMinutesForService = normalMinutesPaid + overtimeCalculatedMinutes;
  const paidWorkedMinutes = normalMinutesPaid + overtimePaidMinutes;

  const midnightShift = scheduledStart && scheduledEnd
    ? scheduledEnd.getDate() !== scheduledStart.getDate()
    : false;

  const normalPay = round2((normalMinutesPaid / 60) * hourlyRate);
  const overtimePay = round2((overtimePaidMinutes / 60) * hourlyRate * multiplier);
  const basePay = round2(normalPay + overtimePay);

  return {
    normalMinutesRaw, normalMinutesPaid,
    overtimeCalculatedMinutes, overtimePaidMinutes,
    unpaidBreakMinutes, paidWorkedMinutes,
    workedMinutesForService,
    tardyMinutes,
    normalPay, overtimePay, basePay, hourlyRate,
    scheduledStartTime: schedStartStr, scheduledEndTime: schedEndStr,
    flags,
    late, noShow: false, autoCheckout, midnightShift, hasMultiplePunches,
    workedMinutes: normalMinutesRaw + overtimeCalculatedMinutes,
    normalMinutes: normalMinutesPaid,
    overtimeMinutes: overtimePaidMinutes,
    baseTotalPayDay: basePay,
  };
}

export function computeServiceForDay(args: {
  servicePool: number;
  eligibleWaiters: { employeeId: number; paidWorkedMinutes: number }[];
}): Record<number, number> {
  const { servicePool, eligibleWaiters } = args;
  const result: Record<number, number> = {};

  if (servicePool <= 0 || eligibleWaiters.length === 0) return result;

  const totalWorked = eligibleWaiters.reduce((s, w) => s + w.paidWorkedMinutes, 0);
  if (totalWorked <= 0) return result;

  for (const w of eligibleWaiters) {
    const weight = w.paidWorkedMinutes / totalWorked;
    result[w.employeeId] = round2(servicePool * weight);
  }
  return result;
}

export function computeServiceForRange(args: {
  servicePoolMap: Record<string, number>;
  employees: { id: number; displayName: string; role: string; dailyRate: string | number | null }[];
  punchesMap: Record<string, PunchRecord[]>;
  schedulesMap: Record<string, ScheduleDay>;
  hrConfig: HrConfig;
  serviceFrom: string;
  serviceTo: string;
  serviceLedgerByEmployee?: Record<string, Record<number, number>>;
}): { result: Record<number, number>; serviceUnassignedTotal: number; allocationModeByDate: Record<string, "HOURS_PRORATED" | "LEDGER_DIRECT" | "UNASSIGNED"> } {
  const { employees, punchesMap, schedulesMap, hrConfig, serviceFrom, serviceTo, serviceLedgerByEmployee } = args;
  const employeeRate = Number(hrConfig.serviceChargeRate) || 0;
  const dates = getDateRange(serviceFrom, serviceTo);
  const result: Record<number, number> = {};
  let serviceUnassignedTotal = 0;
  const allocationModeByDate: Record<string, "HOURS_PRORATED" | "LEDGER_DIRECT" | "UNASSIGNED"> = {};

  const eligibleIdsByDate: Record<string, Set<number>> = {};
  if (serviceLedgerByEmployee) {
    for (const dateStr of Object.keys(serviceLedgerByEmployee)) {
      eligibleIdsByDate[dateStr] = new Set(
        Object.keys(serviceLedgerByEmployee[dateStr])
          .map(k => Number(k))
          .filter(id => Number.isFinite(id) && id > 0)
      );
    }
  }

  for (const dateStr of dates) {
    const ledgerDay = serviceLedgerByEmployee?.[dateStr] || {};
    const poolDay = Object.values(ledgerDay).reduce((s, v) => s + Number(v), 0);
    const unassignedDay = Number(ledgerDay[0] || 0);

    if (poolDay <= 0) {
      allocationModeByDate[dateStr] = "UNASSIGNED";
      continue;
    }

    const eligibleIds = eligibleIdsByDate[dateStr];
    if (!eligibleIds || eligibleIds.size === 0) {
      serviceUnassignedTotal = round2(serviceUnassignedTotal + poolDay);
      allocationModeByDate[dateStr] = "UNASSIGNED";
      continue;
    }

    const payablePool = round2(poolDay - unassignedDay);

    const eligiblesConMin: { employeeId: number; paidWorkedMinutes: number }[] = [];
    for (const empId of eligibleIds) {
      const emp = employees.find(e => e.id === empId);
      if (!emp) continue;
      const key = `${empId}_${dateStr}`;
      const daily = computeDailyPayroll({
        punchesForDay: punchesMap[key] || [],
        scheduleForDay: schedulesMap[key] || null,
        dailyRate: Number(emp.dailyRate) || 0,
        hrConfig,
        dateStr,
      });
      if (daily.paidWorkedMinutes > 0) {
        eligiblesConMin.push({ employeeId: empId, paidWorkedMinutes: daily.paidWorkedMinutes });
      }
    }

    const sumMin = eligiblesConMin.reduce((s, e) => s + e.paidWorkedMinutes, 0);

    const employeePool = round2(payablePool * employeeRate);
    const employeeUnassigned = round2(unassignedDay * employeeRate);

    if (employeePool > 0 && sumMin > 0) {
      for (const e of eligiblesConMin) {
        const weight = e.paidWorkedMinutes / sumMin;
        result[e.employeeId] = round2((result[e.employeeId] || 0) + round2(employeePool * weight));
      }
      serviceUnassignedTotal = round2(serviceUnassignedTotal + employeeUnassigned);
      allocationModeByDate[dateStr] = "HOURS_PRORATED";
    } else {
      for (const empId of eligibleIds) {
        const amt = round2(Number(ledgerDay[empId] || 0) * employeeRate);
        if (amt > 0) {
          result[empId] = round2((result[empId] || 0) + amt);
        }
      }
      serviceUnassignedTotal = round2(serviceUnassignedTotal + employeeUnassigned);
      allocationModeByDate[dateStr] = "LEDGER_DIRECT";
    }
  }

  return { result, serviceUnassignedTotal, allocationModeByDate };
}

export interface ExtraRecord {
  id: number;
  employeeId: number;
  appliesToDate: string;
  typeCode: string;
  amount: string;
  note: string | null;
  kind?: string;
}

export interface EmployeePayrollResult {
  employeeId: number;
  name: string;
  role: string;
  hourlyRate: number;
  daysScheduled: number;
  daysPresent: number;
  daysNoShow: number;
  totalNormalMin: number;
  totalOvertimeCalcMin: number;
  totalOvertimePaidMin: number;
  totalOvertimeMin: number;
  totalUnpaidBreakMin: number;
  totalLateMin: number;
  lateCount: number;
  normalPay: number;
  overtimePay: number;
  basePayTotal: number;
  extrasEarnings: number;
  extrasDeductions: number;
  extrasNet: number;
  servicePayTotal: number;
  ccssBase: number;
  ccssEmployee: number;
  ccssEmployer: number;
  grossPay: number;
  netPay: number;
  employerCost: number;
  grandTotalPay: number;
  dailyBreakdown: DailyBreakdownEntry[];
}

export interface DailyBreakdownEntry {
  date: string;
  workedMinutes: number;
  normalMinutes: number;
  overtimeMinutes: number;
  overtimeCalculatedMinutes: number;
  overtimePaidMinutes: number;
  unpaidBreakMinutes: number;
  tardyMinutes: number;
  basePay: number;
  extras: { id: number; typeCode: string; amount: number; note: string | null; kind: string }[];
  servicePayDay: number;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  flags: string[];
}

function getDateRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const start = new Date(dateFrom + "T12:00:00");
  const end = new Date(dateTo + "T12:00:00");
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + "T12:00:00").getDay();
}

export function computeRangePayroll(args: {
  employees: { id: number; displayName: string; role: string; dailyRate: string | number | null }[];
  schedulesMap: Record<string, ScheduleDay>;
  punchesMap: Record<string, PunchRecord[]>;
  extrasMap: Record<string, ExtraRecord[]>;
  servicePoolMap: Record<string, number>;
  extraTypesKindMap: Record<string, string>;
  dateFrom: string;
  dateTo: string;
  hrConfig: HrConfig;
  overtimeApprovalsMap?: Record<string, "APPROVED" | "REJECTED" | "PENDING">;
}): EmployeePayrollResult[] {
  const { employees, schedulesMap, punchesMap, extrasMap, servicePoolMap, extraTypesKindMap, dateFrom, dateTo, hrConfig } = args;
  const dates = getDateRange(dateFrom, dateTo);

  const socialChargesEnabled = hrConfig.socialChargesEnabled === true;
  const ccssEmployeeRate = Number(hrConfig.ccssEmployeeRate) || 10.67;
  const ccssEmployerRate = Number(hrConfig.ccssEmployerRate) || 26.33;
  const ccssIncludeService = hrConfig.ccssIncludeService === true;

  const dailyCache: Record<string, DailyPayrollResult> = {};
  function getDailyResult(empId: number, dateStr: string, dailyRate: number): DailyPayrollResult {
    const key = `${empId}_${dateStr}`;
    if (!dailyCache[key]) {
      dailyCache[key] = computeDailyPayroll({
        punchesForDay: punchesMap[key] || [],
        scheduleForDay: schedulesMap[key] || null,
        dailyRate,
        hrConfig,
        dateStr,
      });
    }
    return dailyCache[key];
  }

  const serviceCache: Record<string, Record<number, number>> = {};
  function getServiceForDate(dateStr: string): Record<number, number> {
    if (!serviceCache[dateStr]) {
      const pool = servicePoolMap[dateStr] || 0;
      if (pool <= 0) {
        serviceCache[dateStr] = {};
      } else {
        const eligibles: { employeeId: number; paidWorkedMinutes: number }[] = [];
        for (const emp of employees) {
          if (emp.role !== "WAITER" && emp.role !== "SALONERO") continue;
          const daily = getDailyResult(emp.id, dateStr, Number(emp.dailyRate) || 0);
          if (daily.workedMinutesForService > 0) {
            eligibles.push({ employeeId: emp.id, paidWorkedMinutes: daily.workedMinutesForService });
          }
        }
        serviceCache[dateStr] = computeServiceForDay({ servicePool: pool, eligibleWaiters: eligibles });
      }
    }
    return serviceCache[dateStr];
  }

  const results: EmployeePayrollResult[] = [];

  for (const emp of employees) {
    const dailyRate = Number(emp.dailyRate) || 0;
    const jornadaHoras = Number(hrConfig.overtimeDailyThresholdHours) || 8;
    const empHourlyRate = dailyRate / jornadaHoras;
    const isWaiter = emp.role === "WAITER" || emp.role === "SALONERO";

    let daysScheduled = 0, daysPresent = 0, daysNoShow = 0;
    let totalNormalMin = 0, totalOvertimeCalcMin = 0, totalOvertimePaidMin = 0, totalUnpaidBreakMin = 0, totalLateMin = 0, lateCount = 0;
    let normalPay = 0, overtimePay = 0, basePayTotal = 0;
    let extrasEarnings = 0, extrasDeductions = 0;
    let servicePayTotal = 0;
    const dailyBreakdown: DailyBreakdownEntry[] = [];

    for (const dateStr of dates) {
      const key = `${emp.id}_${dateStr}`;
      const schedule = schedulesMap[key] || null;
      const punches = punchesMap[key] || [];
      const dayExtras = extrasMap[key] || [];

      if (schedule && !schedule.isDayOff && schedule.startTime && schedule.endTime) {
        daysScheduled++;
      }

      const daily = getDailyResult(emp.id, dateStr, dailyRate);

      if (punches.length > 0) daysPresent++;
      if (daily.noShow) daysNoShow++;
      totalNormalMin += daily.normalMinutesPaid;
      totalOvertimeCalcMin += daily.overtimeCalculatedMinutes;

      let overtimePaidThisDay = daily.overtimePaidMinutes;
      let overtimePayThisDay = daily.overtimePay;
      if (args.overtimeApprovalsMap && daily.overtimeCalculatedMinutes > 0) {
        const approvalKey = `${emp.id}_${dateStr}`;
        const approvalStatus = args.overtimeApprovalsMap[approvalKey];
        if (approvalStatus === "APPROVED") {
          overtimePaidThisDay = daily.overtimeCalculatedMinutes;
          overtimePayThisDay = round2((overtimePaidThisDay / 60) * empHourlyRate * (Number(hrConfig.overtimeMultiplier) || 1.5));
        } else {
          overtimePaidThisDay = 0;
          overtimePayThisDay = 0;
        }
      }
      totalOvertimePaidMin += overtimePaidThisDay;

      totalUnpaidBreakMin += daily.unpaidBreakMinutes;
      if (daily.late) {
        lateCount++;
        totalLateMin += daily.tardyMinutes;
      }
      normalPay += daily.normalPay;
      overtimePay += overtimePayThisDay;
      basePayTotal += round2(daily.normalPay + overtimePayThisDay);

      const extrasFormatted: DailyBreakdownEntry["extras"] = [];
      for (const ex of dayExtras) {
        const amt = Number(ex.amount);
        const kind = ex.kind || extraTypesKindMap[ex.typeCode] || "EARNING";
        extrasFormatted.push({ id: ex.id, typeCode: ex.typeCode, amount: amt, note: ex.note, kind });
        if (kind === "EARNING") extrasEarnings += amt;
        else extrasDeductions += Math.abs(amt);
      }

      let servicePayDay = 0;
      if (isWaiter) {
        const svcMap = getServiceForDate(dateStr);
        servicePayDay = svcMap[emp.id] || 0;
      }
      servicePayTotal += servicePayDay;

      dailyBreakdown.push({
        date: dateStr,
        workedMinutes: daily.workedMinutes,
        normalMinutes: daily.normalMinutesPaid,
        overtimeMinutes: overtimePaidThisDay,
        overtimeCalculatedMinutes: daily.overtimeCalculatedMinutes,
        overtimePaidMinutes: overtimePaidThisDay,
        unpaidBreakMinutes: daily.unpaidBreakMinutes,
        tardyMinutes: daily.tardyMinutes,
        basePay: round2(daily.normalPay + overtimePayThisDay),
        extras: extrasFormatted,
        servicePayDay,
        scheduledStartTime: daily.scheduledStartTime,
        scheduledEndTime: daily.scheduledEndTime,
        flags: daily.flags,
      });
    }

    const extrasNet = round2(extrasEarnings - extrasDeductions);
    normalPay = round2(normalPay);
    overtimePay = round2(overtimePay);
    basePayTotal = round2(basePayTotal);
    servicePayTotal = round2(servicePayTotal);

    const grossPay = round2(basePayTotal + extrasNet + servicePayTotal);

    let ccssBase = 0, ccssEmployee = 0, ccssEmployer = 0;
    if (socialChargesEnabled) {
      ccssBase = round2(basePayTotal + (ccssIncludeService ? servicePayTotal : 0));
      ccssEmployee = round2(ccssBase * ccssEmployeeRate / 100);
      ccssEmployer = round2(ccssBase * ccssEmployerRate / 100);
    }

    const netPay = round2(grossPay - ccssEmployee);
    const employerCost = round2(grossPay + ccssEmployer);
    const grandTotalPay = grossPay;

    results.push({
      employeeId: emp.id,
      name: emp.displayName,
      role: emp.role,
      hourlyRate: empHourlyRate,
      daysScheduled, daysPresent, daysNoShow,
      totalNormalMin, totalOvertimeCalcMin, totalOvertimePaidMin,
      totalOvertimeMin: totalOvertimePaidMin,
      totalUnpaidBreakMin, totalLateMin, lateCount,
      normalPay, overtimePay, basePayTotal,
      extrasEarnings: round2(extrasEarnings), extrasDeductions: round2(extrasDeductions), extrasNet,
      servicePayTotal,
      ccssBase, ccssEmployee, ccssEmployer,
      grossPay, netPay, employerCost,
      grandTotalPay,
      dailyBreakdown,
    });
  }

  return results;
}
