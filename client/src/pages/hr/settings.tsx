import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin } from "lucide-react";

interface HrSettings {
  geoEnforcementEnabled: boolean;
  businessLat: number;
  businessLng: number;
  geoRadiusMeters: number;
  geoAccuracyMaxMeters: number;
  geoRequiredForClockin: boolean;
  geoRequiredForClockout: boolean;
  overtimeDailyThresholdHours: number;
  overtimeWeeklyThresholdHours: number;
  overtimeMultiplier: number;
  latenessGraceMinutes: number;
  autoLogoutAfterShiftHours: number;
  serviceChargeRate: number;
  lateAlertEmailTo: string;
}

const defaultSettings: HrSettings = {
  geoEnforcementEnabled: false,
  businessLat: 0,
  businessLng: 0,
  geoRadiusMeters: 100,
  geoAccuracyMaxMeters: 50,
  geoRequiredForClockin: true,
  geoRequiredForClockout: false,
  overtimeDailyThresholdHours: 8,
  overtimeWeeklyThresholdHours: 48,
  overtimeMultiplier: 1.5,
  latenessGraceMinutes: 5,
  autoLogoutAfterShiftHours: 12,
  serviceChargeRate: 0.1,
  lateAlertEmailTo: "",
};

export default function HrSettingsPage() {
  const { toast } = useToast();
  const [values, setValues] = useState<HrSettings>(defaultSettings);

  const { data, isLoading } = useQuery<HrSettings>({
    queryKey: ["/api/hr/settings"],
  });

  useEffect(() => {
    if (data) {
      setValues(data);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: async (vals: HrSettings) => {
      await apiRequest("PUT", "/api/hr/settings", vals);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/settings"] });
      toast({ title: "Configuración guardada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    },
  });

  function handleChange(field: keyof HrSettings, value: number | string | boolean) {
    setValues((prev) => ({ ...prev, [field]: value }));
  }

  function handleNumberChange(field: keyof HrSettings, raw: string) {
    const num = parseFloat(raw);
    if (!isNaN(num)) {
      handleChange(field, num);
    }
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast({ title: "Geolocalización no disponible", variant: "destructive" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValues((prev) => ({
          ...prev,
          businessLat: pos.coords.latitude,
          businessLng: pos.coords.longitude,
        }));
        toast({ title: "Ubicación obtenida" });
      },
      (err) => {
        toast({ title: "Error de ubicación", description: err.message, variant: "destructive" });
      }
    );
  }

  function handleSave() {
    mutation.mutate(values);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8" data-testid="loading-settings">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold" data-testid="text-settings-title">Configuración HR</h1>

      <Card>
        <CardHeader>
          <CardTitle>Geofence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label htmlFor="geoEnforcementEnabled">Geofence habilitado</Label>
            <Switch
              id="geoEnforcementEnabled"
              data-testid="switch-geoEnforcementEnabled"
              checked={values.geoEnforcementEnabled}
              onCheckedChange={(v) => handleChange("geoEnforcementEnabled", v)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="businessLat">Latitud</Label>
              <Input
                id="businessLat"
                data-testid="input-businessLat"
                type="number"
                step="any"
                value={values.businessLat}
                onChange={(e) => handleNumberChange("businessLat", e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="businessLng">Longitud</Label>
              <Input
                id="businessLng"
                data-testid="input-businessLng"
                type="number"
                step="any"
                value={values.businessLng}
                onChange={(e) => handleNumberChange("businessLng", e.target.value)}
              />
            </div>
          </div>

          <Button
            variant="outline"
            data-testid="button-use-location"
            onClick={useCurrentLocation}
          >
            <MapPin className="mr-2 h-4 w-4" />
            Usar mi ubicación actual
          </Button>

          <div className="space-y-1">
            <Label htmlFor="geoRadiusMeters">Radio permitido (metros)</Label>
            <Input
              id="geoRadiusMeters"
              data-testid="input-geoRadiusMeters"
              type="number"
              value={values.geoRadiusMeters}
              onChange={(e) => handleNumberChange("geoRadiusMeters", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="geoAccuracyMaxMeters">Precisión máxima GPS (metros)</Label>
            <Input
              id="geoAccuracyMaxMeters"
              data-testid="input-geoAccuracyMaxMeters"
              type="number"
              value={values.geoAccuracyMaxMeters}
              onChange={(e) => handleNumberChange("geoAccuracyMaxMeters", e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label htmlFor="geoRequiredForClockin">Requerido para entrada</Label>
            <Switch
              id="geoRequiredForClockin"
              data-testid="switch-geoRequiredForClockin"
              checked={values.geoRequiredForClockin}
              onCheckedChange={(v) => handleChange("geoRequiredForClockin", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label htmlFor="geoRequiredForClockout">Requerido para salida</Label>
            <Switch
              id="geoRequiredForClockout"
              data-testid="switch-geoRequiredForClockout"
              checked={values.geoRequiredForClockout}
              onCheckedChange={(v) => handleChange("geoRequiredForClockout", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horas Extra y Tardías</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="overtimeDailyThresholdHours">Umbral diario (horas)</Label>
            <Input
              id="overtimeDailyThresholdHours"
              data-testid="input-overtimeDailyThresholdHours"
              type="number"
              step="any"
              value={values.overtimeDailyThresholdHours}
              onChange={(e) => handleNumberChange("overtimeDailyThresholdHours", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="overtimeWeeklyThresholdHours">Umbral semanal (horas)</Label>
            <Input
              id="overtimeWeeklyThresholdHours"
              data-testid="input-overtimeWeeklyThresholdHours"
              type="number"
              step="any"
              value={values.overtimeWeeklyThresholdHours}
              onChange={(e) => handleNumberChange("overtimeWeeklyThresholdHours", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="overtimeMultiplier">Multiplicador extras</Label>
            <Input
              id="overtimeMultiplier"
              data-testid="input-overtimeMultiplier"
              type="number"
              step="any"
              value={values.overtimeMultiplier}
              onChange={(e) => handleNumberChange("overtimeMultiplier", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="latenessGraceMinutes">Gracia para tardía (minutos)</Label>
            <Input
              id="latenessGraceMinutes"
              data-testid="input-latenessGraceMinutes"
              type="number"
              value={values.latenessGraceMinutes}
              onChange={(e) => handleNumberChange("latenessGraceMinutes", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="autoLogoutAfterShiftHours">Auto-logout después de turno (horas)</Label>
            <Input
              id="autoLogoutAfterShiftHours"
              data-testid="input-autoLogoutAfterShiftHours"
              type="number"
              step="any"
              value={values.autoLogoutAfterShiftHours}
              onChange={(e) => handleNumberChange("autoLogoutAfterShiftHours", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cargo por Servicio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="serviceChargeRate">Tasa de servicio</Label>
            <Input
              id="serviceChargeRate"
              data-testid="input-serviceChargeRate"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={values.serviceChargeRate}
              onChange={(e) => handleNumberChange("serviceChargeRate", e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="lateAlertEmailTo">Email alerta tardías</Label>
            <Input
              id="lateAlertEmailTo"
              data-testid="input-lateAlertEmailTo"
              type="text"
              value={values.lateAlertEmailTo}
              onChange={(e) => handleChange("lateAlertEmailTo", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Button
        className="w-full"
        data-testid="button-save-settings"
        onClick={handleSave}
        disabled={mutation.isPending}
      >
        {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar Configuración
      </Button>
    </div>
  );
}
