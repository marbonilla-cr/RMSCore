import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Printer, Loader2, Wifi, Send } from "lucide-react";
import type { Printer as PrinterType } from "@shared/schema";

const PRINTER_TYPES = [
  { value: "caja", label: "Caja" },
  { value: "cocina", label: "Cocina" },
  { value: "bar", label: "Bar" },
  { value: "otro", label: "Otro" },
];

export default function AdminPrintersPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrinterType | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "caja",
    ipAddress: "",
    port: 9100,
    paperWidth: 80,
    enabled: true,
  });

  const { data: printersList = [], isLoading } = useQuery<PrinterType[]>({
    queryKey: ["/api/admin/printers"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) {
        return apiRequest("PATCH", `/api/admin/printers/${editing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/printers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/printers"] });
      toast({ title: editing ? "Impresora actualizada" : "Impresora creada" });
      resetForm();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/admin/printers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/printers"] });
      toast({ title: "Impresora eliminada" });
      setDeleteConfirm(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: bridgeStatus } = useQuery<{ available: boolean }>({
    queryKey: ["/api/admin/print-bridge/status"],
    refetchInterval: 10000,
  });

  const testBridgeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/print-bridge/test");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Trabajo enviado al Print Bridge" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setForm({ name: "", type: "caja", ipAddress: "", port: 9100, paperWidth: 80, enabled: true });
    setEditing(null);
    setOpen(false);
  };

  const openEdit = (printer: PrinterType) => {
    setEditing(printer);
    setForm({
      name: printer.name,
      type: printer.type,
      ipAddress: printer.ipAddress,
      port: printer.port,
      paperWidth: printer.paperWidth,
      enabled: printer.enabled,
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "El nombre es requerido", variant: "destructive" });
      return;
    }
    saveMutation.mutate(form);
  };

  const getTypeBadge = (type: string) => {
    const labels: Record<string, string> = { caja: "Caja", cocina: "Cocina", bar: "Bar", otro: "Otro" };
    return labels[type] || type;
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div className="flex items-center gap-2">
          <Printer className="w-5 h-5" />
          <h1 className="admin-page-title" data-testid="text-page-title">Impresoras</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ background: bridgeStatus?.available ? "#2ecc71" : "#e74c3c" }}
              data-testid="indicator-bridge-status"
            />
            <span className="text-sm" data-testid="text-bridge-status">
              {bridgeStatus?.available ? "Print Bridge conectado" : "Print Bridge desconectado"}
            </span>
          </div>
          <Button
            onClick={() => testBridgeMutation.mutate()}
            disabled={testBridgeMutation.isPending}
            className="bg-green-600 hover:bg-green-700 text-white"
            data-testid="button-test-bridge"
          >
            {testBridgeMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Probar Impresión
          </Button>
        </div>

        <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); setOpen(o); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-printer">
              <Plus className="w-4 h-4 mr-2" />
              Agregar Impresora
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Impresora" : "Nueva Impresora"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="printerName">Nombre</Label>
                <Input
                  id="printerName"
                  data-testid="input-printer-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Impresora Caja Principal"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="printerType">Tipo</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger data-testid="select-printer-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRINTER_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="ipAddress">Dirección IP</Label>
                  <Input
                    id="ipAddress"
                    data-testid="input-ip-address"
                    value={form.ipAddress}
                    onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
                    placeholder="192.168.0.200"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="port">Puerto</Label>
                  <Input
                    id="port"
                    data-testid="input-port"
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 9100 })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="paperWidth">Ancho de Papel (mm)</Label>
                <Select value={String(form.paperWidth)} onValueChange={(v) => setForm({ ...form, paperWidth: parseInt(v) })}>
                  <SelectTrigger data-testid="select-paper-width">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58">58 mm</SelectItem>
                    <SelectItem value="80">80 mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  id="enabled"
                  data-testid="switch-enabled"
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                />
                <Label htmlFor="enabled">Activa</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm} data-testid="button-cancel">
                  Cancelar
                </Button>
                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-printer">
                  {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  {editing ? "Guardar" : "Crear"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i}><CardContent className="p-4"><div className="h-12 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : printersList.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Printer className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p>No hay impresoras configuradas</p>
            <p className="text-sm mt-1">Agregue una impresora para habilitar la impresión de tiquetes</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {printersList.map((printer) => (
            <Card key={printer.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${printer.enabled ? "" : "bg-muted-foreground"}`} style={printer.enabled ? { background: 'var(--sage)' } : undefined} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium" data-testid={`text-printer-name-${printer.id}`}>{printer.name}</span>
                        <Badge variant="secondary" data-testid={`badge-printer-type-${printer.id}`}>
                          {getTypeBadge(printer.type)}
                        </Badge>
                        {!printer.enabled && <Badge variant="outline">Inactiva</Badge>}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                        <Wifi className="w-3 h-3" />
                        <span data-testid={`text-printer-ip-${printer.id}`}>
                          {printer.ipAddress || "Sin IP"}{printer.ipAddress ? `:${printer.port}` : ""}
                        </span>
                        <span className="mx-1">·</span>
                        <span>{printer.paperWidth}mm</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => openEdit(printer)}
                      data-testid={`button-edit-printer-${printer.id}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    {deleteConfirm === printer.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteMutation.mutate(printer.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-confirm-delete-${printer.id}`}
                        >
                          Eliminar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDeleteConfirm(null)}
                          data-testid={`button-cancel-delete-${printer.id}`}
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteConfirm(printer.id)}
                        data-testid={`button-delete-printer-${printer.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
