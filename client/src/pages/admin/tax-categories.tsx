import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Loader2, Receipt, CheckCheck } from "lucide-react";
import type { TaxCategory } from "@shared/schema";

export default function AdminTaxCategoriesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [applyAllConfirm, setApplyAllConfirm] = useState<TaxCategory | null>(null);
  const [editing, setEditing] = useState<TaxCategory | null>(null);
  const [form, setForm] = useState({ name: "", rate: "", inclusive: false, active: true, sortOrder: 0 });

  const { data: taxList = [], isLoading } = useQuery<TaxCategory[]>({
    queryKey: ["/api/admin/tax-categories"],
  });

  const applyAllMutation = useMutation({
    mutationFn: async (taxCategoryId: number) => {
      const res = await apiRequest("POST", `/api/admin/tax-categories/${taxCategoryId}/apply-all`);
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Listo", description: data.message });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) {
        return apiRequest("PATCH", `/api/admin/tax-categories/${editing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/tax-categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tax-categories"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Impuesto actualizado" : "Impuesto creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", rate: "", inclusive: false, active: true, sortOrder: 0 });
    setOpen(true);
  };

  const openEdit = (tc: TaxCategory) => {
    setEditing(tc);
    setForm({
      name: tc.name,
      rate: tc.rate,
      inclusive: tc.inclusive,
      active: tc.active,
      sortOrder: tc.sortOrder,
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title flex items-center gap-2" data-testid="text-page-title">
            <Receipt className="w-6 h-6" />
            Impuestos
          </h1>
          <p className="admin-page-sub">Configure casillas de impuestos para productos</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-tax">
              <Plus className="w-4 h-4" />
              <span className="ml-1">Nuevo Impuesto</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Impuesto" : "Nuevo Impuesto"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  data-testid="input-tax-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="IVA, Servicio, etc."
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Porcentaje (%)</Label>
                <Input
                  data-testid="input-tax-rate"
                  type="number"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  placeholder="13"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.inclusive}
                  onCheckedChange={(c) => setForm({ ...form, inclusive: c })}
                  data-testid="switch-tax-inclusive"
                />
                <Label>Incluido en precio</Label>
                <span className="text-xs text-muted-foreground">(el precio ya contiene este impuesto)</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.active}
                  onCheckedChange={(c) => setForm({ ...form, active: c })}
                  data-testid="switch-tax-active"
                />
                <Label>Activo</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-tax">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Impuesto"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : taxList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay impuestos configurados</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {taxList.map((tc) => (
            <Card key={tc.id} data-testid={`card-tax-${tc.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-3 min-h-[48px]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                    <Receipt className="w-4 h-4 text-accent-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{tc.name}</p>
                    <p className="text-xs text-muted-foreground">{tc.rate}%</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  {tc.inclusive && (
                    <Badge variant="outline">Incl.</Badge>
                  )}
                  <Badge variant={tc.active ? "default" : "secondary"}>
                    {tc.active ? "Activo" : "Inactivo"}
                  </Badge>
                  <Button size="icon" variant="ghost" onClick={() => setApplyAllConfirm(tc)} data-testid={`button-apply-all-tax-${tc.id}`} disabled={applyAllMutation.isPending}>
                    {applyAllMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(tc)} data-testid={`button-edit-tax-${tc.id}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!applyAllConfirm} onOpenChange={(v) => !v && setApplyAllConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar "{applyAllConfirm?.name}" a todos los productos</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esto asignará el impuesto "{applyAllConfirm?.name}" ({applyAllConfirm?.rate}%) a todos los productos que aún no lo tengan. Los productos que ya lo tienen no se verán afectados.
          </p>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setApplyAllConfirm(null)} data-testid="button-cancel-apply-all">
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (applyAllConfirm) {
                  applyAllMutation.mutate(applyAllConfirm.id);
                  setApplyAllConfirm(null);
                }
              }}
              disabled={applyAllMutation.isPending}
              data-testid="button-confirm-apply-all"
            >
              {applyAllMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Aplicar a todos
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
