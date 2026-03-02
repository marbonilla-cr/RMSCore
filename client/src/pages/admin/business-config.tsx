import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save, Building2, Loader2, Trash2, AlertTriangle } from "lucide-react";

interface TaxCategory {
  id: number;
  name: string;
  rate: string;
  inclusive: boolean;
  active: boolean;
}

interface BusinessConfigData {
  id?: number;
  businessName: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  legalNote: string;
  serviceTaxCategoryId?: number | null;
}

export default function AdminBusinessConfigPage() {
  const { toast } = useToast();
  const [confirmTruncate, setConfirmTruncate] = useState(false);
  const [fixResult, setFixResult] = useState<{ inserted: number; updated: number } | null>(null);

  const fixServiceMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/fix-service-ledger");
      return res.json();
    },
    onSuccess: (data: any) => {
      setFixResult({ inserted: data.inserted, updated: data.updated });
      toast({ title: "Corrección aplicada", description: `Insertados: ${data.inserted}, Corregidos: ${data.updated}` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const truncateMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/truncate-transactions"),
    onSuccess: () => {
      setConfirmTruncate(false);
      toast({ title: "Datos transaccionales eliminados correctamente" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const [form, setForm] = useState<BusinessConfigData>({
    businessName: "",
    legalName: "",
    taxId: "",
    address: "",
    phone: "",
    email: "",
    legalNote: "",
    serviceTaxCategoryId: null,
  });

  const { data: config, isLoading } = useQuery<BusinessConfigData>({
    queryKey: ["/api/admin/business-config"],
  });

  const { data: taxCategories } = useQuery<TaxCategory[]>({
    queryKey: ["/api/admin/tax-categories"],
  });

  useEffect(() => {
    if (config) {
      setForm({
        businessName: config.businessName || "",
        legalName: config.legalName || "",
        taxId: config.taxId || "",
        address: config.address || "",
        phone: config.phone || "",
        email: config.email || "",
        legalNote: config.legalNote || "",
        serviceTaxCategoryId: config.serviceTaxCategoryId || null,
      });
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async (data: BusinessConfigData) => {
      return apiRequest("PUT", "/api/admin/business-config", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/business-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/business-config"] });
      toast({ title: "Configuración guardada" });
    },
    onError: (err: any) => {
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5" />
          <h1 className="admin-page-title" data-testid="text-page-title">Configuración del Negocio</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
            <span className="font-semibold">Datos del Negocio</span>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="businessName">Nombre Comercial</Label>
                <Input
                  id="businessName"
                  data-testid="input-business-name"
                  value={form.businessName}
                  onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                  placeholder="La Antigua Lechería"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="legalName">Razón Social</Label>
                <Input
                  id="legalName"
                  data-testid="input-legal-name"
                  value={form.legalName}
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                  placeholder="La Antigua Lechería S.A."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="taxId">Cédula Jurídica</Label>
                <Input
                  id="taxId"
                  data-testid="input-tax-id"
                  value={form.taxId}
                  onChange={(e) => setForm({ ...form, taxId: e.target.value })}
                  placeholder="3-101-123456"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  data-testid="input-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+506 2222-3333"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  data-testid="input-email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="info@laantiguaecheria.com"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="address">Dirección</Label>
              <Textarea
                id="address"
                data-testid="input-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Dirección completa del negocio"
                rows={2}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="serviceTaxCategory">Impuesto de Servicio</Label>
              <Select
                value={form.serviceTaxCategoryId ? String(form.serviceTaxCategoryId) : ""}
                onValueChange={(val) => setForm({ ...form, serviceTaxCategoryId: val ? Number(val) : null })}
              >
                <SelectTrigger data-testid="select-service-tax-category">
                  <SelectValue placeholder="Seleccionar categoría de impuesto..." />
                </SelectTrigger>
                <SelectContent>
                  {(taxCategories || []).filter(tc => tc.active).map(tc => (
                    <SelectItem key={tc.id} value={String(tc.id)}>
                      {tc.name} — {tc.rate}% {tc.inclusive ? "(incluido)" : "(adicional)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Define la categoría de impuesto que se usa para calcular el cargo por servicio en cada venta.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="legalNote">Nota Legal (Tiquete Electrónico)</Label>
              <Textarea
                id="legalNote"
                data-testid="input-legal-note"
                value={form.legalNote}
                onChange={(e) => setForm({ ...form, legalNote: e.target.value })}
                placeholder="Nota legal obligatoria que aparece al pie del tiquete..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Esta nota aparecerá al pie de cada tiquete impreso. Puede actualizarla en cualquier momento.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end mt-4">
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-config"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Guardar Configuración
          </Button>
        </div>
      </form>

      <Card className="mt-6 border-amber-500">
        <CardHeader>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            Corrección de Servicio (Feb 11-15 + tasa 10%)
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Inserta los registros de servicio faltantes del 11-15 de febrero y corrige la tasa de 8% a 10% en todos los registros que tengan tasa incorrecta. Solo se ejecuta una vez.
          </p>
          {fixResult && (
            <div className="mb-3 p-2 rounded bg-muted text-sm" data-testid="text-fix-result">
              Insertados: {fixResult.inserted} — Corregidos: {fixResult.updated}
            </div>
          )}
          <Button
            variant="outline"
            onClick={() => fixServiceMutation.mutate()}
            disabled={fixServiceMutation.isPending}
            data-testid="button-fix-service-ledger"
          >
            {fixServiceMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Ejecutar corrección de servicio
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-6" style={{ borderColor: 'var(--red-m)' }}>
        <CardHeader>
          <h3 className="text-base font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            Zona de Mantenimiento
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Elimina todas las órdenes, pagos, tickets de cocina y cierres de caja. Los productos, mesas, empleados y configuración permanecen intactos.
          </p>
          <Button
            variant="destructive"
            onClick={() => setConfirmTruncate(true)}
            data-testid="button-truncate-transactions"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Limpiar datos transaccionales
          </Button>
        </CardContent>
      </Card>

      <Dialog open={confirmTruncate} onOpenChange={setConfirmTruncate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Confirmar limpieza
            </DialogTitle>
            <DialogDescription>
              Se eliminarán TODAS las órdenes, pagos, tickets de cocina, cierres de caja y eventos de auditoría. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="outline" onClick={() => setConfirmTruncate(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => truncateMutation.mutate()}
              disabled={truncateMutation.isPending}
              data-testid="button-confirm-truncate"
            >
              {truncateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Sí, eliminar todo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
