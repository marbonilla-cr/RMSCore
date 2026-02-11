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
import { Plus, Pencil, Wallet, Loader2 } from "lucide-react";
import type { PaymentMethod } from "@shared/schema";

export default function AdminPaymentMethodsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [form, setForm] = useState({ paymentCode: "", paymentName: "", active: true, sortOrder: 0 });

  const { data: methods = [], isLoading } = useQuery<PaymentMethod[]>({ queryKey: ["/api/admin/payment-methods"] });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) return apiRequest("PATCH", `/api/admin/payment-methods/${editing.id}`, data);
      return apiRequest("POST", "/api/admin/payment-methods", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/payment-methods"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Método actualizado" : "Método creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => { setEditing(null); setForm({ paymentCode: "", paymentName: "", active: true, sortOrder: 0 }); setOpen(true); };
  const openEdit = (m: PaymentMethod) => { setEditing(m); setForm({ paymentCode: m.paymentCode, paymentName: m.paymentName, active: m.active, sortOrder: m.sortOrder }); setOpen(true); };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); saveMutation.mutate(form); };

  return (
    <div className="p-3 md:p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Wallet className="w-6 h-6" />
            Métodos de Pago
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Configure los métodos de pago aceptados</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-payment-method">
              <Plus className="w-4 h-4" /><span className="ml-1">Nuevo Método</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Editar Método" : "Nuevo Método"}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Código</Label>
                <Input data-testid="input-payment-code" value={form.paymentCode} onChange={(e) => setForm({ ...form, paymentCode: e.target.value })} placeholder="CASH" required />
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input data-testid="input-payment-name" value={form.paymentName} onChange={(e) => setForm({ ...form, paymentName: e.target.value })} placeholder="Efectivo" required />
              </div>
              <div className="space-y-2">
                <Label>Orden</Label>
                <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(c) => setForm({ ...form, active: c })} />
                <Label>Activo</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-payment-method">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar" : "Crear"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : methods.length === 0 ? (
        <Card><CardContent className="py-12 text-center">
          <Wallet className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No hay métodos de pago</p>
        </CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {methods.map((m) => (
            <Card key={m.id} data-testid={`card-payment-method-${m.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-3 min-h-[48px]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                    <Wallet className="w-4 h-4 text-accent-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.paymentName}</p>
                    <p className="text-xs text-muted-foreground">Código: {m.paymentCode}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={m.active ? "default" : "secondary"}>{m.active ? "Activo" : "Inactivo"}</Badge>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(m)} data-testid={`button-edit-method-${m.id}`}><Pencil className="w-4 h-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
