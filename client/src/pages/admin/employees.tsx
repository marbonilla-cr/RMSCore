import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Users, Loader2, KeyRound, Lock, ShieldCheck, ShieldOff } from "lucide-react";

interface Employee {
  id: number;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  email: string | null;
  hasPin: boolean;
  createdAt: string;
}

const ROLES = ["MANAGER", "CASHIER", "WAITER", "KITCHEN", "STAFF"];
const ROLE_LABELS: Record<string, string> = {
  MANAGER: "Gerente",
  CASHIER: "Cajero",
  WAITER: "Salonero",
  KITCHEN: "Cocina",
  STAFF: "Personal",
};

export default function AdminEmployeesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwTarget, setResetPwTarget] = useState<Employee | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "WAITER",
    email: "",
    active: true,
  });

  const { data: employees = [], isLoading } = useQuery<Employee[]>({
    queryKey: ["/api/admin/employees"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) return apiRequest("PATCH", `/api/admin/employees/${editing.id}`, data);
      return apiRequest("POST", "/api/admin/employees", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employees"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Empleado actualizado" : "Empleado creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      return apiRequest("PATCH", `/api/admin/employees/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employees"] });
      toast({ title: "Estado actualizado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: number; password: string }) => {
      return apiRequest("POST", `/api/admin/employees/${id}/reset-password`, { password });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employees"] });
      setResetPwOpen(false);
      setResetPwTarget(null);
      setNewPassword("");
      toast({ title: "Contraseña restablecida" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetPinMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/admin/employees/${id}/reset-pin`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/employees"] });
      toast({ title: "PIN restablecido" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ username: "", password: "", displayName: "", role: "WAITER", email: "", active: true });
    setOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditing(emp);
    setForm({
      username: emp.username,
      password: "",
      displayName: emp.displayName,
      role: emp.role,
      email: emp.email || "",
      active: emp.active,
    });
    setOpen(true);
  };

  const openResetPassword = (emp: Employee) => {
    setResetPwTarget(emp);
    setNewPassword("");
    setResetPwOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    if (editing) {
      delete payload.password;
    }
    if (!payload.email) delete payload.email;
    saveMutation.mutate(payload);
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (resetPwTarget) {
      resetPasswordMutation.mutate({ id: resetPwTarget.id, password: newPassword });
    }
  };

  return (
    <div className="p-3 md:p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Users className="w-6 h-6" />
            Empleados
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Administre los empleados del sistema</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-employee">
              <Plus className="w-4 h-4" /><span className="ml-1">Nuevo Empleado</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Empleado" : "Nuevo Empleado"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre Completo</Label>
                <Input
                  data-testid="input-employee-display-name"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Usuario</Label>
                <Input
                  data-testid="input-employee-username"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  required
                />
              </div>
              {!editing && (
                <div className="space-y-2">
                  <Label>Contraseña</Label>
                  <Input
                    data-testid="input-employee-password"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Rol</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="select-employee-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Correo Electrónico (opcional)</Label>
                <Input
                  data-testid="input-employee-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  data-testid="switch-employee-active"
                  checked={form.active}
                  onCheckedChange={(c) => setForm({ ...form, active: c })}
                />
                <Label>Activo</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-employee">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Empleado"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restablecer Contraseña</DialogTitle>
          </DialogHeader>
          {resetPwTarget && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Restablecer contraseña para <span className="font-medium">{resetPwTarget.displayName}</span>
              </p>
              <div className="space-y-2">
                <Label>Nueva Contraseña</Label>
                <Input
                  data-testid="input-reset-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={resetPasswordMutation.isPending} data-testid="button-confirm-reset-password">
                {resetPasswordMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                Restablecer
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay empleados registrados</p>
            <Button variant="outline" className="mt-4" onClick={openCreate} data-testid="button-add-employee-empty">
              <Plus className="w-4 h-4 mr-1" />
              Crear primer empleado
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {employees.map((emp) => (
            <Card key={emp.id} data-testid={`row-employee-${emp.id}`}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-3 min-h-[48px]">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4 text-accent-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-employee-name-${emp.id}`}>
                        {emp.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground" data-testid={`text-employee-username-${emp.id}`}>
                        @{emp.username}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
                    <Badge variant="secondary" data-testid={`badge-employee-role-${emp.id}`}>
                      {ROLE_LABELS[emp.role] || emp.role}
                    </Badge>
                    <Badge
                      variant={emp.active ? "default" : "secondary"}
                      data-testid={`badge-employee-status-${emp.id}`}
                    >
                      {emp.active ? "Activo" : "Inactivo"}
                    </Badge>
                    <span data-testid={`text-employee-pin-${emp.id}`}>
                      {emp.hasPin ? (
                        <ShieldCheck className="w-4 h-4 text-green-600" />
                      ) : (
                        <ShieldOff className="w-4 h-4 text-muted-foreground" />
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-2 justify-end">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEdit(emp)}
                    data-testid={`button-edit-employee-${emp.id}`}
                    title="Editar"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openResetPassword(emp)}
                    data-testid={`button-reset-password-${emp.id}`}
                    title="Restablecer Contraseña"
                  >
                    <Lock className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => resetPinMutation.mutate(emp.id)}
                    data-testid={`button-reset-pin-${emp.id}`}
                    title="Restablecer PIN"
                    disabled={resetPinMutation.isPending}
                  >
                    <KeyRound className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => toggleActiveMutation.mutate({ id: emp.id, active: !emp.active })}
                    data-testid={`button-toggle-active-${emp.id}`}
                    title={emp.active ? "Desactivar" : "Activar"}
                    disabled={toggleActiveMutation.isPending}
                  >
                    {emp.active ? (
                      <ShieldOff className="w-4 h-4" />
                    ) : (
                      <ShieldCheck className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}