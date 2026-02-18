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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Pencil, Users, Loader2 } from "lucide-react";
import type { User } from "@shared/schema";

const ROLES = ["WAITER", "KITCHEN", "CASHIER", "MANAGER", "FARM_MANAGER"];
const ROLE_LABELS: Record<string, string> = { WAITER: "Salonero", KITCHEN: "Cocina", CASHIER: "Cajero", MANAGER: "Gerente", FARM_MANAGER: "Gerente Granja" };

export default function AdminUsersPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ username: "", password: "", displayName: "", role: "WAITER", active: true });

  const { data: users = [], isLoading } = useQuery<User[]>({ queryKey: ["/api/admin/users"] });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) return apiRequest("PATCH", `/api/admin/users/${editing.id}`, data);
      return apiRequest("POST", "/api/admin/users", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Usuario actualizado" : "Usuario creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => { setEditing(null); setForm({ username: "", password: "", displayName: "", role: "WAITER", active: true }); setOpen(true); };
  const openEdit = (u: User) => { setEditing(u); setForm({ username: u.username, password: "", displayName: u.displayName, role: u.role, active: u.active }); setOpen(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form };
    if (editing && !payload.password) delete payload.password;
    saveMutation.mutate(payload);
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Users className="w-6 h-6" />
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Administre los usuarios del sistema</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-user">
              <Plus className="w-4 h-4" /><span className="ml-1">Nuevo Usuario</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar Usuario" : "Nuevo Usuario"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Usuario</Label>
                <Input data-testid="input-user-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>{editing ? "Nueva Contraseña (vacío = no cambiar)" : "Contraseña"}</Label>
                <Input data-testid="input-user-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required={!editing} />
              </div>
              <div className="space-y-2">
                <Label>Nombre Completo</Label>
                <Input data-testid="input-user-display-name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Rol</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(c) => setForm({ ...form, active: c })} />
                <Label>Activo</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-user">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar" : "Crear"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : users.length === 0 ? (
        <Card><CardContent className="py-12 text-center"><Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground">No hay usuarios</p></CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {users.map((u) => (
            <Card key={u.id} data-testid={`card-user-${u.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="w-10 h-10">
                    <AvatarFallback className="text-xs">{u.displayName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.displayName}</p>
                    <p className="text-xs text-muted-foreground">@{u.username}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant="secondary">{ROLE_LABELS[u.role] || u.role}</Badge>
                  <Badge variant={u.active ? "default" : "secondary"}>{u.active ? "Activo" : "Inactivo"}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(u)} data-testid={`button-edit-user-${u.id}`}><Pencil className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
