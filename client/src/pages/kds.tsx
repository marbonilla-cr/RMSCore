import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { wsManager } from "@/lib/ws";
import { ChefHat, Clock, CheckCircle, Loader2, Trash2, Wine } from "lucide-react";

interface KDSTicketItem {
  id: number;
  productNameSnapshot: string;
  qty: number;
  notes: string | null;
  status: string;
  prepStartedAt: string | null;
  readyAt: string | null;
  modifiers?: { id: number; nameSnapshot: string; priceDeltaSnapshot: string; qty: number }[];
}

interface KDSTicket {
  id: number;
  orderId: number;
  tableNameSnapshot: string;
  status: string;
  createdAt: string;
  items: KDSTicketItem[];
}

interface GroupedTicket {
  orderId: number;
  tableNameSnapshot: string;
  earliestCreatedAt: string;
  ticketIds: number[];
  items: KDSTicketItem[];
  allReady: boolean;
}

function formatElapsed(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins < 1) return `${secs}s`;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playTone = (freq: number, start: number, duration: number, type: OscillatorType = "square") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.setValueAtTime(0.8, ctx.currentTime + start);
      gain.gain.setValueAtTime(0.8, ctx.currentTime + start + duration * 0.7);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + duration);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    playTone(1200, 0, 0.12, "square");
    playTone(1500, 0.14, 0.12, "square");
    playTone(1200, 0.28, 0.12, "square");
    playTone(1500, 0.42, 0.12, "square");
    playTone(1800, 0.56, 0.25, "sawtooth");

    playTone(1200, 0.9, 0.12, "square");
    playTone(1500, 1.04, 0.12, "square");
    playTone(1200, 1.18, 0.12, "square");
    playTone(1500, 1.32, 0.12, "square");
    playTone(1800, 1.46, 0.25, "sawtooth");
  } catch {}
}

function groupTicketsByOrder(tickets: KDSTicket[]): GroupedTicket[] {
  const map = new Map<number, GroupedTicket>();
  for (const t of tickets) {
    const existing = map.get(t.orderId);
    if (existing) {
      existing.ticketIds.push(t.id);
      existing.items.push(...t.items);
      if (new Date(t.createdAt).getTime() < new Date(existing.earliestCreatedAt).getTime()) {
        existing.earliestCreatedAt = t.createdAt;
      }
    } else {
      map.set(t.orderId, {
        orderId: t.orderId,
        tableNameSnapshot: t.tableNameSnapshot,
        earliestCreatedAt: t.createdAt,
        ticketIds: [t.id],
        items: [...t.items],
        allReady: false,
      });
    }
  }
  Array.from(map.values()).forEach((g) => {
    g.allReady = g.items.length > 0 && g.items.every((i: KDSTicketItem) => i.status === "READY");
  });
  return Array.from(map.values());
}

export function KDSDisplay({ destination, title, icon: Icon }: { destination: string; title: string; icon: typeof ChefHat }) {
  const [tab, setTab] = useState("active");
  const groupOrderRef = useRef<number[]>([]);
  const [, forceUpdate] = useState(0);
  const [pendingAlertCount, setPendingAlertCount] = useState(0);
  const knownTicketIdsRef = useRef<Set<number> | null>(null);

  const activeQueryKey = ["/api/kds/tickets", "active", destination];
  const historyQueryKey = ["/api/kds/tickets", "history", destination];

  const { data: activeTickets = [], isLoading } = useQuery<KDSTicket[]>({
    queryKey: activeQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/kds/tickets/active?destination=${destination}`);
      return res.json();
    },
    refetchInterval: 30000,
  });

  const groupedTickets = useMemo(() => groupTicketsByOrder(activeTickets), [activeTickets]);

  const stableGroups = useMemo(() => {
    const currentOrderIds = new Set(groupedTickets.map(g => g.orderId));
    const existingOrder = groupOrderRef.current.filter(id => currentOrderIds.has(id));
    const newIds = groupedTickets.map(g => g.orderId).filter(id => !existingOrder.includes(id));
    groupOrderRef.current = [...existingOrder, ...newIds];

    const groupMap = new Map(groupedTickets.map(g => [g.orderId, g]));
    return groupOrderRef.current.map(id => groupMap.get(id)!).filter(Boolean);
  }, [groupedTickets]);

  const { data: historyTickets = [] } = useQuery<KDSTicket[]>({
    queryKey: historyQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/kds/tickets/history?destination=${destination}`);
      return res.json();
    },
    enabled: tab === "history",
  });

  const groupedHistory = useMemo(() => groupTicketsByOrder(historyTickets), [historyTickets]);

  const dataLoadedRef = useRef(false);

  useEffect(() => {
    if (!dataLoadedRef.current && !isLoading) {
      knownTicketIdsRef.current = new Set(activeTickets.map(t => t.id));
      dataLoadedRef.current = true;
      return;
    }

    if (!dataLoadedRef.current) return;

    const currentIds = new Set(activeTickets.map(t => t.id));
    const newTicketIds = Array.from(currentIds).filter(id => !knownTicketIdsRef.current!.has(id));
    if (newTicketIds.length > 0) {
      setPendingAlertCount(prev => prev + newTicketIds.length);
      playAlertSound();
    }

    knownTicketIdsRef.current = currentIds;
  }, [activeTickets, isLoading]);

  useEffect(() => {
    wsManager.connect();
    const unsub = wsManager.on("kitchen_ticket_created", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    });

    const unsub2 = wsManager.on("kitchen_item_status_changed", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    });

    const unsub3 = wsManager.on("order_updated", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    });

    return () => { unsub(); unsub2(); unsub3(); };
  }, []);

  const getNextStatus = (status: string) => {
    if (status === "NEW") return "PREPARING";
    if (status === "PREPARING") return "READY";
    return null;
  };

  const updateItemOptimistically = (itemId: number, newStatus: string) => {
    queryClient.setQueryData<KDSTicket[]>(activeQueryKey, (old) => {
      if (!old) return old;
      return old.map(ticket => ({
        ...ticket,
        items: ticket.items.map(item =>
          item.id === itemId ? { ...item, status: newStatus } : item
        ),
      }));
    });
  };

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      return apiRequest("PATCH", `/api/kds/items/${itemId}`, { status });
    },
    onMutate: async ({ itemId, status }) => {
      await queryClient.cancelQueries({ queryKey: activeQueryKey });
      const previous = queryClient.getQueryData<KDSTicket[]>(activeQueryKey);
      updateItemOptimistically(itemId, status);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(activeQueryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    },
  });

  const markGroupReadyMutation = useMutation({
    mutationFn: async (ticketIds: number[]) => {
      await Promise.all(
        ticketIds.map(id => apiRequest("PATCH", `/api/kds/tickets/${id}`, { status: "READY" }))
      );
    },
    onMutate: async (ticketIds) => {
      await queryClient.cancelQueries({ queryKey: activeQueryKey });
      const previous = queryClient.getQueryData<KDSTicket[]>(activeQueryKey);
      const previousOrder = [...groupOrderRef.current];
      const idsSet = new Set(ticketIds);
      queryClient.setQueryData<KDSTicket[]>(activeQueryKey, (old) => {
        if (!old) return old;
        const remaining = old.filter(t => !idsSet.has(t.id));
        const remainingOrderIds = new Set(remaining.map(t => t.orderId));
        groupOrderRef.current = groupOrderRef.current.filter(id => remainingOrderIds.has(id));
        return remaining;
      });
      return { previous, previousOrder };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(activeQueryKey, context.previous);
      }
      if (context?.previousOrder) {
        groupOrderRef.current = context.previousOrder;
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/kds/clear-history?destination=${destination}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    },
  });

  const getItemStatusColor = (status: string) => {
    switch (status) {
      case "NEW": return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200";
      case "PREPARING": return "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200";
      case "READY": return "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200";
      default: return "";
    }
  };

  useEffect(() => {
    const interval = setInterval(() => forceUpdate(c => c + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const emptyMessage = destination === "bar" ? "No hay tickets activos en bar" : "No hay tickets activos en cocina";

  return (
    <div className="p-3 md:p-4">
      {pendingAlertCount > 0 && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60" data-testid="modal-new-order-alert">
          <Card className="w-[90%] max-w-sm mx-auto shadow-2xl border-2 border-yellow-500 animate-in fade-in zoom-in-95 duration-200">
            <CardContent className="pt-6 pb-4 text-center space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center">
                <Icon className="w-9 h-9 text-yellow-600 dark:text-yellow-400" />
              </div>
              <h2 className="text-xl font-bold" data-testid="text-new-order-title">
                {pendingAlertCount === 1 ? "Nueva Orden" : `${pendingAlertCount} Nuevas Órdenes`}
              </h2>
              <p className="text-muted-foreground text-sm">
                {destination === "bar"
                  ? (pendingAlertCount === 1 ? "Ha llegado un nuevo pedido al bar" : `Han llegado ${pendingAlertCount} nuevos pedidos al bar`)
                  : (pendingAlertCount === 1 ? "Ha llegado un nuevo pedido a cocina" : `Han llegado ${pendingAlertCount} nuevos pedidos a cocina`)}
              </p>
              <Button
                className="w-full min-h-[48px] text-base font-bold"
                onClick={() => setPendingAlertCount(0)}
                data-testid="button-dismiss-new-order"
              >
                OK
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Icon className="w-6 h-6" /> {title}
        </h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="active" className="min-h-[44px]" data-testid="tab-active">
            Activos ({stableGroups.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="min-h-[44px]" data-testid="tab-history">
            Historial
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : stableGroups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Icon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">{emptyMessage}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {stableGroups.map((group) => {
                const hasNewItems = group.items.some(i => i.status === "NEW");
                return (
                  <Card key={group.orderId} className={hasNewItems ? "border-yellow-500 border-2" : ""} data-testid={`card-group-${group.orderId}`}>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-lg">{group.tableNameSnapshot}</h3>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {formatElapsed(group.earliestCreatedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge variant={hasNewItems ? "destructive" : "default"}>
                          {group.items.length} {group.items.length === 1 ? "ítem" : "ítems"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 mb-3">
                        {group.items.map((item) => (
                          <div
                            key={item.id}
                            className={`flex items-center justify-between p-2 rounded-md min-h-[48px] ${getItemStatusColor(item.status)} cursor-pointer transition-colors duration-150`}
                            onClick={() => {
                              const next = getNextStatus(item.status);
                              if (next) updateItemMutation.mutate({ itemId: item.id, status: next });
                            }}
                            data-testid={`kds-item-${item.id}`}
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-sm">
                                <span className="font-bold mr-1">{item.qty}x</span>
                                {item.productNameSnapshot}
                              </p>
                              {item.modifiers && item.modifiers.length > 0 && (
                                <p className="text-xs font-medium opacity-90">
                                  {item.modifiers.map((m: any) => m.nameSnapshot).join(", ")}
                                </p>
                              )}
                              {item.notes && !(item.modifiers && item.modifiers.length > 0) && <p className="text-xs opacity-75">{item.notes}</p>}
                            </div>
                            <Badge variant="secondary" className="text-xs flex-shrink-0">
                              {item.status === "NEW" ? "NUEVO" : item.status === "PREPARING" ? "PREPARANDO" : "LISTO"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                      {group.allReady ? (
                        <Button className="w-full min-h-[48px] bg-green-600 dark:bg-green-700 text-white" disabled={markGroupReadyMutation.isPending} onClick={() => markGroupReadyMutation.mutate(group.ticketIds)} data-testid={`button-complete-group-${group.orderId}`}>
                          <CheckCircle className="w-4 h-4 mr-1" /> Ticket Completo
                        </Button>
                      ) : (
                        <p className="text-xs text-center text-muted-foreground">Toque cada ítem para avanzar su estado</p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <div className="flex justify-end mb-4">
            <Button variant="outline" onClick={() => clearHistoryMutation.mutate()} disabled={clearHistoryMutation.isPending} data-testid="button-clear-history">
              <Trash2 className="w-4 h-4 mr-1" /> Vaciar Vista
            </Button>
          </div>
          {groupedHistory.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No hay tickets en historial</p>
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {groupedHistory.map((group) => (
                <Card key={group.orderId} className="opacity-75" data-testid={`card-history-group-${group.orderId}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold">{group.tableNameSnapshot}</h3>
                      <Badge variant="secondary">{group.items.length} ítems</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {group.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between py-1 text-sm">
                        <span>{item.qty}x {item.productNameSnapshot}</span>
                        <Badge variant="secondary" className="text-xs">LISTO</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function KDSPage() {
  return <KDSDisplay destination="cocina" title="Cocina (KDS)" icon={ChefHat} />;
}
