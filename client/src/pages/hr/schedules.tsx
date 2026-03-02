import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Loader2, ChevronLeft, ChevronRight, Plus, Copy, Trash2 } from "lucide-react";

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DAY_OF_WEEK_VALUES = [1, 2, 3, 4, 5, 6, 0];

interface Employee {
  id: number;
  displayName: string;
  role: string;
  username: string;
}

interface ScheduleDay {
  id?: number;
  scheduleId?: number;
  dayOfWeek: number;
  startTime: string | null;
  endTime: string | null;
  isDayOff: boolean;
}

interface WeeklySchedule {
  id: number;
  employeeId: number;
  weekStartDate: string;
  days: ScheduleDay[];
}

interface DayFormState {
  startTime: string;
  endTime: string;
  isDayOff: boolean;
}

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatWeekLabel(date: Date): string {
  const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const d = date.getDate();
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  return `Semana del ${d} ${m} ${y}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function emptyDayForm(): DayFormState[] {
  return DAY_OF_WEEK_VALUES.map(() => ({
    startTime: "09:00",
    endTime: "17:00",
    isDayOff: false,
  }));
}

function scheduleToDayForm(schedule: WeeklySchedule): DayFormState[] {
  return DAY_OF_WEEK_VALUES.map((dow) => {
    const day = schedule.days.find((d) => d.dayOfWeek === dow);
    if (day) {
      return {
        startTime: day.startTime || "09:00",
        endTime: day.endTime || "17:00",
        isDayOff: day.isDayOff,
      };
    }
    return { startTime: "09:00", endTime: "17:00", isDayOff: false };
  });
}

export default function Schedules() {
  const { toast } = useToast();
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<WeeklySchedule | null>(null);
  const [dayForms, setDayForms] = useState<DayFormState[]>(emptyDayForm());

  const weekStartDate = formatDateYMD(weekStart);

  const { data: employees, isLoading: empLoading } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });

  const { data: schedules, isLoading: schLoading } = useQuery<WeeklySchedule[]>({
    queryKey: [`/api/hr/schedules?weekStartDate=${weekStartDate}`],
  });

  const prevWeekDate = formatDateYMD(addDays(weekStart, -7));
  const { data: prevSchedules } = useQuery<WeeklySchedule[]>({
    queryKey: [`/api/hr/schedules?weekStartDate=${prevWeekDate}`],
  });

  const scheduleMap = useMemo(() => {
    const map = new Map<number, WeeklySchedule>();
    if (schedules) {
      for (const s of schedules) {
        map.set(s.employeeId, s);
      }
    }
    return map;
  }, [schedules]);

  const invalidatePayroll = () => {
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/hr/payroll-report",
    });
  };

  const createMutation = useMutation({
    mutationFn: async (body: { employeeId: number; weekStartDate: string; days: any[] }) => {
      await apiRequest("POST", "/api/hr/schedules", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/schedules"] });
      invalidatePayroll();
      toast({ title: "Horario creado" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, days }: { id: number; days: any[] }) => {
      await apiRequest("PUT", `/api/hr/schedules/${id}`, { days });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/schedules"] });
      invalidatePayroll();
      toast({ title: "Horario actualizado" });
      setDialogOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/hr/schedules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/schedules"] });
      invalidatePayroll();
      toast({ title: "Horario eliminado" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const copyWeekMutation = useMutation({
    mutationFn: async () => {
      if (!prevSchedules || prevSchedules.length === 0) {
        throw new Error("No hay horarios en la semana anterior");
      }
      for (const prev of prevSchedules) {
        const existing = scheduleMap.get(prev.employeeId);
        if (existing) continue;
        const days = prev.days.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          startTime: d.startTime,
          endTime: d.endTime,
          isDayOff: d.isDayOff,
        }));
        await apiRequest("POST", "/api/hr/schedules", {
          employeeId: prev.employeeId,
          weekStartDate,
          days,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/schedules"] });
      invalidatePayroll();
      toast({ title: "Semana anterior copiada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al copiar", description: err.message, variant: "destructive" });
    },
  });

  function openDialog(emp: Employee) {
    setSelectedEmployee(emp);
    const existing = scheduleMap.get(emp.id);
    if (existing) {
      setEditingSchedule(existing);
      setDayForms(scheduleToDayForm(existing));
    } else {
      setEditingSchedule(null);
      setDayForms(emptyDayForm());
    }
    setDialogOpen(true);
  }

  function handleSave() {
    if (!selectedEmployee) return;
    const days = DAY_OF_WEEK_VALUES.map((dow, i) => ({
      dayOfWeek: dow,
      startTime: dayForms[i].isDayOff ? null : dayForms[i].startTime,
      endTime: dayForms[i].isDayOff ? null : dayForms[i].endTime,
      isDayOff: dayForms[i].isDayOff,
    }));

    if (editingSchedule) {
      updateMutation.mutate({ id: editingSchedule.id, days });
    } else {
      createMutation.mutate({ employeeId: selectedEmployee.id, weekStartDate, days });
    }
  }

  function updateDayForm(index: number, field: keyof DayFormState, value: any) {
    setDayForms((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  function getCellContent(empId: number, dayIndex: number): { text: string; isDayOff: boolean } {
    const schedule = scheduleMap.get(empId);
    if (!schedule) return { text: "-", isDayOff: false };
    const dow = DAY_OF_WEEK_VALUES[dayIndex];
    const day = schedule.days.find((d) => d.dayOfWeek === dow);
    if (!day) return { text: "-", isDayOff: false };
    if (day.isDayOff) return { text: "Libre", isDayOff: true };
    if (day.startTime && day.endTime) return { text: `${day.startTime} - ${day.endTime}`, isDayOff: false };
    return { text: "-", isDayOff: false };
  }

  const isLoading = empLoading || schLoading;
  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="admin-page">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 flex-wrap">
          <CardTitle className="text-lg" data-testid="text-page-title">Horarios Semanales</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="icon"
              variant="outline"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
              data-testid="button-prev-week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium min-w-[160px] text-center" data-testid="text-week-label">
              {formatWeekLabel(weekStart)}
            </span>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
              data-testid="button-next-week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => copyWeekMutation.mutate()}
              disabled={copyWeekMutation.isPending}
              data-testid="button-copy-week"
            >
              {copyWeekMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Copy className="h-4 w-4 mr-2" />
              )}
              Copiar semana anterior
            </Button>
          </div>

          {/* Desktop grid */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-schedules">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Empleado</th>
                  {DAYS.map((day) => (
                    <th key={day} className="pb-2 px-2 font-medium text-center">{day}</th>
                  ))}
                  <th className="pb-2 pl-2 font-medium text-center">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {employees?.map((emp) => {
                  const schedule = scheduleMap.get(emp.id);
                  return (
                    <tr key={emp.id} className="border-b last:border-0" data-testid={`row-employee-${emp.id}`}>
                      <td className="py-2 pr-4 font-medium">{emp.displayName}</td>
                      {DAYS.map((_, di) => {
                        const cell = getCellContent(emp.id, di);
                        return (
                          <td key={di} className="py-2 px-2 text-center" data-testid={`cell-schedule-${emp.id}-${di}`}>
                            {cell.isDayOff ? (
                              <Badge variant="secondary">Libre</Badge>
                            ) : (
                              <span className="text-xs">{cell.text}</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="py-2 pl-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openDialog(emp)}
                            data-testid={`button-edit-${emp.id}`}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          {schedule && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteMutation.mutate(schedule.id)}
                              disabled={deleteMutation.isPending}
                              data-testid={`button-delete-${emp.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {employees?.map((emp) => {
              const schedule = scheduleMap.get(emp.id);
              return (
                <Card key={emp.id} data-testid={`card-employee-${emp.id}`}>
                  <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">{emp.displayName}</CardTitle>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openDialog(emp)}
                        data-testid={`button-edit-mobile-${emp.id}`}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      {schedule && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteMutation.mutate(schedule.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-mobile-${emp.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {DAYS.map((day, di) => {
                        const cell = getCellContent(emp.id, di);
                        return (
                          <div key={di} className="flex items-center gap-1" data-testid={`cell-mobile-${emp.id}-${di}`}>
                            <span className="font-medium w-8">{day}:</span>
                            {cell.isDayOff ? (
                              <Badge variant="secondary">Libre</Badge>
                            ) : (
                              <span>{cell.text}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingSchedule ? "Editar Horario" : "Crear Horario"} - {selectedEmployee?.displayName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {DAYS.map((day, i) => (
              <div key={i} className="flex items-center gap-2 flex-wrap" data-testid={`form-day-${i}`}>
                <span className="font-medium text-sm w-10">{day}</span>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Libre</span>
                  <Switch
                    checked={dayForms[i].isDayOff}
                    onCheckedChange={(v) => updateDayForm(i, "isDayOff", v)}
                    data-testid={`switch-dayoff-${i}`}
                  />
                </div>
                {!dayForms[i].isDayOff && (
                  <>
                    <Input
                      type="time"
                      value={dayForms[i].startTime}
                      onChange={(e) => updateDayForm(i, "startTime", e.target.value)}
                      className="w-28"
                      data-testid={`input-start-${i}`}
                    />
                    <span className="text-xs text-muted-foreground">-</span>
                    <Input
                      type="time"
                      value={dayForms[i].endTime}
                      onChange={(e) => updateDayForm(i, "endTime", e.target.value)}
                      className="w-28"
                      data-testid={`input-end-${i}`}
                    />
                  </>
                )}
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                data-testid="button-cancel"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                data-testid="button-save"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
