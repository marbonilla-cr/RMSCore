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

export interface DailyPayrollResult {
  workedMinutes: number;
  normalMinutes: number;
  overtimeMinutes: number;
  unpaidBreakMinutes: number;
  paidWorkedMinutes: number;
  tardyMinutes: number;
  normalPay: number;
  overtimePay: number;
  baseTotalPayDay: number;
  flags: {
    late: boolean;
    noShow: boolean;
    autoCheckout: boolean;
    midnightShift: boolean;
    hasMultiplePunches: boolean;
  };
}

function toDate(v: Date | string | null): Date | null {
  if (!v) return null;
  return v instanceof Date ? v : new Date(v);
}

function parseDateInTZ(dateStr: string, timeStr: string): Date {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return d;
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

  const hasSchedule = scheduleForDay && !scheduleForDay.isDayOff && scheduleForDay.startTime && scheduleForDay.endTime;

  const { scheduledStart, scheduledEnd } = getScheduleTimesForDate(dateStr, scheduleForDay || null);

  if (punchesForDay.length === 0) {
    return {
      workedMinutes: 0, normalMinutes: 0, overtimeMinutes: 0,
      unpaidBreakMinutes: 0, paidWorkedMinutes: 0, tardyMinutes: 0,
      normalPay: 0, overtimePay: 0, baseTotalPayDay: 0,
      flags: { late: false, noShow: !!hasSchedule, autoCheckout: false, midnightShift: false, hasMultiplePunches: false },
    };
  }

  const hasMultiplePunches = punchesForDay.length > 1;
  const sorted = [...punchesForDay].sort((a, b) => toDate(a.clockInAt)!.getTime() - toDate(b.clockInAt)!.getTime());
  const firstPunch = sorted[0];

  const clockIn = toDate(firstPunch.clockInAt)!;
  const firstClockOut = toDate(firstPunch.clockOutAt);
  const firstClockOutType = firstPunch.clockOutType;

  let tardyMinutes = 0;
  let late = false;
  if (scheduledStart) {
    const diff = diffMinutes(scheduledStart, clockIn);
    if (diff > graceMinutes) {
      tardyMinutes = diff;
      late = true;
    }
  }

  const effectiveStart = scheduledStart && clockIn.getTime() < scheduledStart.getTime()
    ? scheduledStart : clockIn;

  let normalEnd: Date;
  let autoCheckout = false;
  if (firstClockOut) {
    if (scheduledEnd && firstClockOut.getTime() > scheduledEnd.getTime()) {
      normalEnd = scheduledEnd;
    } else {
      normalEnd = firstClockOut;
    }
    autoCheckout = firstClockOutType === "AUTO" || firstClockOutType === "AUTO_NO_SCHEDULE";
  } else if (scheduledEnd) {
    normalEnd = scheduledEnd;
    autoCheckout = true;
  } else {
    return {
      workedMinutes: 0, normalMinutes: 0, overtimeMinutes: 0,
      unpaidBreakMinutes: 0, paidWorkedMinutes: 0, tardyMinutes,
      normalPay: 0, overtimePay: 0, baseTotalPayDay: 0,
      flags: { late, noShow: false, autoCheckout: true, midnightShift: false, hasMultiplePunches },
    };
  }

  const normalWorkedMinutes = Math.max(0, diffMinutes(effectiveStart, normalEnd));

  let overtimeMinutes = 0;
  if (hasMultiplePunches) {
    for (let i = 1; i < sorted.length; i++) {
      const pIn = toDate(sorted[i].clockInAt);
      const pOut = toDate(sorted[i].clockOutAt);
      if (pIn && pOut) {
        overtimeMinutes += Math.max(0, diffMinutes(pIn, pOut));
      }
    }
  }

  const totalWorkedMinutes = normalWorkedMinutes + overtimeMinutes;
  const unpaidBreakMinutes = normalWorkedMinutes >= 540 ? 60 : 0;
  const normalMinutes = Math.max(0, normalWorkedMinutes - unpaidBreakMinutes);
  const paidWorkedMinutes = normalMinutes + overtimeMinutes;

  const midnightShift = scheduledStart && scheduledEnd
    ? scheduledEnd.getDate() !== scheduledStart.getDate()
    : false;

  const normalPay = round2((normalMinutes / 60) * hourlyRate);
  const overtimePay = round2((overtimeMinutes / 60) * hourlyRate * multiplier);
  const baseTotalPayDay = round2(normalPay + overtimePay);

  return {
    workedMinutes: totalWorkedMinutes, normalMinutes, overtimeMinutes,
    unpaidBreakMinutes, paidWorkedMinutes, tardyMinutes,
    normalPay, overtimePay, baseTotalPayDay,
    flags: { late, noShow: false, autoCheckout, midnightShift, hasMultiplePunches },
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
  daysScheduled: number;
  daysPresent: number;
  daysNoShow: number;
  totalNormalMin: number;
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
  grandTotalPay: number;
  dailyBreakdown: DailyBreakdownEntry[];
}

export interface DailyBreakdownEntry {
  date: string;
  workedMinutes: number;
  normalMinutes: number;
  overtimeMinutes: number;
  unpaidBreakMinutes: number;
  tardyMinutes: number;
  basePay: number;
  extras: { id: number; typeCode: string; amount: number; note: string | null; kind: string }[];
  servicePayDay: number;
  flags: DailyPayrollResult["flags"];
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
}): EmployeePayrollResult[] {
  const { employees, schedulesMap, punchesMap, extrasMap, servicePoolMap, extraTypesKindMap, dateFrom, dateTo, hrConfig } = args;
  const dates = getDateRange(dateFrom, dateTo);

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
          if (daily.paidWorkedMinutes > 0) {
            eligibles.push({ employeeId: emp.id, paidWorkedMinutes: daily.paidWorkedMinutes });
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
    const isWaiter = emp.role === "WAITER" || emp.role === "SALONERO";

    let daysScheduled = 0, daysPresent = 0, daysNoShow = 0;
    let totalNormalMin = 0, totalOvertimeMin = 0, totalUnpaidBreakMin = 0, totalLateMin = 0, lateCount = 0;
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
      if (daily.flags.noShow) daysNoShow++;
      totalNormalMin += daily.normalMinutes;
      totalOvertimeMin += daily.overtimeMinutes;
      totalUnpaidBreakMin += daily.unpaidBreakMinutes;
      if (daily.flags.late) {
        lateCount++;
        totalLateMin += daily.tardyMinutes;
      }
      normalPay += daily.normalPay;
      overtimePay += daily.overtimePay;
      basePayTotal += daily.baseTotalPayDay;

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
        normalMinutes: daily.normalMinutes,
        overtimeMinutes: daily.overtimeMinutes,
        unpaidBreakMinutes: daily.unpaidBreakMinutes,
        tardyMinutes: daily.tardyMinutes,
        basePay: daily.baseTotalPayDay,
        extras: extrasFormatted,
        servicePayDay,
        flags: daily.flags,
      });
    }

    const extrasNet = round2(extrasEarnings - extrasDeductions);
    const grandTotalPay = round2(basePayTotal + extrasNet + servicePayTotal);

    results.push({
      employeeId: emp.id,
      name: emp.displayName,
      role: emp.role,
      daysScheduled, daysPresent, daysNoShow,
      totalNormalMin, totalOvertimeMin, totalUnpaidBreakMin, totalLateMin, lateCount,
      normalPay: round2(normalPay), overtimePay: round2(overtimePay), basePayTotal: round2(basePayTotal),
      extrasEarnings: round2(extrasEarnings), extrasDeductions: round2(extrasDeductions), extrasNet,
      servicePayTotal: round2(servicePayTotal),
      grandTotalPay,
      dailyBreakdown,
    });
  }

  return results;
}
