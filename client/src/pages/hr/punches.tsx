import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Edit, Clock, MapPin, ChevronDown, Users, Calendar, Trash2, Plus } from "lucide-react";

interface Punch {
  id: number;
  employeeId: number;
  clockInAt: string;
  clockOutAt?: string | null;
  workedMinutes?: number | null;
  lateMinutes?: number | null;
  exitType?: string | null;
  geoVerified?: boolean | null;
}

interface OpenPunch {
  id: number;
  employeeId: number;
  clockInAt: string;
  employeeName?: string;
}

interface Employee {
  id: number;
  displayName: string;
}

const MANUAL_PUNCH_REASONS = [
  { value: "olvido_marcar", label: "Olvidó marcar" },
  { value: "fallo_sistema", label: "Fallo del sistema" },
  { value: "correccion_horario", label: "Corrección de horario" },
  { value: "dia_libre_trabajado", label: "Día libre trabajado" },
  { value: "capacitacion", label: "Capacitación" },
  { value: "otro", label: "Otro" },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit" });
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-CR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatWorked(minutes: number | null | undefined): string {
  if (minutes == null) return "-";
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function toDatetimeLocal(dateStr: string): string {
  const d = new Date(dateStr);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function EmployeeMultiSelect({
  employees,
  selectedIds,
  onChange,
}: {
  employees: Employee[];
  selectedIds: Set<number>;
  onChange: (ids: Set<number>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const allSelected = selectedIds.size === 0;
  const label = allSelected
    ? "Todos"
    : selectedIds.size === 1
      ? employees.find((e) => selectedIds.has(e.id))?.displayName || "1 empleado"
      : `${selectedIds.size} empleados`;

  function toggleAll() {
    onChange(new Set());
  }

  function toggle(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    if (next.size === employees.length) {
      onChange(new Set());
    } else {
      onChange(next);
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="button-employee-filter"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-9 px-3 rounded-md border text-sm w-full justify-between bg-background hover:bg-muted transition-colors"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="flex items-center gap-1.5 truncate">
          <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {label}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] max-h-[280px] overflow-y-auto rounded-md border bg-popover shadow-md" style={{ borderColor: "var(--border)" }}>
          <label
            className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer border-b text-sm font-medium"
            style={{ borderColor: "var(--border)" }}
            data-testid="option-employee-all"
          >
            <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
            Todos
          </label>
          {employees.map((emp) => (
            <label
              key={emp.id}
              className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm"
              data-testid={`option-filter-employee-${emp.id}`}
            >
              <Checkbox
                checked={allSelected || selectedIds.has(emp.id)}
                onCheckedChange={() => toggle(emp.id)}
              />
              {emp.displayName}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PunchesPage() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [selectedEmployees, setSelectedEmployees] = useState<Set<number>>(new Set());
  const [editingPunch, setEditingPunch] = useState<Punch | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editReason, setEditReason] = useState("");

  const [deletingPunch, setDeletingPunch] = useState<Punch | null>(null);

  const [manualEmployeeId, setManualEmployeeId] = useState("");
  const [manualDate, setManualDate] = useState(todayStr());
  const [manualClockIn, setManualClockIn] = useState("");
  const [manualClockOut, setManualClockOut] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualNotes, setManualNotes] = useState("");

  const isRange = dateFrom !== dateTo;
  const queryParams = isRange
    ? `?dateFrom=${dateFrom}&dateTo=${dateTo}`
    : `?date=${dateFrom}`;

  const { data: punches, isLoading: punchesLoading } = useQuery<Punch[]>({
    queryKey: ["/api/hr/punches", queryParams],
    enabled: !!dateFrom && !!dateTo,
  });

  const { data: employees, isLoading: employeesLoading } = useQuery<Employee[]>({
    queryKey: ["/api/hr/employees"],
  });

  const { data: openPunches, isLoading: openLoading } = useQuery<OpenPunch[]>({
    queryKey: ["/api/hr/open-punches"],
  });

  const employeeMap = new Map<number, string>();
  if (employees) {
    for (const emp of employees) {
      employeeMap.set(emp.id, emp.displayName);
    }
  }

  const filteredPunches = punches?.filter((p) => {
    if (selectedEmployees.size === 0) return true;
    return selectedEmployees.has(p.employeeId);
  }) || [];

  const sortedPunches = [...filteredPunches].sort((a, b) => {
    const dateA = new Date(a.clockInAt).getTime();
    const dateB = new Date(b.clockInAt).getTime();
    if (dateA !== dateB) return dateB - dateA;
    const nameA = employeeMap.get(a.employeeId) || "";
    const nameB = employeeMap.get(b.employeeId) || "";
    return nameA.localeCompare(nameB);
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/hr/punches"] });
    queryClient.invalidateQueries({ queryKey: ["/api/hr/open-punches"] });
    queryClient.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "/api/hr/payroll-report",
    });
  };

  const editMutation = useMutation({
    mutationFn: async (data: { id: number; clockInAt: string; clockOutAt: string; reason: string }) => {
      await apiRequest("PATCH", `/api/hr/punches/${data.id}`, {
        clockInAt: data.clockInAt,
        clockOutAt: data.clockOutAt,
        reason: data.reason,
      });
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Marca actualizada" });
      setEditingPunch(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error al actualizar marca", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/hr/punches/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Marca eliminada" });
      setDeletingPunch(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error al eliminar marca", description: err.message, variant: "destructive" });
      setDeletingPunch(null);
    },
  });

  const manualPunchMutation = useMutation({
    mutationFn: async (data: {
      employeeId: number;
      date: string;
      clockInTime: string;
      clockOutTime?: string;
      reason: string;
      notes?: string;
    }) => {
      await apiRequest("POST", "/api/hr/manual-punch", data);
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "Marca manual creada" });
      setManualClockIn("");
      setManualClockOut("");
      setManualReason("");
      setManualNotes("");
    },
    onError: (err: Error) => {
      toast({ title: "Error al crear marca manual", description: err.message, variant: "destructive" });
    },
  });

  function openEditDialog(punch: Punch) {
    setEditingPunch(punch);
    setEditClockIn(punch.clockInAt ? toDatetimeLocal(punch.clockInAt) : "");
    setEditClockOut(punch.clockOutAt ? toDatetimeLocal(punch.clockOutAt) : "");
    setEditReason("");
  }

  function handleEditSubmit() {
    if (!editingPunch) return;
    if (!editReason.trim()) {
      toast({ title: "Razón requerida", description: "Debe indicar una razón para el cambio.", variant: "destructive" });
      return;
    }
    editMutation.mutate({
      id: editingPunch.id,
      clockInAt: new Date(editClockIn).toISOString(),
      clockOutAt: editClockOut ? new Date(editClockOut).toISOString() : "",
      reason: editReason.trim(),
    });
  }

  function handleManualPunchSubmit() {
    if (!manualEmployeeId) {
      toast({ title: "Seleccione empleado", variant: "destructive" });
      return;
    }
    if (!manualClockIn) {
      toast({ title: "Hora de entrada requerida", variant: "destructive" });
      return;
    }
    if (!manualReason) {
      toast({ title: "Razón requerida", description: "Debe seleccionar una razón para la marca manual.", variant: "destructive" });
      return;
    }
    manualPunchMutation.mutate({
      employeeId: parseInt(manualEmployeeId),
      date: manualDate,
      clockInTime: manualClockIn,
      clockOutTime: manualClockOut || undefined,
      reason: MANUAL_PUNCH_REASONS.find(r => r.value === manualReason)?.label || manualReason,
      notes: manualNotes.trim() || undefined,
    });
  }

  const isLoading = punchesLoading || employeesLoading;

  return (
    <div className="admin-page">
      <h1 className="admin-page-title" data-testid="text-punches-title">Gestión de Marcas</h1>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
            <Clock className="h-5 w-5" />
            Empleados en Turno
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-open-punches">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !openPunches || openPunches.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-open-punches">
              No hay empleados en turno.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-open-punches">
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Entrada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openPunches.map((op) => (
                    <TableRow key={op.id} data-testid={`row-open-punch-${op.id}`}>
                      <TableCell data-testid={`text-open-employee-${op.id}`}>
                        {op.employeeName || employeeMap.get(op.employeeId) || `ID ${op.employeeId}`}
                      </TableCell>
                      <TableCell data-testid={`text-open-clockin-${op.id}`}>
                        {formatTime(op.clockInAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
            <Plus className="h-5 w-5" />
            Marca Manual
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1 min-w-[180px]">
              <Label>Empleado *</Label>
              <Select
                value={manualEmployeeId}
                onValueChange={setManualEmployeeId}
              >
                <SelectTrigger data-testid="select-manual-employee">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {employees?.map((emp) => (
                    <SelectItem key={emp.id} value={String(emp.id)} data-testid={`option-manual-employee-${emp.id}`}>
                      {emp.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Fecha *</Label>
              <Input
                data-testid="input-manual-date"
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
                className="w-[150px]"
              />
            </div>
            <div className="space-y-1">
              <Label>Entrada *</Label>
              <Input
                data-testid="input-manual-clockin"
                type="time"
                value={manualClockIn}
                onChange={(e) => setManualClockIn(e.target.value)}
                className="w-[130px]"
              />
            </div>
            <div className="space-y-1">
              <Label>Salida (opcional)</Label>
              <Input
                data-testid="input-manual-clockout"
                type="time"
                value={manualClockOut}
                onChange={(e) => setManualClockOut(e.target.value)}
                className="w-[130px]"
              />
            </div>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1 min-w-[200px]">
              <Label>Razón *</Label>
              <Select
                value={manualReason}
                onValueChange={setManualReason}
              >
                <SelectTrigger data-testid="select-manual-reason">
                  <SelectValue placeholder="Seleccionar razón" />
                </SelectTrigger>
                <SelectContent>
                  {MANUAL_PUNCH_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value} data-testid={`option-reason-${r.value}`}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label>Nota (opcional)</Label>
              <Input
                data-testid="input-manual-notes"
                value={manualNotes}
                onChange={(e) => setManualNotes(e.target.value)}
                placeholder="Nota adicional..."
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              data-testid="button-manual-punch-submit"
              onClick={handleManualPunchSubmit}
              disabled={manualPunchMutation.isPending}
            >
              {manualPunchMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Marca Manual
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 space-y-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Marcas Diarias
          </CardTitle>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Desde</Label>
              <Input
                data-testid="input-date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  if (e.target.value > dateTo) setDateTo(e.target.value);
                }}
                className="w-[150px]"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Hasta</Label>
              <Input
                data-testid="input-date-to"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  if (e.target.value < dateFrom) setDateFrom(e.target.value);
                }}
                className="w-[150px]"
              />
            </div>
            <div className="space-y-1 min-w-[180px]">
              <Label className="text-xs text-muted-foreground">Empleado</Label>
              <EmployeeMultiSelect
                employees={employees || []}
                selectedIds={selectedEmployees}
                onChange={setSelectedEmployees}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-punches">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : sortedPunches.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-punches">
              No hay marcas para este período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-punches">
                <TableHeader>
                  <TableRow>
                    {isRange && <TableHead>Fecha</TableHead>}
                    <TableHead>Empleado</TableHead>
                    <TableHead>Entrada</TableHead>
                    <TableHead>Salida</TableHead>
                    <TableHead>Trabajado</TableHead>
                    <TableHead>Tardía (min)</TableHead>
                    <TableHead>Tipo Salida</TableHead>
                    <TableHead>Geo</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPunches.map((punch) => (
                    <TableRow
                      key={punch.id}
                      data-testid={`row-punch-${punch.id}`}
                    >
                      {isRange && (
                        <TableCell className="text-xs text-muted-foreground" data-testid={`text-punch-date-${punch.id}`}>
                          {formatDate(punch.clockInAt)}
                        </TableCell>
                      )}
                      <TableCell data-testid={`text-punch-employee-${punch.id}`}>
                        {employeeMap.get(punch.employeeId) || `ID ${punch.employeeId}`}
                      </TableCell>
                      <TableCell data-testid={`text-punch-clockin-${punch.id}`}>
                        {formatTime(punch.clockInAt)}
                      </TableCell>
                      <TableCell data-testid={`text-punch-clockout-${punch.id}`}>
                        {punch.clockOutAt ? formatTime(punch.clockOutAt) : "-"}
                      </TableCell>
                      <TableCell data-testid={`text-punch-worked-${punch.id}`}>
                        {formatWorked(punch.workedMinutes)}
                      </TableCell>
                      <TableCell data-testid={`text-punch-late-${punch.id}`}>
                        {punch.lateMinutes != null ? punch.lateMinutes : "-"}
                      </TableCell>
                      <TableCell data-testid={`text-punch-exittype-${punch.id}`}>
                        {punch.exitType || "-"}
                      </TableCell>
                      <TableCell data-testid={`badge-punch-geo-${punch.id}`}>
                        {punch.geoVerified != null ? (
                          <Badge variant={punch.geoVerified ? "default" : "secondary"}>
                            <MapPin className="h-3 w-3 mr-1" />
                            {punch.geoVerified ? "Sí" : "No"}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            data-testid={`button-edit-punch-${punch.id}`}
                            onClick={() => openEditDialog(punch)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            data-testid={`button-delete-punch-${punch.id}`}
                            onClick={() => setDeletingPunch(punch)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editingPunch} onOpenChange={(open) => { if (!open) setEditingPunch(null); }}>
        <DialogContent data-testid="dialog-edit-punch">
          <DialogHeader>
            <DialogTitle>
              Editar Marca
              {editingPunch && (
                <span className="block text-sm font-normal text-muted-foreground mt-1">
                  {employeeMap.get(editingPunch.employeeId) || `ID ${editingPunch.employeeId}`}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="edit-clockin">Entrada</Label>
              <Input
                id="edit-clockin"
                data-testid="input-edit-clockin"
                type="datetime-local"
                value={editClockIn}
                onChange={(e) => setEditClockIn(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-clockout">Salida</Label>
              <Input
                id="edit-clockout"
                data-testid="input-edit-clockout"
                type="datetime-local"
                value={editClockOut}
                onChange={(e) => setEditClockOut(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-reason">Razón del cambio *</Label>
              <Input
                id="edit-reason"
                data-testid="input-edit-reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Razón obligatoria"
              />
            </div>
            <div className="flex justify-end gap-2 flex-wrap">
              <Button
                variant="outline"
                data-testid="button-cancel-edit"
                onClick={() => setEditingPunch(null)}
              >
                Cancelar
              </Button>
              <Button
                data-testid="button-save-edit"
                onClick={handleEditSubmit}
                disabled={editMutation.isPending}
              >
                {editMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletingPunch} onOpenChange={(open) => { if (!open) setDeletingPunch(null); }}>
        <AlertDialogContent data-testid="dialog-delete-punch">
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar marca</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-confirmation">
              {deletingPunch && (
                <>
                  ¿Eliminar esta marca de{" "}
                  <strong>{employeeMap.get(deletingPunch.employeeId) || `ID ${deletingPunch.employeeId}`}</strong>{" "}
                  del <strong>{formatFullDate(deletingPunch.clockInAt)}</strong>?
                  <br />
                  Esta acción no se puede deshacer.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete"
              onClick={() => {
                if (deletingPunch) {
                  deleteMutation.mutate(deletingPunch.id);
                }
              }}
              className="bg-destructive text-destructive-foreground"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
