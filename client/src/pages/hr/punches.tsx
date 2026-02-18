import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Loader2, Edit, Clock, MapPin } from "lucide-react";

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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" });
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

export default function PunchesPage() {
  const { toast } = useToast();
  const [date, setDate] = useState(todayStr());
  const [editingPunch, setEditingPunch] = useState<Punch | null>(null);
  const [editClockIn, setEditClockIn] = useState("");
  const [editClockOut, setEditClockOut] = useState("");
  const [editReason, setEditReason] = useState("");

  const [overrideEmployeeId, setOverrideEmployeeId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const { data: punches, isLoading: punchesLoading } = useQuery<Punch[]>({
    queryKey: ["/api/hr/punches", `?date=${date}`],
    enabled: !!date,
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

  const editMutation = useMutation({
    mutationFn: async (data: { id: number; clockInAt: string; clockOutAt: string; reason: string }) => {
      await apiRequest("PATCH", `/api/hr/punches/${data.id}`, {
        clockInAt: data.clockInAt,
        clockOutAt: data.clockOutAt,
        reason: data.reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/open-punches"] });
      toast({ title: "Marca actualizada" });
      setEditingPunch(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error al actualizar marca", description: err.message, variant: "destructive" });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async (data: { employeeId: number; action: "clock_in" | "clock_out"; reason: string }) => {
      await apiRequest("POST", "/api/hr/override-clock", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/punches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/hr/open-punches"] });
      toast({ title: "Override aplicado" });
      setOverrideReason("");
    },
    onError: (err: Error) => {
      toast({ title: "Error en override", description: err.message, variant: "destructive" });
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

  function handleOverride(action: "clock_in" | "clock_out") {
    if (!overrideEmployeeId) {
      toast({ title: "Seleccione empleado", variant: "destructive" });
      return;
    }
    if (!overrideReason.trim()) {
      toast({ title: "Razón requerida", description: "Debe indicar una razón para el override.", variant: "destructive" });
      return;
    }
    overrideMutation.mutate({
      employeeId: parseInt(overrideEmployeeId),
      action,
      reason: overrideReason.trim(),
    });
  }

  const isLoading = punchesLoading || employeesLoading;

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold" data-testid="text-punches-title">Gestión de Marcas</h1>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2 flex-wrap">
            <Clock className="h-5 w-5" />
            Marcas Abiertas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {openLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-open-punches">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !openPunches || openPunches.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-open-punches">
              No hay marcas abiertas.
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
          <CardTitle className="text-lg">Override de Marca</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3 flex-wrap items-end">
            <div className="space-y-1 min-w-[180px]">
              <Label htmlFor="override-employee">Empleado</Label>
              <Select
                value={overrideEmployeeId}
                onValueChange={setOverrideEmployeeId}
              >
                <SelectTrigger data-testid="select-override-employee">
                  <SelectValue placeholder="Seleccionar empleado" />
                </SelectTrigger>
                <SelectContent>
                  {employees?.map((emp) => (
                    <SelectItem key={emp.id} value={String(emp.id)} data-testid={`option-employee-${emp.id}`}>
                      {emp.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label htmlFor="override-reason">Razón</Label>
              <Input
                id="override-reason"
                data-testid="input-override-reason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Razón del override"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              data-testid="button-override-clockin"
              onClick={() => handleOverride("clock_in")}
              disabled={overrideMutation.isPending}
            >
              {overrideMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Marcar Entrada
            </Button>
            <Button
              variant="outline"
              data-testid="button-override-clockout"
              onClick={() => handleOverride("clock_out")}
              disabled={overrideMutation.isPending}
            >
              {overrideMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Marcar Salida
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-lg">Marcas del Día</CardTitle>
          <div className="space-y-1">
            <Input
              data-testid="input-date-picker"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-punches">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !punches || punches.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-punches">
              No hay marcas para esta fecha.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-punches">
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Entrada</TableHead>
                    <TableHead>Salida</TableHead>
                    <TableHead>Trabajado</TableHead>
                    <TableHead>Tardía (min)</TableHead>
                    <TableHead>Tipo Salida</TableHead>
                    <TableHead>Geo</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {punches.map((punch) => (
                    <TableRow key={punch.id} data-testid={`row-punch-${punch.id}`}>
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
                            {punch.geoVerified ? "Verificado" : "No verificado"}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          data-testid={`button-edit-punch-${punch.id}`}
                          onClick={() => openEditDialog(punch)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
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
            <DialogTitle>Editar Marca</DialogTitle>
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
    </div>
  );
}
