import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, MapPin } from "lucide-react";

interface GraceByDay {
  mon: number; tue: number; wed: number; thu: number; fri: number; sat: number; sun: number;
}

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
  paidStartPolicy: string;
  overtimeRequiresApproval: boolean;
  ignoreZeroDurationPunches: boolean;
  mergeOverlappingPunches: boolean;
  breakDeductEnabled: boolean;
  breakThresholdMinutes: number;
  breakDeductMinutes: number;
  socialChargesEnabled: boolean;
  ccssEmployeeRate: number;
  ccssEmployerRate: number;
  ccssIncludeService: boolean;
  autoClockoutGraceByDay?: GraceByDay;
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
  paidStartPolicy: "SCHEDULE_START_CAP",
  overtimeRequiresApproval: true,
  ignoreZeroDurationPunches: true,
  mergeOverlappingPunches: true,
  breakDeductEnabled: true,
  breakThresholdMinutes: 540,
  breakDeductMinutes: 60,
  socialChargesEnabled: false,
  ccssEmployeeRate: 10.67,
  ccssEmployerRate: 26.33,
  ccssIncludeService: false,
};

const DEFAULT_GRACE: GraceByDay = { mon: 30, tue: 30, wed: 30, thu: 30, fri: 30, sat: 30, sun: 30 };

const DAYS_DISPLAY: { key: keyof GraceByDay; label: string }[] = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

export default function HrSettingsPage() {
  const { toast } = useToast();
  const [values, setValues] = useState<HrSettings>(defaultSettings);
  const [graceByDay, setGraceByDay] = useState<GraceByDay>(DEFAULT_GRACE);

  const { data, isLoading } = useQuery<HrSettings>({
    queryKey: ["/api/hr/settings"],
  });

  useEffect(() => {
    if (data) {
      setValues(data);
      if (data.autoClockoutGraceByDay) {
        setGraceByDay(data.autoClockoutGraceByDay);
      }
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
    mutation.mutate({ ...values, autoClockoutGraceByDay: graceByDay });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8" data-testid="loading-settings">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="admin-page">
      <h1 className="admin-page-title" data-testid="text-settings-title">Configuración HR</h1>

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

          <Button
            variant="outline"
            data-testid="button-use-location"
            onClick={useCurrentLocation}
            className="w-full"
          >
            <MapPin className="mr-2 h-4 w-4" />
            Usar mi ubicaci\u00f3n actual
          </Button>

          {(typeof values.businessLat === 'number' && typeof values.businessLng === 'number') && (values.businessLat !== 0 || values.businessLng !== 0) ? (
            <div className="rounded-md border p-3 text-sm text-muted-foreground" data-testid="text-location-coords">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--sage)' }} />
                <span>Ubicaci\u00f3n configurada: {Number(values.businessLat).toFixed(6)}, {Number(values.businessLng).toFixed(6)}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-location">
              No hay ubicaci\u00f3n configurada. Presione el bot\u00f3n para usar su GPS.
            </p>
          )}

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

      <Card>
        <CardHeader>
          <CardTitle>Cálculo de Planilla</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="paidStartPolicy">Política de inicio pagado</Label>
            <Select
              value={values.paidStartPolicy}
              onValueChange={(v) => handleChange("paidStartPolicy", v)}
            >
              <SelectTrigger data-testid="select-paidStartPolicy">
                <SelectValue placeholder="Seleccionar política..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SCHEDULE_START_CAP">Tope al inicio del horario</SelectItem>
                <SelectItem value="ACTUAL_CLOCKIN">Hora real de entrada</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {values.paidStartPolicy === "SCHEDULE_START_CAP"
                ? "Si el empleado llega antes del horario, el pago inicia desde la hora programada (no antes)."
                : "El pago inicia desde la hora real de entrada del empleado, incluso si llega antes del horario."}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-0.5">
              <Label htmlFor="overtimeRequiresApproval">Extras requieren aprobación</Label>
              <p className="text-xs text-muted-foreground">Si está activo, las horas extra calculadas no se pagan hasta ser aprobadas.</p>
            </div>
            <Switch
              id="overtimeRequiresApproval"
              data-testid="switch-overtimeRequiresApproval"
              checked={values.overtimeRequiresApproval}
              onCheckedChange={(v) => handleChange("overtimeRequiresApproval", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-0.5">
              <Label htmlFor="ignoreZeroDurationPunches">Filtrar marcas de 0 duración</Label>
              <p className="text-xs text-muted-foreground">Ignora punches donde entrada y salida son iguales (punches basura).</p>
            </div>
            <Switch
              id="ignoreZeroDurationPunches"
              data-testid="switch-ignoreZeroDurationPunches"
              checked={values.ignoreZeroDurationPunches}
              onCheckedChange={(v) => handleChange("ignoreZeroDurationPunches", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-0.5">
              <Label htmlFor="mergeOverlappingPunches">Fusionar marcas traslapadas</Label>
              <p className="text-xs text-muted-foreground">Combina punches que se superponen o tienen gap menor a 1 minuto.</p>
            </div>
            <Switch
              id="mergeOverlappingPunches"
              data-testid="switch-mergeOverlappingPunches"
              checked={values.mergeOverlappingPunches}
              onCheckedChange={(v) => handleChange("mergeOverlappingPunches", v)}
            />
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-0.5">
              <Label htmlFor="breakDeductEnabled">Descanso no pagado</Label>
              <p className="text-xs text-muted-foreground">Descuenta tiempo de descanso del ordinario cuando el turno supera el umbral.</p>
            </div>
            <Switch
              id="breakDeductEnabled"
              data-testid="switch-breakDeductEnabled"
              checked={values.breakDeductEnabled}
              onCheckedChange={(v) => handleChange("breakDeductEnabled", v)}
            />
          </div>

          {values.breakDeductEnabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-4 border-l-2 border-muted">
              <div className="space-y-1">
                <Label htmlFor="breakThresholdMinutes">Umbral para descanso (minutos)</Label>
                <Input
                  id="breakThresholdMinutes"
                  data-testid="input-breakThresholdMinutes"
                  type="number"
                  value={values.breakThresholdMinutes}
                  onChange={(e) => handleNumberChange("breakThresholdMinutes", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Si el turno total supera estos minutos, se descuenta el descanso. (540 = 9 horas)</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="breakDeductMinutes">Minutos de descanso a descontar</Label>
                <Input
                  id="breakDeductMinutes"
                  data-testid="input-breakDeductMinutes"
                  type="number"
                  value={values.breakDeductMinutes}
                  onChange={(e) => handleNumberChange("breakDeductMinutes", e.target.value)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CCSS / Cargas Sociales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="space-y-0.5">
              <Label htmlFor="socialChargesEnabled">Cargas sociales habilitadas</Label>
              <p className="text-xs text-muted-foreground">Calcula CCSS (empleado y patrono) en la planilla.</p>
            </div>
            <Switch
              id="socialChargesEnabled"
              data-testid="switch-socialChargesEnabled"
              checked={values.socialChargesEnabled}
              onCheckedChange={(v) => handleChange("socialChargesEnabled", v)}
            />
          </div>

          {values.socialChargesEnabled && (
            <div className="space-y-4 pl-4 border-l-2 border-muted">
              <div className="space-y-1">
                <Label htmlFor="ccssEmployeeRate">Tasa CCSS empleado (%)</Label>
                <Input
                  id="ccssEmployeeRate"
                  data-testid="input-ccssEmployeeRate"
                  type="number"
                  step="0.01"
                  value={values.ccssEmployeeRate}
                  onChange={(e) => handleNumberChange("ccssEmployeeRate", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Porcentaje que se deduce del salario bruto del empleado.</p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="ccssEmployerRate">Tasa CCSS patrono (%)</Label>
                <Input
                  id="ccssEmployerRate"
                  data-testid="input-ccssEmployerRate"
                  type="number"
                  step="0.01"
                  value={values.ccssEmployerRate}
                  onChange={(e) => handleNumberChange("ccssEmployerRate", e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Porcentaje de carga patronal sobre el salario bruto.</p>
              </div>

              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="space-y-0.5">
                  <Label htmlFor="ccssIncludeService">Incluir servicio en base CCSS</Label>
                  <p className="text-xs text-muted-foreground">Se aplicará cuando el cargo por servicio esté integrado en la planilla.</p>
                </div>
                <Switch
                  id="ccssIncludeService"
                  data-testid="switch-ccssIncludeService"
                  checked={values.ccssIncludeService}
                  onCheckedChange={(v) => handleChange("ccssIncludeService", v)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-salida por día</CardTitle>
          <p className="text-sm text-muted-foreground">
            Minutos de gracia después del fin de turno antes del clock-out automático.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
            {DAYS_DISPLAY.map(d => (
              <div key={d.key} className="flex flex-col gap-1">
                <Label className="text-xs font-semibold text-muted-foreground">{d.label}</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    max={240}
                    data-testid={`input-grace-${d.key}`}
                    value={graceByDay[d.key] ?? 30}
                    onChange={e => setGraceByDay(p => ({
                      ...p, [d.key]: Math.max(0, parseInt(e.target.value) || 0)
                    }))}
                    className="w-full"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </div>
            ))}
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
