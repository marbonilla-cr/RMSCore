import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { wsManager } from "@/lib/ws";
import { ChefHat, Clock, CheckCircle, Loader2, Trash2 } from "lucide-react";

interface KDSTicket {
  id: number;
  orderId: number;
  tableNameSnapshot: string;
  status: string;
  createdAt: string;
  items: {
    id: number;
    productNameSnapshot: string;
    qty: number;
    notes: string | null;
    status: string;
    prepStartedAt: string | null;
    readyAt: string | null;
    modifiers?: { id: number; nameSnapshot: string; priceDeltaSnapshot: string; qty: number }[];
  }[];
}

function formatElapsed(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins < 1) return `${secs}s`;
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function KDSPage() {
  const [tab, setTab] = useState("active");
  const lastTicketCountRef = useRef(0);

  const { data: activeTickets = [], isLoading } = useQuery<KDSTicket[]>({
    queryKey: ["/api/kds/tickets", "active"],
    refetchInterval: 5000,
  });

  const { data: historyTickets = [] } = useQuery<KDSTicket[]>({
    queryKey: ["/api/kds/tickets", "history"],
    enabled: tab === "history",
  });

  useEffect(() => {
    wsManager.connect();
    const unsub = wsManager.on("kitchen_ticket_created", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const playTone = (freq: number, start: number, duration: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = "sine";
          gain.gain.setValueAtTime(0.3, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + duration);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        };
        playTone(880, 0, 0.15);
        playTone(1100, 0.18, 0.15);
        playTone(1320, 0.36, 0.25);
      } catch {}
    });

    const unsub2 = wsManager.on("kitchen_item_status_changed", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    });

    const unsub3 = wsManager.on("order_updated", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    });

    return () => { unsub(); unsub2(); unsub3(); };
  }, []);

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      return apiRequest("PATCH", `/api/kds/items/${itemId}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    },
  });

  const markTicketReadyMutation = useMutation({
    mutationFn: async (ticketId: number) => {
      return apiRequest("PATCH", `/api/kds/tickets/${ticketId}`, { status: "READY" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets"] });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/kds/clear-history");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kds/tickets", "history"] });
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

  const getNextStatus = (status: string) => {
    if (status === "NEW") return "PREPARING";
    if (status === "PREPARING") return "READY";
    return null;
  };

  return (
    <div className="p-3 md:p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <ChefHat className="w-6 h-6" /> Cocina (KDS)
        </h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="active" className="min-h-[44px]" data-testid="tab-active">
            Activos ({activeTickets.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="min-h-[44px]" data-testid="tab-history">
            Historial
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : activeTickets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <ChefHat className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No hay tickets activos en cocina</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {activeTickets.map((ticket) => (
                <Card key={ticket.id} className={ticket.status === "NEW" ? "border-yellow-500 border-2" : ""} data-testid={`card-ticket-${ticket.id}`}>
                  <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-lg">{ticket.tableNameSnapshot}</h3>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {formatElapsed(ticket.createdAt)}
                      </p>
                    </div>
                    <Badge variant={ticket.status === "NEW" ? "destructive" : "default"}>
                      #{ticket.id}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 mb-3">
                      {ticket.items.map((item) => (
                        <div
                          key={item.id}
                          className={`flex items-center justify-between p-2 rounded-md min-h-[48px] ${getItemStatusColor(item.status)} cursor-pointer`}
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
                            {item.notes && <p className="text-xs opacity-75">{item.notes}</p>}
                          </div>
                          <Badge variant="secondary" className="text-xs flex-shrink-0">
                            {item.status === "NEW" ? "NUEVO" : item.status === "PREPARING" ? "PREPARANDO" : "LISTO"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                    {ticket.items.every((i) => i.status === "READY") ? (
                      <Button className="w-full min-h-[48px] bg-green-600 dark:bg-green-700 text-white" disabled={markTicketReadyMutation.isPending} onClick={() => markTicketReadyMutation.mutate(ticket.id)} data-testid={`button-complete-ticket-${ticket.id}`}>
                        <CheckCircle className="w-4 h-4 mr-1" /> Ticket Completo
                      </Button>
                    ) : (
                      <p className="text-xs text-center text-muted-foreground">Toque cada ítem para avanzar su estado</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          <div className="flex justify-end mb-4">
            <Button variant="outline" onClick={() => clearHistoryMutation.mutate()} disabled={clearHistoryMutation.isPending} data-testid="button-clear-history">
              <Trash2 className="w-4 h-4 mr-1" /> Vaciar Vista
            </Button>
          </div>
          {historyTickets.length === 0 ? (
            <Card><CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No hay tickets en historial</p>
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {historyTickets.map((ticket) => (
                <Card key={ticket.id} className="opacity-75" data-testid={`card-history-ticket-${ticket.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-bold">{ticket.tableNameSnapshot}</h3>
                      <Badge variant="secondary">#{ticket.id}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {ticket.items.map((item) => (
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
