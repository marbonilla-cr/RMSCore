import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Save, Building2, Loader2, Upload, Package, Globe } from "lucide-react";

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
  timezone?: string;
}

const TIMEZONE_OPTIONS = [
  { value: "America/Costa_Rica", label: "Costa Rica (UTC-6)" },
  { value: "America/Mexico_City", label: "México Centro (UTC-6)" },
  { value: "America/Panama", label: "Panamá (UTC-5)" },
  { value: "America/Bogota", label: "Colombia (UTC-5)" },
  { value: "America/Lima", label: "Perú (UTC-5)" },
  { value: "America/Santiago", label: "Chile (UTC-3/-4)" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina (UTC-3)" },
  { value: "America/Sao_Paulo", label: "Brasil (UTC-3)" },
  { value: "America/New_York", label: "US Eastern (UTC-5/-4)" },
  { value: "America/Chicago", label: "US Central (UTC-6/-5)" },
  { value: "America/Denver", label: "US Mountain (UTC-7/-6)" },
  { value: "America/Los_Angeles", label: "US Pacific (UTC-8/-7)" },
  { value: "Europe/Madrid", label: "España (UTC+1/+2)" },
  { value: "Europe/London", label: "Reino Unido (UTC+0/+1)" },
];

export default function AdminBusinessConfigPage() {
  const { toast } = useToast();

  const [form, setForm] = useState<BusinessConfigData>({
    businessName: "",
    legalName: "",
    taxId: "",
    address: "",
    phone: "",
    email: "",
    legalNote: "",
    serviceTaxCategoryId: null,
    timezone: "America/Costa_Rica",
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
        timezone: config.timezone || "America/Costa_Rica",
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
              <Label htmlFor="timezone">
                <Globe className="w-3.5 h-3.5 inline mr-1" />
                Zona Horaria
              </Label>
              <Select
                value={form.timezone || "America/Costa_Rica"}
                onValueChange={(val) => setForm({ ...form, timezone: val })}
              >
                <SelectTrigger data-testid="select-timezone">
                  <SelectValue placeholder="Seleccionar zona horaria..." />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map(tz => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Define la zona horaria para fechas de negocio, reportes, planilla y cierre de caja.
              </p>
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

      <ImportInventorySection />

    </div>
  );
}

function ImportInventorySection() {
  const { toast } = useToast();
  const [result, setResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/import-initial-inventory");
      return res.json();
    },
    onSuccess: (data: { created: number; skipped: number; errors: string[] }) => {
      setResult(data);
      if (data.created > 0) {
        toast({ title: "Importación completada", description: `${data.created} insumos creados, ${data.skipped} omitidos` });
        queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      } else {
        toast({ title: "Sin cambios", description: `${data.skipped} insumos ya existían`, variant: "default" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error en importación", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-muted-foreground" />
          <div>
            <h3 className="font-semibold text-base">Importación Inicial de Inventario</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Carga los 143 insumos base del sistema (Abarrotes, Verduras, Carnes, Porciones). Operación segura — si ya existen, se omiten.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Button
          onClick={() => importMutation.mutate()}
          disabled={importMutation.isPending}
          variant="outline"
          data-testid="button-import-inventory"
        >
          {importMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Upload className="w-4 h-4 mr-2" />}
          {importMutation.isPending ? "Importando..." : "Importar Insumos Iniciales"}
        </Button>

        {result && (
          <div className="mt-4 p-3 rounded-md bg-muted text-sm space-y-1">
            <p><strong>{result.created}</strong> insumos creados</p>
            <p><strong>{result.skipped}</strong> omitidos (ya existían)</p>
            {result.errors.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-destructive font-medium">{result.errors.length} errores</summary>
                <ul className="mt-1 text-xs space-y-0.5 text-destructive">
                  {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
