import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
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
import {
  AlertTriangle,
  Check,
  CheckCircle,
  XCircle,
  Clock,
  Copy,
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
  ShoppingCart,
  Shield,
} from "lucide-react";

interface Shortage {
  id: number;
  entityType: string;
  invItemId: number | null;
  menuProductId: number | null;
  status: string;
  priority: string;
  severityReport: string;
  reportedByEmployeeId: number;
  reportedAt: string;
  notes: string | null;
  reportCount: number;
  lastReportedAt: string;
  suggestedPurchaseQtyBase: string | null;
  systemOnHandQtyBaseSnapshot: string | null;
  systemAvgCostSnapshot: string | null;
  auditFlag: boolean;
  auditReason: string | null;
  auditStatus: string;
  acknowledgedByEmployeeId: number | null;
  acknowledgedAt: string | null;
  resolvedByEmployeeId: number | null;
  resolvedAt: string | null;
  closedByEmployeeId: number | null;
  closedAt: string | null;
  reportedByName: string | null;
  createdAt: string;
}

interface InvItem {
  id: number;
  name: string;
}

interface Product {
  id: number;
  name: string;
}

interface ShortageEvent {
  id: number;
  shortageId: number;
  eventType: string;
  actorEmployeeId: number | null;
  message: string | null;
  createdAt: string;
}

function statusBadge(status: string) {
  switch (status) {
    case "OPEN":
      return <Badge variant="destructive" data-testid="badge-status-open">Abierto</Badge>;
    case "ACKNOWLEDGED":
      return <Badge className="bg-amber-500 text-white" data-testid="badge-status-ack">Reconocido</Badge>;
    case "RESOLVED":
      return <Badge className="bg-green-600 text-white" data-testid="badge-status-resolved">Resuelto</Badge>;
    case "CLOSED":
      return <Badge variant="secondary" data-testid="badge-status-closed">Cerrado</Badge>;
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function severityBadge(severity: string) {
  switch (severity) {
    case "LOW_STOCK":
      return <Badge className="bg-amber-500 text-white" data-testid="badge-severity-low">Poco Stock</Badge>;
    case "NO_STOCK":
      return <Badge variant="destructive" data-testid="badge-severity-no">Sin Stock</Badge>;
    default:
      return <Badge variant="secondary">{severity}</Badge>;
  }
}

function priorityBadge(priority: string) {
  switch (priority) {
    case "HIGH":
      return <Badge variant="destructive" data-testid="badge-priority-high">Alta</Badge>;
    case "MEDIUM":
      return <Badge className="bg-amber-500 text-white" data-testid="badge-priority-medium">Media</Badge>;
    case "LOW":
      return <Badge variant="secondary" data-testid="badge-priority-low">Baja</Badge>;
    default:
      return <Badge variant="secondary">{priority}</Badge>;
  }
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EventHistory({ shortageId }: { shortageId: number }) {
  const { data: events, isLoading } = useQuery<ShortageEvent[]>({
    queryKey: ["/api/shortages", shortageId, "events"],
    queryFn: async () => {
      const res = await fetch(`/api/shortages/${shortageId}/events`, { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando eventos");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando historial...
      </div>
    );
  }

  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground py-2">Sin eventos registrados</p>;
  }

  return (
    <div className="space-y-2 py-2">
      {events.map((ev) => (
        <div key={ev.id} className="flex items-start gap-2 text-sm border-l-2 border-muted pl-3 py-1" data-testid={`event-${ev.id}`}>
          <Clock className="h-3.5 w-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div>
            <span className="font-medium">{ev.eventType}</span>
            {ev.message && <span className="text-muted-foreground"> - {ev.message}</span>}
            <p className="text-xs text-muted-foreground">{formatDate(ev.createdAt)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ActiveShortages() {
  const { toast } = useToast();
  const [tab, setTab] = useState("activos");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [closeDialogId, setCloseDialogId] = useState<number | null>(null);
  const [closeMessage, setCloseMessage] = useState("");
  const [resolveDialogId, setResolveDialogId] = useState<number | null>(null);
  const [resolveMessage, setResolveMessage] = useState("");

  const { data: shortages, isLoading } = useQuery<Shortage[]>({
    queryKey: ["/api/shortages/active"],
  });

  const { data: invItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const invItemMap = useMemo(() => {
    const map = new Map<number, string>();
    if (invItems) invItems.forEach((i) => map.set(i.id, i.name));
    return map;
  }, [invItems]);

  const productMap = useMemo(() => {
    const map = new Map<number, string>();
    if (products) products.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [products]);

  function getItemName(s: Shortage): string {
    if (s.entityType === "INV_ITEM" && s.invItemId) {
      return invItemMap.get(s.invItemId) || `Insumo #${s.invItemId}`;
    }
    if (s.entityType === "MENU_PRODUCT" && s.menuProductId) {
      return productMap.get(s.menuProductId) || `Producto #${s.menuProductId}`;
    }
    return "Desconocido";
  }

  const filtered = useMemo(() => {
    if (!shortages) return [];
    switch (tab) {
      case "activos":
        return shortages.filter((s) => s.status === "OPEN" || s.status === "ACKNOWLEDGED");
      case "resueltos":
        return shortages.filter((s) => s.status === "RESOLVED");
      case "cerrados":
        return shortages.filter((s) => s.status === "CLOSED");
      default:
        return shortages;
    }
  }, [shortages, tab]);

  const activeCount = useMemo(() => {
    if (!shortages) return 0;
    return shortages.filter((s) => s.status === "OPEN" || s.status === "ACKNOWLEDGED").length;
  }, [shortages]);

  function invalidateShortages() {
    queryClient.invalidateQueries({ queryKey: ["/api/shortages"] });
    queryClient.invalidateQueries({ queryKey: ["/api/shortages/active"] });
  }

  const ackMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/shortages/${id}/ack`);
    },
    onSuccess: () => {
      invalidateShortages();
      toast({ title: "Faltante reconocido" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, message }: { id: number; message?: string }) => {
      await apiRequest("PATCH", `/api/shortages/${id}/resolve`, { message });
    },
    onSuccess: () => {
      invalidateShortages();
      toast({ title: "Faltante resuelto" });
      setResolveDialogId(null);
      setResolveMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async ({ id, message }: { id: number; message: string }) => {
      await apiRequest("PATCH", `/api/shortages/${id}/close`, { message });
    },
    onSuccess: () => {
      invalidateShortages();
      toast({ title: "Faltante cerrado" });
      setCloseDialogId(null);
      setCloseMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleAvailMutation = useMutation({
    mutationFn: async (productId: number) => {
      await apiRequest("PATCH", `/api/shortages/toggle-availability/${productId}`, { active: false });
    },
    onSuccess: () => {
      invalidateShortages();
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      toast({ title: "Producto marcado como no disponible" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function copyPurchaseList() {
    if (!shortages) return;
    const items = shortages
      .filter((s) => (s.status === "OPEN" || s.status === "ACKNOWLEDGED") && s.entityType === "INV_ITEM")
      .map((s) => {
        const name = getItemName(s);
        const qty = s.suggestedPurchaseQtyBase ? parseFloat(s.suggestedPurchaseQtyBase).toFixed(2) : "?";
        return `- ${name}: ${qty}`;
      });
    if (items.length === 0) {
      toast({ title: "Sin insumos activos para comprar" });
      return;
    }
    const text = `Lista de compras (${new Date().toLocaleDateString("es-MX")})\n${items.join("\n")}`;
    navigator.clipboard.writeText(text).then(() => {
      toast({ title: "Lista copiada al portapapeles" });
    });
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
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-lg" data-testid="text-page-title">Faltantes Activos</CardTitle>
            <Badge variant="secondary" data-testid="badge-active-count">{activeCount}</Badge>
          </div>
          <Button variant="outline" onClick={copyPurchaseList} data-testid="button-copy-purchase-list">
            <Copy className="h-4 w-4 mr-2" />
            Copiar lista para comprar
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full" data-testid="tabs-filter">
              <TabsTrigger value="activos" className="flex-1" data-testid="tab-activos">Activos</TabsTrigger>
              <TabsTrigger value="resueltos" className="flex-1" data-testid="tab-resueltos">Resueltos</TabsTrigger>
              <TabsTrigger value="cerrados" className="flex-1" data-testid="tab-cerrados">Cerrados</TabsTrigger>
              <TabsTrigger value="todos" className="flex-1" data-testid="tab-todos">Todos</TabsTrigger>
            </TabsList>
          </Tabs>

          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8" data-testid="text-empty">
              No hay faltantes en esta categoria
            </p>
          )}

          <div className="space-y-3">
            {filtered.map((s) => {
              const expanded = expandedIds.has(s.id);
              const itemName = getItemName(s);
              return (
                <Card key={s.id} data-testid={`card-shortage-${s.id}`}>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {statusBadge(s.status)}
                        {severityBadge(s.severityReport)}
                        {priorityBadge(s.priority)}
                        {s.auditFlag && (
                          <Badge className="bg-orange-500 text-white" data-testid={`badge-audit-${s.id}`}>
                            <Shield className="h-3 w-3 mr-1" />
                            Revision de auditoria
                          </Badge>
                        )}
                      </div>
                      <Badge variant="outline" data-testid={`badge-entity-${s.id}`}>
                        {s.entityType === "INV_ITEM" ? (
                          <><Package className="h-3 w-3 mr-1" /> Insumo</>
                        ) : (
                          <><ShoppingCart className="h-3 w-3 mr-1" /> Producto</>
                        )}
                      </Badge>
                    </div>

                    <div>
                      <p className="font-medium" data-testid={`text-item-name-${s.id}`}>{itemName}</p>
                      <p className="text-sm text-muted-foreground" data-testid={`text-reported-by-${s.id}`}>
                        Reportado por {s.reportedByName || `Empleado #${s.reportedByEmployeeId}`} - {formatDate(s.reportedAt)}
                      </p>
                      <p className="text-sm text-muted-foreground" data-testid={`text-report-count-${s.id}`}>
                        Reportado {s.reportCount} {s.reportCount === 1 ? "vez" : "veces"}
                      </p>
                    </div>

                    {s.entityType === "INV_ITEM" && (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                        {s.systemOnHandQtyBaseSnapshot !== null && (
                          <div className="text-muted-foreground" data-testid={`text-stock-snapshot-${s.id}`}>
                            Stock al reportar: {parseFloat(s.systemOnHandQtyBaseSnapshot).toFixed(2)}
                          </div>
                        )}
                        {s.systemAvgCostSnapshot !== null && (
                          <div className="text-muted-foreground" data-testid={`text-avg-cost-${s.id}`}>
                            Costo promedio: ${parseFloat(s.systemAvgCostSnapshot).toFixed(2)}
                          </div>
                        )}
                        {s.suggestedPurchaseQtyBase !== null && (
                          <div className="text-muted-foreground" data-testid={`text-suggested-qty-${s.id}`}>
                            Sugerido comprar: {parseFloat(s.suggestedPurchaseQtyBase).toFixed(2)}
                          </div>
                        )}
                      </div>
                    )}

                    {s.notes && (
                      <p className="text-sm bg-muted/50 rounded-md p-2" data-testid={`text-notes-${s.id}`}>
                        {s.notes}
                      </p>
                    )}

                    <div className="flex flex-col sm:flex-row gap-2">
                      {s.status === "OPEN" && (
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto"
                          onClick={() => ackMutation.mutate(s.id)}
                          disabled={ackMutation.isPending}
                          data-testid={`button-ack-${s.id}`}
                        >
                          {ackMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                          Reconocer
                        </Button>
                      )}
                      {(s.status === "OPEN" || s.status === "ACKNOWLEDGED") && (
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto"
                          onClick={() => { setResolveDialogId(s.id); setResolveMessage(""); }}
                          data-testid={`button-resolve-${s.id}`}
                        >
                          <CheckCircle className="h-4 w-4 mr-2" />
                          Resolver
                        </Button>
                      )}
                      {s.status === "RESOLVED" && (
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto"
                          onClick={() => { setCloseDialogId(s.id); setCloseMessage(""); }}
                          data-testid={`button-close-${s.id}`}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Cerrar
                        </Button>
                      )}
                      {s.entityType === "MENU_PRODUCT" && s.menuProductId && (s.status === "OPEN" || s.status === "ACKNOWLEDGED") && (
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto text-destructive"
                          onClick={() => toggleAvailMutation.mutate(s.menuProductId!)}
                          disabled={toggleAvailMutation.isPending}
                          data-testid={`button-toggle-avail-${s.id}`}
                        >
                          {toggleAvailMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <AlertTriangle className="h-4 w-4 mr-2" />}
                          Marcar NO disponible
                        </Button>
                      )}
                    </div>

                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-muted-foreground"
                        onClick={() => toggleExpand(s.id)}
                        data-testid={`button-toggle-events-${s.id}`}
                      >
                        {expanded ? <ChevronDown className="h-4 w-4 mr-2" /> : <ChevronRight className="h-4 w-4 mr-2" />}
                        Historial de eventos
                      </Button>
                      {expanded && <EventHistory shortageId={s.id} />}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={resolveDialogId !== null} onOpenChange={(open) => { if (!open) setResolveDialogId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="text-resolve-dialog-title">Resolver faltante</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Mensaje opcional..."
            value={resolveMessage}
            onChange={(e) => setResolveMessage(e.target.value)}
            data-testid="input-resolve-message"
          />
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setResolveDialogId(null)} data-testid="button-resolve-cancel">
              Cancelar
            </Button>
            <Button
              onClick={() => { if (resolveDialogId) resolveMutation.mutate({ id: resolveDialogId, message: resolveMessage || undefined }); }}
              disabled={resolveMutation.isPending}
              data-testid="button-resolve-confirm"
            >
              {resolveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Resolver
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDialogId !== null} onOpenChange={(open) => { if (!open) setCloseDialogId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="text-close-dialog-title">Cerrar faltante</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Nota obligatoria para cerrar..."
            value={closeMessage}
            onChange={(e) => setCloseMessage(e.target.value)}
            data-testid="input-close-message"
          />
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setCloseDialogId(null)} data-testid="button-close-cancel">
              Cancelar
            </Button>
            <Button
              onClick={() => { if (closeDialogId && closeMessage.trim()) closeMutation.mutate({ id: closeDialogId, message: closeMessage }); }}
              disabled={closeMutation.isPending || !closeMessage.trim()}
              data-testid="button-close-confirm"
            >
              {closeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
