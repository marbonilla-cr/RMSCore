import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Shield, AlertTriangle, Check, XCircle, ExternalLink, FileSearch, Loader2 } from "lucide-react";

interface AuditAlert {
  id: number;
  alertType: string;
  severity: string;
  invItemId: number | null;
  shortageId: number | null;
  message: string;
  status: string;
  createdAt: string;
  createdByEmployeeId: number | null;
  ackByEmployeeId: number | null;
  ackAt: string | null;
  closedByEmployeeId: number | null;
  closedAt: string | null;
  notes: string | null;
}

interface InvItem {
  id: number;
  name: string;
}

function severityBadge(severity: string) {
  switch (severity) {
    case "HIGH":
      return <Badge variant="destructive" data-testid="badge-severity-high">Alta</Badge>;
    case "MEDIUM":
      return <Badge className="bg-amber-500 text-white" data-testid="badge-severity-medium">Media</Badge>;
    default:
      return <Badge variant="secondary" data-testid="badge-severity-low">Baja</Badge>;
  }
}

function alertTypeBadge(alertType: string) {
  const label = alertType === "SHORTAGE_DISCREPANCY" ? "Discrepancia de stock" : alertType;
  return <Badge variant="outline" data-testid="badge-alert-type">{label}</Badge>;
}

function statusBadge(status: string) {
  switch (status) {
    case "OPEN":
      return <Badge variant="destructive" data-testid="badge-status-open">Abierta</Badge>;
    case "ACK":
      return <Badge className="bg-amber-500 text-white" data-testid="badge-status-ack">Reconocida</Badge>;
    case "CLOSED":
      return <Badge className="bg-green-600 text-white" data-testid="badge-status-closed">Cerrada</Badge>;
    default:
      return <Badge variant="secondary" data-testid="badge-status-other">{status}</Badge>;
  }
}

export default function AuditPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("OPEN");
  const [ackDialogOpen, setAckDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null);
  const [ackNotes, setAckNotes] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const { data: alerts, isLoading, error } = useQuery<AuditAlert[]>({
    queryKey: ["/api/audit-alerts"],
  });

  const { data: items } = useQuery<InvItem[]>({
    queryKey: ["/api/shortages/inv-items"],
  });

  const itemMap = useMemo(() => {
    const map = new Map<number, string>();
    if (items) {
      for (const item of items) {
        map.set(item.id, item.name);
      }
    }
    return map;
  }, [items]);

  const filtered = useMemo(() => {
    if (!alerts) return [];
    if (tab === "ALL") return alerts;
    return alerts.filter((a) => a.status === tab);
  }, [alerts, tab]);

  const ackMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes?: string }) => {
      await apiRequest("PATCH", `/api/audit-alerts/${id}/ack`, { notes: notes || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/audit-alerts"] });
      toast({ title: "Alerta reconocida" });
      setAckDialogOpen(false);
      setAckNotes("");
      setSelectedAlertId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      await apiRequest("PATCH", `/api/audit-alerts/${id}/close`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/audit-alerts"] });
      toast({ title: "Alerta cerrada" });
      setCloseDialogOpen(false);
      setCloseNotes("");
      setSelectedAlertId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const is403 = error && (error as Error).message?.includes("403");

  if (is403) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <Card>
          <CardContent className="p-8 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground" data-testid="text-no-permission">
              No tiene permisos para ver esta seccion
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg" data-testid="text-page-title">
            <div className="flex items-center gap-2 flex-wrap">
              <Shield className="h-5 w-5" />
              Auditoria de Faltantes
            </div>
          </CardTitle>
          <CardDescription data-testid="text-page-description">
            Muestra discrepancias entre los faltantes reportados y el inventario del sistema.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full" data-testid="tabs-filter">
              <TabsTrigger value="OPEN" className="flex-1" data-testid="tab-open">Abiertas</TabsTrigger>
              <TabsTrigger value="ACK" className="flex-1" data-testid="tab-ack">Reconocidas</TabsTrigger>
              <TabsTrigger value="CLOSED" className="flex-1" data-testid="tab-closed">Cerradas</TabsTrigger>
              <TabsTrigger value="ALL" className="flex-1" data-testid="tab-all">Todas</TabsTrigger>
            </TabsList>

            {["OPEN", "ACK", "CLOSED", "ALL"].map((tabValue) => (
              <TabsContent key={tabValue} value={tabValue} className="mt-4 space-y-3">
                {filtered.length === 0 && (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-empty">
                    No hay alertas en esta categoria
                  </p>
                )}
                {filtered.map((alert) => (
                  <Card key={alert.id} data-testid={`card-alert-${alert.id}`}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        {severityBadge(alert.severity)}
                        {alertTypeBadge(alert.alertType)}
                        {statusBadge(alert.status)}
                      </div>

                      <p className="text-sm" data-testid={`text-message-${alert.id}`}>
                        {alert.message}
                      </p>

                      {alert.invItemId && (
                        <p className="text-xs text-muted-foreground" data-testid={`text-item-${alert.id}`}>
                          Insumo: {itemMap.get(alert.invItemId) || `#${alert.invItemId}`}
                        </p>
                      )}

                      <p className="text-xs text-muted-foreground" data-testid={`text-created-${alert.id}`}>
                        Creado: {new Date(alert.createdAt).toLocaleString("es-MX")}
                      </p>

                      {alert.notes && (
                        <p className="text-xs text-muted-foreground italic" data-testid={`text-notes-${alert.id}`}>
                          Notas: {alert.notes}
                        </p>
                      )}

                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        {alert.status === "OPEN" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedAlertId(alert.id);
                              setAckNotes("");
                              setAckDialogOpen(true);
                            }}
                            data-testid={`button-ack-${alert.id}`}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Reconocer
                          </Button>
                        )}

                        {(alert.status === "OPEN" || alert.status === "ACK") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedAlertId(alert.id);
                              setCloseNotes("");
                              setCloseDialogOpen(true);
                            }}
                            data-testid={`button-close-${alert.id}`}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Cerrar
                          </Button>
                        )}

                        {alert.invItemId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/inventory/items/${alert.invItemId}`)}
                            data-testid={`link-kardex-${alert.id}`}
                          >
                            <FileSearch className="h-4 w-4 mr-1" />
                            Ver Kardex
                          </Button>
                        )}

                        {alert.shortageId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate("/shortages/active")}
                            data-testid={`link-shortage-${alert.id}`}
                          >
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Ver Faltante
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={ackDialogOpen} onOpenChange={setAckDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="text-ack-dialog-title">Reconocer Alerta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Puede agregar notas opcionales al reconocer esta alerta.
            </p>
            <Textarea
              placeholder="Notas (opcional)"
              value={ackNotes}
              onChange={(e) => setAckNotes(e.target.value)}
              data-testid="input-ack-notes"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setAckDialogOpen(false)}
              data-testid="button-ack-cancel"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (selectedAlertId !== null) {
                  ackMutation.mutate({ id: selectedAlertId, notes: ackNotes || undefined });
                }
              }}
              disabled={ackMutation.isPending}
              data-testid="button-ack-confirm"
            >
              {ackMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="text-close-dialog-title">Cerrar Alerta</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Debe agregar una nota obligatoria para cerrar esta alerta.
            </p>
            <Textarea
              placeholder="Notas (obligatorio)"
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              data-testid="input-close-notes"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setCloseDialogOpen(false)}
              data-testid="button-close-cancel"
            >
              Cancelar
            </Button>
            <Button
              onClick={() => {
                if (!closeNotes.trim()) {
                  toast({ title: "Error", description: "La nota es obligatoria", variant: "destructive" });
                  return;
                }
                if (selectedAlertId !== null) {
                  closeMutation.mutate({ id: selectedAlertId, notes: closeNotes });
                }
              }}
              disabled={closeMutation.isPending || !closeNotes.trim()}
              data-testid="button-close-confirm"
            >
              {closeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Cerrar Alerta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
