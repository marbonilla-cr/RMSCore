import * as storage from "./storage";
import { getBusinessDate } from "./storage";

export function startHrBackgroundJobs() {
  setInterval(async () => {
    try {
      await autoClockOutJob();
    } catch (err) {
      console.error("[HR-Jobs] AutoClockOut error:", err);
    }
  }, 5 * 60 * 1000);

  console.log("[HR-Jobs] Background jobs started (auto clock-out every 5min)");
}

async function autoClockOutJob() {
  const openPunches = await storage.getAllOpenPunches();
  if (openPunches.length === 0) return;

  const now = new Date();
  const settings = await storage.getHrSettings();
  const autoCloseHours = settings ? Number(settings.overtimeDailyThresholdHours) || 8 : 8;
  const dailyThresholdMinutes = autoCloseHours * 60;

  const graceByDay: Record<string, number> =
    (settings?.autoClockoutGraceByDay as any) ??
    { mon: 30, tue: 30, wed: 30, thu: 30, fri: 30, sat: 30, sun: 30 };

  for (const punch of openPunches) {
    if (punch.clockOutAt) continue;

    if (punch.scheduledEndAt) {
      const scheduledEnd = new Date(punch.scheduledEndAt);
      if (now < scheduledEnd) continue;

      const crWeekday = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Costa_Rica",
        weekday: "short",
      }).format(scheduledEnd).toLowerCase();

      const graceMinutes = graceByDay[crWeekday] ?? 30;
      const graceCutoff = new Date(scheduledEnd.getTime() + graceMinutes * 60 * 1000);

      if (now < graceCutoff) continue;

      const workedMs = scheduledEnd.getTime() - new Date(punch.clockInAt).getTime();
      const workedMinutes = Math.floor(workedMs / 60000);
      const overtimeMinutesDaily = Math.max(0, workedMinutes - dailyThresholdMinutes);

      await storage.updateTimePunch(punch.id, {
        clockOutAt: scheduledEnd,
        clockOutType: "AUTO",
        workedMinutes,
        overtimeMinutesDaily,
        notes: `Auto clock-out (gracia de ${graceMinutes}min)`,
      });

      await storage.createAuditEvent({
        actorType: "SYSTEM",
        action: "AUTO_CLOCK_OUT",
        entityType: "HR_PUNCH",
        entityId: punch.id,
        metadata: { employeeId: punch.employeeId, workedMinutes, graceMinutes },
      });

      console.log(`[HR-Jobs] Auto clock-out for employee ${punch.employeeId}, punch ${punch.id} (grace ${graceMinutes}min)`);
    } else {
      const clockInAt = new Date(punch.clockInAt);
      const elapsedMs = now.getTime() - clockInAt.getTime();
      if (elapsedMs < autoCloseHours * 3600000) continue;

      const clockOutAt = new Date(clockInAt.getTime() + autoCloseHours * 3600000);
      const workedMinutes = autoCloseHours * 60;

      await storage.updateTimePunch(punch.id, {
        clockOutAt,
        clockOutType: "AUTO_NO_SCHEDULE",
        workedMinutes,
        overtimeMinutesDaily: 0,
        notes: `Auto clock-out sin horario programado (${autoCloseHours}h máx)`,
      });

      await storage.createAuditEvent({
        actorType: "SYSTEM",
        action: "AUTO_CLOCK_OUT_NO_SCHEDULE",
        entityType: "HR_PUNCH",
        entityId: punch.id,
        metadata: { employeeId: punch.employeeId, workedMinutes, autoCloseHours },
      });

      console.log(`[HR-Jobs] Auto clock-out (no schedule) for employee ${punch.employeeId}, punch ${punch.id}, ${autoCloseHours}h cap`);
    }
  }
}
