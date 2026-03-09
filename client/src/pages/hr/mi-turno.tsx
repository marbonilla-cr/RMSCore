import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Clock, LogIn, LogOut, CalendarDays } from "lucide-react";

interface PunchStatus {
  clockedIn: boolean;
  clockInTime?: string;
  punchId?: number;
}

interface PunchRecord {
  id: number;
  clockInAt: string;
  clockOutAt?: string | null;
  workedMinutes?: number | null;
  late?: boolean;
}

interface ScheduleDay {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isDayOff: boolean;
}

interface WeeklySchedule {
  id: number;
  days: ScheduleDay[];
}

function formatTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("es-CR", { timeZone: "America/Costa_Rica", hour: "2-digit", minute: "2-digit", hour12: true });
}

function formatDay(dateStr: string | undefined | null): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-CR", { timeZone: "America/Costa_Rica", weekday: "short", day: "numeric", month: "short" });
}

function formatElapsed(startStr: string): string {
  const start = new Date(startStr).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - start);
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatWorked(minutes: number | null | undefined): string {
  if (!minutes && minutes !== 0) return "-";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function getWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

function formatScheduleTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MIN_CLOCK_OUT_MINUTES = 60;

export default function MiTurno() {
  const { toast } = useToast();
  const [elapsed, setElapsed] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; confirmNoSchedule?: boolean } | null>(null);
  const [now, setNow] = useState(Date.now());

  const { start: weekStart, end: weekEnd } = getWeekRange();
  const todayDow = new Date().getDay();

  const { data: status, isLoading: statusLoading } = useQuery<PunchStatus>({
    queryKey: ["/api/hr/my-punch"],
    refetchInterval: 30000,
  });

  const { data: punches, isLoading: punchesLoading } = useQuery<PunchRecord[]>({
    queryKey: ["/api/hr/punches/my", weekStart, weekEnd],
    queryFn: async () => {
      const res = await fetch(`/api/hr/punches/my?dateFrom=${weekStart}&dateTo=${weekEnd}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: schedule } = useQuery<WeeklySchedule>({
    queryKey: ["/api/hr/schedules/my", weekStart],
    queryFn: async () => {
      const res = await fetch(`/api/hr/schedules/my?weekStartDate=${weekStart}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  useEffect(() => {
    if (!status?.clockedIn || !status.clockInTime) {
      setElapsed("");
      return;
    }
    const update = () => {
      setElapsed(formatElapsed(status.clockInTime!));
      setNow(Date.now());
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [status?.clockedIn, status?.clockInTime]);

  const minutesSinceClockIn = useMemo(() => {
    if (!status?.clockedIn || !status.clockInTime) return 0;
    const diff = now - new Date(status.clockInTime).getTime();
    return Math.floor(diff / 60000);
  }, [status?.clockedIn, status?.clockInTime, now]);

  const canClockOut = status?.clockedIn && minutesSinceClockIn >= MIN_CLOCK_OUT_MINUTES;
  const remainingMinutes = Math.max(0, MIN_CLOCK_OUT_MINUTES - minutesSinceClockIn);

  const clockInMutation = useMutation({
    mutationFn: async (body: { confirmNoSchedule?: boolean }) => {
      const res = await apiRequest("POST", "/api/hr/clock-in", body);
      const data = await res.json();
      if (data.requireConfirm) {
        throw Object.assign(new Error("requireConfirm"), { confirmData: data });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/my-punch"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/punches/my"] });
      toast({ title: "Entrada registrada" });
    },
    onError: (err: any) => {
      if (err.confirmData) {
        setConfirmDialog({ message: err.confirmData.message });
        return;
      }
      toast({ title: "Error al registrar entrada", description: err.message, variant: "destructive" });
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/hr/clock-out", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/my-punch"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/punches/my"] });
      toast({ title: "Salida registrada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al registrar salida", description: err.message, variant: "destructive" });
    },
  });

  const isBusy = clockInMutation.isPending || clockOutMutation.isPending;

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="admin-page">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-lg">Mi Turno</CardTitle>
          {status?.clockedIn ? (
            <Badge variant="default" data-testid="badge-status-active">Activo</Badge>
          ) : (
            <Badge variant="secondary" data-testid="badge-status-inactive">Inactivo</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border bg-muted/50 p-3" data-testid="schedule-week">
            <div className="flex items-center justify-center gap-2 text-sm font-medium mb-2">
              <CalendarDays className="h-4 w-4" />
              <span>Horario Semanal</span>
            </div>
            {schedule?.days && schedule.days.length > 0 ? (
              <div className="space-y-1">
                {WEEK_ORDER.map(dow => {
                  const day = schedule.days.find((d: ScheduleDay) => d.dayOfWeek === dow);
                  const isToday = dow === todayDow;
                  return (
                    <div
                      key={dow}
                      className={`flex items-center justify-between px-3 py-1.5 rounded text-sm ${isToday ? "bg-primary/10 font-semibold" : ""}`}
                      data-testid={`schedule-day-${dow}`}
                    >
                      <span className={isToday ? "text-primary" : "text-muted-foreground"}>
                        {DAY_NAMES[dow].slice(0, 3)}
                        {isToday && " (Hoy)"}
                      </span>
                      <span>
                        {day ? (
                          day.isDayOff ? (
                            <span className="text-muted-foreground italic">Libre</span>
                          ) : (
                            `${formatScheduleTime(day.startTime)} — ${formatScheduleTime(day.endTime)}`
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center">Sin horario asignado</p>
            )}
          </div>

          <div className="text-center space-y-2">
            {status?.clockedIn && status.clockInTime ? (
              <>
                <p className="text-sm text-muted-foreground" data-testid="text-status-message">
                  Turno activo desde {formatTime(status.clockInTime)}
                </p>
                <p className="text-4xl font-mono font-bold tabular-nums" data-testid="text-elapsed-timer">
                  {elapsed}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-status-message">
                Sin turno activo
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              className="w-full"
              disabled={isBusy || !!status?.clockedIn}
              onClick={() => clockInMutation.mutate({})}
              data-testid="button-clock-in"
            >
              {clockInMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <LogIn className="h-5 w-5 mr-2" />
              )}
              Registrar Entrada
            </Button>

            <Button
              size="lg"
              className="w-full"
              disabled={isBusy || !canClockOut}
              onClick={() => clockOutMutation.mutate()}
              data-testid="button-clock-out"
            >
              {clockOutMutation.isPending ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <LogOut className="h-5 w-5 mr-2" />
              )}
              Registrar Salida
            </Button>
            {status?.clockedIn && !canClockOut && (
              <p className="text-xs text-center text-muted-foreground" data-testid="text-clock-out-wait">
                Disponible en {remainingMinutes} min
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
            <Clock className="h-5 w-5" />
            Registros de la Semana
          </CardTitle>
        </CardHeader>
        <CardContent>
          {punchesLoading ? (
            <div className="flex justify-center py-4" data-testid="status-punches-loading">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !punches || punches.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-punches">
              No hay registros para hoy
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-punches">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-2 font-medium">Día</th>
                    <th className="pb-2 pr-2 font-medium">Entrada</th>
                    <th className="pb-2 pr-2 font-medium">Salida</th>
                    <th className="pb-2 pr-2 font-medium">Trabajado</th>
                    <th className="pb-2 font-medium">Tardía</th>
                  </tr>
                </thead>
                <tbody>
                  {punches.map((punch, idx) => (
                    <tr key={punch.id} className="border-b last:border-0" data-testid={`row-punch-${idx}`}>
                      <td className="py-2 pr-2 text-muted-foreground">{formatDay(punch.clockInAt)}</td>
                      <td className="py-2 pr-2">{formatTime(punch.clockInAt)}</td>
                      <td className="py-2 pr-2">{punch.clockOutAt ? formatTime(punch.clockOutAt) : "-"}</td>
                      <td className="py-2 pr-2">{formatWorked(punch.workedMinutes)}</td>
                      <td className="py-2">
                        {punch.late ? (
                          <Badge variant="destructive" data-testid={`badge-late-${idx}`}>Sí</Badge>
                        ) : (
                          <span className="text-muted-foreground">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!confirmDialog} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar entrada</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground" data-testid="text-confirm-no-schedule">
            {confirmDialog?.message}
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setConfirmDialog(null)} data-testid="button-cancel-confirm">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setConfirmDialog(null);
                clockInMutation.mutate({ confirmNoSchedule: true });
              }}
              data-testid="button-confirm-clock-in"
            >
              Confirmar Entrada
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
