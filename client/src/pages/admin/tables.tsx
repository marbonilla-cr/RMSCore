import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, QrCode, Grid3x3, Loader2, ExternalLink, Download, Clock, Save, Settings2 } from "lucide-react";
import type { Table as RestTable, ReservationDurationConfig, ReservationSettings } from "@shared/schema";

export default function AdminTablesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RestTable | null>(null);
  const [form, setForm] = useState({ tableCode: "", tableName: "", active: true, sortOrder: 0, capacity: 4 });

  const { data: tables = [], isLoading } = useQuery<RestTable[]>({
    queryKey: ["/api/admin/tables"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) {
        return apiRequest("PATCH", `/api/admin/tables/${editing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/tables", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tables"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Mesa actualizada" : "Mesa creada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ tableCode: "", tableName: "", active: true, sortOrder: 0, capacity: 4 });
    setOpen(true);
  };

  const openEdit = (table: RestTable) => {
    setEditing(table);
    setForm({
      tableCode: table.tableCode,
      tableName: table.tableName,
      active: table.active,
      sortOrder: table.sortOrder,
      capacity: table.capacity,
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
            <Grid3x3 className="w-6 h-6" />
            Administrar Mesas
          </h1>
          <p className="admin-page-sub">Gestione las mesas del restaurante y sus códigos QR</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-table">
              <Plus className="w-4 h-4" />
              <span className="ml-1">Nueva Mesa</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Mesa" : "Nueva Mesa"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Código de Mesa</Label>
                <Input
                  data-testid="input-table-code"
                  value={form.tableCode}
                  onChange={(e) => setForm({ ...form, tableCode: e.target.value })}
                  placeholder="M01"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  data-testid="input-table-name"
                  value={form.tableName}
                  onChange={(e) => setForm({ ...form, tableName: e.target.value })}
                  placeholder="Mesa 1"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Orden</Label>
                  <Input
                    type="number"
                    data-testid="input-table-sort"
                    value={form.sortOrder}
                    onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Capacidad</Label>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    data-testid="input-table-capacity"
                    value={form.capacity}
                    onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 4 })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  data-testid="switch-table-active"
                  checked={form.active}
                  onCheckedChange={(c) => setForm({ ...form, active: c })}
                />
                <Label>Activa</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-table">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Mesa"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : tables.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Grid3x3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay mesas configuradas</p>
            <Button variant="outline" className="mt-4" onClick={openCreate} data-testid="button-add-table-empty">
              <Plus className="w-4 h-4 mr-1" />
              Crear primera mesa
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tables.map((table) => (
            <Card key={table.id} data-testid={`card-table-${table.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-3 min-h-[48px]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                    <Grid3x3 className="w-4 h-4 text-accent-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{table.tableName}</p>
                    <p className="text-xs text-muted-foreground">Código: {table.tableCode} · Cap. {table.capacity}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={table.active ? "default" : "secondary"}>
                    {table.active ? "Activa" : "Inactiva"}
                  </Badge>
                  <Button size="icon" variant="ghost" onClick={() => window.open(`/qr/${table.tableCode}`, '_blank')} data-testid={`button-open-qr-client-${table.id}`} title="Abrir UI Cliente">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => window.open(`/api/admin/tables/${table.id}/qr`, '_blank')} data-testid={`button-qr-${table.id}`} title="Ver QR">
                    <QrCode className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => {
                    const a = document.createElement("a");
                    a.href = `/api/admin/tables/${table.id}/qr.png`;
                    a.download = `QR-${table.tableName}.png`;
                    a.click();
                  }} data-testid={`button-download-qr-${table.id}`} title="Descargar QR PNG">
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(table)} data-testid={`button-edit-table-${table.id}`} title="Editar">
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DurationConfigSection />
      <ReservationSettingsSection />
    </div>
  );
}

function DurationConfigSection() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<{ minPartySize: number; maxPartySize: number; durationMinutes: number }[]>([
    { minPartySize: 1, maxPartySize: 2, durationMinutes: 60 },
    { minPartySize: 3, maxPartySize: 4, durationMinutes: 90 },
    { minPartySize: 5, maxPartySize: 8, durationMinutes: 120 },
    { minPartySize: 9, maxPartySize: 99, durationMinutes: 150 },
  ]);

  const { data: savedConfigs = [] } = useQuery<ReservationDurationConfig[]>({
    queryKey: ["/api/reservations/duration-config"],
  });

  useEffect(() => {
    if (savedConfigs.length > 0) {
      setConfigs(savedConfigs.map(c => ({ minPartySize: c.minPartySize, maxPartySize: c.maxPartySize, durationMinutes: c.durationMinutes })));
    }
  }, [savedConfigs]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", "/api/reservations/duration-config", { configs });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/duration-config"] });
      toast({ title: "Configuración de duración guardada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateConfig = (index: number, field: string, value: number) => {
    setConfigs(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const addRow = () => {
    const last = configs[configs.length - 1];
    setConfigs([...configs, { minPartySize: (last?.maxPartySize || 0) + 1, maxPartySize: (last?.maxPartySize || 0) + 4, durationMinutes: 90 }]);
  };

  const removeRow = (index: number) => {
    if (configs.length <= 1) return;
    setConfigs(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <Card className="mt-6" data-testid="card-duration-config">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5" />
          <h2 className="text-base font-semibold">Duración por Tamaño de Grupo</h2>
        </div>
        <p className="text-xs text-muted-foreground">Define la duración de reserva según la cantidad de personas</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {configs.map((c, i) => (
          <div key={i} className="flex items-center gap-2" data-testid={`row-duration-${i}`}>
            <Input
              type="number" min={1} className="w-16" value={c.minPartySize}
              onChange={e => updateConfig(i, "minPartySize", parseInt(e.target.value) || 1)}
              data-testid={`input-min-party-${i}`}
            />
            <span className="text-xs text-muted-foreground">a</span>
            <Input
              type="number" min={1} className="w-16" value={c.maxPartySize}
              onChange={e => updateConfig(i, "maxPartySize", parseInt(e.target.value) || 1)}
              data-testid={`input-max-party-${i}`}
            />
            <span className="text-xs text-muted-foreground">personas →</span>
            <Input
              type="number" min={15} step={15} className="w-20" value={c.durationMinutes}
              onChange={e => updateConfig(i, "durationMinutes", parseInt(e.target.value) || 60)}
              data-testid={`input-duration-${i}`}
            />
            <span className="text-xs text-muted-foreground">min</span>
            {configs.length > 1 && (
              <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => removeRow(i)} data-testid={`button-remove-duration-${i}`}>
                ✕
              </Button>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow} data-testid="button-add-duration">
            <Plus className="w-3 h-3 mr-1" /> Agregar rango
          </Button>
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-duration">
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReservationSettingsSection() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    openTime: "11:00",
    closeTime: "22:00",
    slotIntervalMinutes: 30,
    maxOccupancyPercent: 50,
    turnoverBufferMinutes: 15,
    enabled: true,
  });

  const { data: settings, isLoading: settingsLoading } = useQuery<ReservationSettings>({
    queryKey: ["/api/reservations/settings"],
  });

  useEffect(() => {
    if (settings) {
      setForm({
        openTime: settings.openTime,
        closeTime: settings.closeTime,
        slotIntervalMinutes: settings.slotIntervalMinutes,
        maxOccupancyPercent: settings.maxOccupancyPercent,
        turnoverBufferMinutes: settings.turnoverBufferMinutes,
        enabled: settings.enabled,
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PUT", "/api/reservations/settings", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/reservations/settings"] });
      toast({ title: "Configuración de reservas guardada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Card className="mt-6" data-testid="card-reservation-settings">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5" />
            <h2 className="text-base font-semibold">Configuración de Reservas</h2>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="res-enabled" className="text-xs text-muted-foreground">Sistema activo</Label>
            <Switch
              id="res-enabled"
              checked={form.enabled}
              onCheckedChange={(c) => setForm({ ...form, enabled: c })}
              data-testid="switch-reservations-enabled"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Horario de operación, intervalos y límites diarios para reservas</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {settingsLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : <>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Hora Apertura</Label>
            <Input
              type="time"
              value={form.openTime}
              onChange={(e) => setForm({ ...form, openTime: e.target.value })}
              data-testid="input-open-time"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hora Cierre</Label>
            <Input
              type="time"
              value={form.closeTime}
              onChange={(e) => setForm({ ...form, closeTime: e.target.value })}
              data-testid="input-close-time"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Intervalo Slots (min)</Label>
            <Input
              type="number"
              min={15}
              step={15}
              value={form.slotIntervalMinutes}
              onChange={(e) => setForm({ ...form, slotIntervalMinutes: parseInt(e.target.value) || 30 })}
              data-testid="input-slot-interval"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">% Ocupación Reservas</Label>
            <Input
              type="number"
              min={10}
              max={100}
              step={5}
              value={form.maxOccupancyPercent}
              onChange={(e) => setForm({ ...form, maxOccupancyPercent: parseInt(e.target.value) || 50 })}
              data-testid="input-occupancy-percent"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Buffer Mesa (min)</Label>
            <Input
              type="number"
              min={0}
              step={5}
              value={form.turnoverBufferMinutes}
              onChange={(e) => setForm({ ...form, turnoverBufferMinutes: parseInt(e.target.value) || 15 })}
              data-testid="input-buffer-minutes"
            />
          </div>
        </div>
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-settings">
          {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
          Guardar Configuración
        </Button>
        </>}
      </CardContent>
    </Card>
  );
}
