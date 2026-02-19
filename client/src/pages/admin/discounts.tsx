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
import { Plus, Pencil, Percent, Loader2 } from "lucide-react";
import type { Discount } from "@shared/schema";

export default function AdminDiscountsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Discount | null>(null);
  const [form, setForm] = useState({ name: "", type: "percentage", value: "", restricted: false, active: true });

  const { data: discountsList = [], isLoading } = useQuery<Discount[]>({
    queryKey: ["/api/admin/discounts"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) {
        return apiRequest("PATCH", `/api/admin/discounts/${editing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/discounts", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/discounts"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Descuento actualizado" : "Descuento creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", type: "percentage", value: "", restricted: false, active: true });
    setOpen(true);
  };

  const openEdit = (d: Discount) => {
    setEditing(d);
    setForm({
      name: d.name,
      type: d.type,
      value: d.value,
      restricted: d.restricted,
      active: d.active,
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  const formatDiscount = (d: Discount) => {
    if (d.type === "percentage") return `${d.value}%`;
    const n = parseFloat(d.value);
    return `₡${n.toLocaleString("es-CR")}`;
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title flex items-center gap-2" data-testid="text-page-title">
            <Percent className="w-6 h-6" />
            Descuentos
          </h1>
          <p className="admin-page-sub">Administre los descuentos disponibles</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-discount">
              <Plus className="w-4 h-4" />
              <span className="ml-1">Nuevo Descuento</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Descuento" : "Nuevo Descuento"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  data-testid="input-discount-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Desc empleados 30%"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="select-discount-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                    <SelectItem value="fixed">Monto fijo (₡)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{form.type === "percentage" ? "Porcentaje" : "Monto (₡)"}</Label>
                <Input
                  data-testid="input-discount-value"
                  type="number"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  placeholder={form.type === "percentage" ? "30" : "5000"}
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.restricted}
                  onCheckedChange={(c) => setForm({ ...form, restricted: c })}
                  data-testid="switch-restricted"
                />
                <Label>Restringido (solo gerente)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.active}
                  onCheckedChange={(c) => setForm({ ...form, active: c })}
                  data-testid="switch-active"
                />
                <Label>Activo</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-discount">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Descuento"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : discountsList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Percent className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay descuentos configurados</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {discountsList.map((d) => (
            <Card key={d.id} data-testid={`card-discount-${d.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-3 min-h-[48px]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                    <Percent className="w-4 h-4 text-accent-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDiscount(d)} {d.type === "percentage" ? "porcentaje" : "fijo"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  {d.restricted && <Badge variant="destructive">Restringido</Badge>}
                  <Badge variant={d.active ? "default" : "secondary"}>
                    {d.active ? "Activo" : "Inactivo"}
                  </Badge>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(d)} data-testid={`button-edit-discount-${d.id}`}>
                    <Pencil className="w-4 h-4" />
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
