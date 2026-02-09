import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, Building2, Loader2 } from "lucide-react";

interface BusinessConfigData {
  id?: number;
  businessName: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
  legalNote: string;
}

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
  });

  const { data: config, isLoading } = useQuery<BusinessConfigData>({
    queryKey: ["/api/admin/business-config"],
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
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Building2 className="w-5 h-5" />
        <h1 className="text-xl font-bold" data-testid="text-page-title">Configuración del Negocio</h1>
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
    </div>
  );
}
