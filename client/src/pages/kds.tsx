import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  customerNameSnapshot?: string | null;
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

function getElapsedMins(dateStr: string) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function getElapsedClass(dateStr: string) {
  const mins = getElapsedMins(dateStr);
  if (mins < 10) return "ok";
  if (mins < 20) return "warning";
  return "urgent";
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
  const alertDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentTime, setCurrentTime] = useState("");

  const activeQueryKey = ["/api/kds/tickets", "active", destination];
  const historyQueryKey = ["/api/kds/tickets", "history", destination];

  const { data: activeTickets = [], isLoading } = useQuery<KDSTicket[]>({
    queryKey: activeQueryKey,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/kds/tickets/active?destination=${destination}`);
      return res.json();
    },
    refetchInterval: 5000,
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
      if (alertDebounceRef.current) clearTimeout(alertDebounceRef.current);
      alertDebounceRef.current = setTimeout(() => {
        playAlertSound();
        alertDebounceRef.current = null;
      }, 500);
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

  useEffect(() => {
    const update = () => {
      setCurrentTime(new Date().toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit", hour12: false }));
    };
    update();
    const interval = setInterval(() => {
      forceUpdate(c => c + 1);
      update();
    }, 1000);
    return () => clearInterval(interval);
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

  const emptyMessage = destination === "bar" ? "No hay tickets activos en bar" : "No hay tickets activos en cocina";
  const titleIcon = destination === "bar" ? "BAR" : "COCINA";

  const getItemStatusLabel = (status: string) => {
    if (status === "NEW") return "NUEVO";
    if (status === "PREPARING") return "PREP";
    return "LISTO";
  };

  const getItemStatusCls = (status: string) => {
    if (status === "NEW") return "new";
    if (status === "PREPARING") return "preparing";
    return "ready";
  };

  return (
    <div className="kds-layout">
      <style>{`
        .kds-layout {
          background: var(--bg);
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          font-family: var(--f-body);
          color: var(--text);
        }
        .kds-header {
          padding: 16px 24px;
          background: var(--s0);
          border-bottom: 1px solid var(--border-ds);
          display: flex;
          align-items: center;
          gap: 20px;
          flex-shrink: 0;
        }
        .kds-title {
          font-family: var(--f-disp);
          font-size: 26px;
          font-weight: 800;
          letter-spacing: 0.05em;
        }
        .kds-stats {
          font-family: var(--f-mono);
          font-size: 13px;
          color: var(--text2);
        }
        .kds-time {
          font-family: var(--f-mono);
          font-size: 22px;
          font-weight: 600;
          color: var(--text2);
          margin-left: auto;
        }

        .kds-tabs {
          display: flex;
          gap: 4px;
          padding: 12px 24px 0;
          border-bottom: 1px solid var(--border-ds);
        }
        .kds-tab {
          padding: 10px 18px;
          border-radius: var(--r-sm) var(--r-sm) 0 0;
          border: 1px solid transparent;
          border-bottom: none;
          background: transparent;
          color: var(--text3);
          font-family: var(--f-disp);
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all var(--t-fast);
        }
        .kds-tab.active {
          background: var(--s1);
          border-color: var(--border-ds);
          color: var(--green);
        }

        .kds-grid {
          flex: 1;
          padding: 20px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
          align-content: start;
          overflow-y: auto;
        }

        .kds-card {
          background: var(--s1);
          border: 2px solid var(--border-ds);
          border-radius: var(--r-lg);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .kds-card.has-new { border-color: var(--amber); }

        .kds-card-header {
          padding: 14px 16px;
          background: var(--s2);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .kds-table-name {
          font-family: var(--f-disp);
          font-size: 22px;
          font-weight: 800;
        }
        .kds-elapsed {
          font-family: var(--f-mono);
          font-size: 20px;
          font-weight: 600;
        }
        .kds-elapsed.ok { color: var(--green); }
        .kds-elapsed.warning { color: var(--amber); }
        .kds-elapsed.urgent { color: var(--red); animation: pulse-red 1s infinite; }

        @keyframes pulse-red {
          0%,100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .kds-item-count {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text3);
          margin-top: 2px;
        }

        .kds-items {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex: 1;
        }
        .kds-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: var(--r-sm);
          background: var(--s2);
          border: 1px solid var(--border-ds);
          cursor: pointer;
          transition: all var(--t-fast);
          min-height: 48px;
        }
        .kds-item:active { transform: scale(0.98); }
        .kds-item.new { border-left: 3px solid var(--amber); }
        .kds-item.preparing { border-left: 3px solid var(--blue); background: var(--blue-d); }
        .kds-item.ready { border-left: 3px solid var(--green); background: var(--green-d); opacity: 0.7; }

        .kds-item-qty {
          font-family: var(--f-mono);
          font-size: 18px;
          font-weight: 700;
          color: var(--text2);
          width: 28px;
          text-align: center;
          flex-shrink: 0;
        }
        .kds-item-info { flex: 1; min-width: 0; }
        .kds-item-name {
          font-size: 15px;
          font-weight: 500;
          color: var(--text);
        }
        .kds-item-customer {
          font-size: 12px;
          color: var(--text3);
          margin-top: 1px;
        }
        .kds-item-mods {
          font-size: 12px;
          color: var(--text3);
          margin-top: 2px;
        }
        .kds-item-notes {
          font-size: 11px;
          color: var(--amber);
          font-style: italic;
          margin-top: 2px;
        }
        .kds-item-status {
          font-family: var(--f-mono);
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          flex-shrink: 0;
        }
        .kds-item.new .kds-item-status { color: var(--amber); }
        .kds-item.preparing .kds-item-status { color: var(--blue); }
        .kds-item.ready .kds-item-status { color: var(--green); }

        .kds-complete-btn {
          margin: 12px;
          padding: 14px;
          border-radius: var(--r-sm);
          background: var(--green);
          color: #050f08;
          font-family: var(--f-disp);
          font-size: 16px;
          font-weight: 800;
          letter-spacing: 0.05em;
          border: none;
          cursor: pointer;
          transition: all var(--t-mid);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .kds-complete-btn:disabled {
          background: var(--s3);
          color: var(--text3);
          cursor: default;
        }
        .kds-complete-btn:active:not(:disabled) { transform: scale(0.97); }

        .kds-hint {
          text-align: center;
          font-family: var(--f-mono);
          font-size: 10px;
          color: var(--text3);
          padding: 8px 12px 14px;
          letter-spacing: 0.04em;
        }

        .kds-empty {
          text-align: center;
          padding: 60px 20px;
          color: var(--text3);
        }
        .kds-empty-icon {
          margin-bottom: 16px;
          opacity: 0.3;
        }
        .kds-empty-text {
          font-family: var(--f-mono);
          font-size: 14px;
        }

        .kds-history-bar {
          display: flex;
          justify-content: flex-end;
          padding: 0 20px 12px;
        }
        .kds-clear-btn {
          padding: 8px 16px;
          border-radius: var(--r-sm);
          background: var(--s2);
          border: 1px solid var(--border-ds);
          color: var(--text2);
          font-family: var(--f-disp);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all var(--t-fast);
        }
        .kds-clear-btn:active { background: var(--s3); }

        .kds-history-card {
          background: var(--s1);
          border: 1px solid var(--border-ds);
          border-radius: var(--r-md);
          opacity: 0.65;
          overflow: hidden;
        }
        .kds-history-header {
          padding: 12px 14px;
          background: var(--s2);
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .kds-history-name {
          font-family: var(--f-disp);
          font-size: 16px;
          font-weight: 700;
        }
        .kds-history-count {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text3);
        }
        .kds-history-items {
          padding: 8px 14px;
        }
        .kds-history-item {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
          font-size: 13px;
          color: var(--text2);
        }

        .kds-new-alert {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background: rgba(0,0,0,0.85);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .kds-alert-box {
          background: var(--s1);
          border: 2px solid var(--green-m);
          border-radius: var(--r-xl);
          padding: 40px;
          text-align: center;
          box-shadow: 0 0 60px rgba(46,204,113,0.2);
          animation: alertPop 0.4s cubic-bezier(.22,.68,0,1.2);
        }
        @keyframes alertPop {
          from { transform: scale(0.7); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .kds-alert-count {
          font-family: var(--f-disp);
          font-size: 80px;
          font-weight: 800;
          color: var(--green);
          line-height: 1;
        }
        .kds-alert-label {
          font-family: var(--f-disp);
          font-size: 24px;
          color: var(--text2);
          margin: 8px 0 24px;
        }
        .kds-alert-ok {
          padding: 14px 48px;
          border-radius: var(--r-sm);
          background: var(--green);
          color: #050f08;
          font-family: var(--f-disp);
          font-size: 18px;
          font-weight: 800;
          border: none;
          cursor: pointer;
          transition: all var(--t-mid);
        }
        .kds-alert-ok:active { transform: scale(0.97); }

        .kds-loading {
          display: flex;
          justify-content: center;
          padding: 60px;
          color: var(--text3);
        }
      `}</style>

      {pendingAlertCount > 0 && (
        <div className="kds-new-alert" data-testid="modal-new-order-alert">
          <div className="kds-alert-box">
            <div className="kds-alert-count" data-testid="text-new-order-title">{pendingAlertCount}</div>
            <div className="kds-alert-label">
              {pendingAlertCount === 1 ? "Nueva Orden" : "Nuevas Ordenes"}
            </div>
            <button
              className="kds-alert-ok"
              onClick={() => setPendingAlertCount(0)}
              data-testid="button-dismiss-new-order"
            >
              OK
            </button>
          </div>
        </div>
      )}

      <div className="kds-header">
        <Icon size={24} />
        <span className="kds-title" data-testid="text-page-title">{titleIcon}</span>
        <span className="kds-stats">{stableGroups.length} tickets activos</span>
        <span className="kds-time">{currentTime}</span>
      </div>

      <div className="kds-tabs">
        <button
          className={`kds-tab ${tab === "active" ? "active" : ""}`}
          onClick={() => setTab("active")}
          data-testid="tab-active"
        >
          Activos ({stableGroups.length})
        </button>
        <button
          className={`kds-tab ${tab === "history" ? "active" : ""}`}
          onClick={() => setTab("history")}
          data-testid="tab-history"
        >
          Historial
        </button>
      </div>

      {tab === "active" ? (
        isLoading ? (
          <div className="kds-loading"><Loader2 size={32} className="animate-spin" /></div>
        ) : stableGroups.length === 0 ? (
          <div className="kds-empty">
            <Icon size={48} className="kds-empty-icon" />
            <p className="kds-empty-text">{emptyMessage}</p>
          </div>
        ) : (
          <div className="kds-grid">
            {stableGroups.map((group) => {
              const hasNewItems = group.items.some(i => i.status === "NEW");
              const elapsedCls = getElapsedClass(group.earliestCreatedAt);
              return (
                <div key={group.orderId} className={`kds-card ${hasNewItems ? "has-new" : ""}`} data-testid={`card-group-${group.orderId}`}>
                  <div className="kds-card-header">
                    <div>
                      <div className="kds-table-name">{group.tableNameSnapshot}</div>
                      <div className="kds-item-count">{group.items.length} {group.items.length === 1 ? "item" : "items"}</div>
                    </div>
                    <div className={`kds-elapsed ${elapsedCls}`}>
                      {formatElapsed(group.earliestCreatedAt)}
                    </div>
                  </div>
                  <div className="kds-items">
                    {group.items.map((item) => {
                      const statusCls = getItemStatusCls(item.status);
                      return (
                        <div
                          key={item.id}
                          className={`kds-item ${statusCls}`}
                          onClick={() => {
                            const next = getNextStatus(item.status);
                            if (next) updateItemMutation.mutate({ itemId: item.id, status: next });
                          }}
                          data-testid={`kds-item-${item.id}`}
                        >
                          <span className="kds-item-qty">{item.qty}x</span>
                          <div className="kds-item-info">
                            <div className="kds-item-name">{item.productNameSnapshot}</div>
                            {item.customerNameSnapshot && (
                              <div className="kds-item-customer" data-testid={`kds-item-customer-${item.id}`}>{item.customerNameSnapshot}</div>
                            )}
                            {item.modifiers && item.modifiers.length > 0 && (
                              <div className="kds-item-mods">
                                {item.modifiers.map((m: any) => m.nameSnapshot).join(", ")}
                              </div>
                            )}
                            {item.notes && <div className="kds-item-notes">{item.notes}</div>}
                          </div>
                          <span className="kds-item-status">{getItemStatusLabel(item.status)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {group.allReady ? (
                    <button
                      className="kds-complete-btn"
                      disabled={markGroupReadyMutation.isPending}
                      onClick={() => markGroupReadyMutation.mutate(group.ticketIds)}
                      data-testid={`button-complete-group-${group.orderId}`}
                    >
                      <CheckCircle size={18} /> Ticket Completo
                    </button>
                  ) : (
                    <div className="kds-hint">Toque cada item para avanzar su estado</div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <>
          <div className="kds-history-bar">
            <button
              className="kds-clear-btn"
              onClick={() => clearHistoryMutation.mutate()}
              disabled={clearHistoryMutation.isPending}
              data-testid="button-clear-history"
            >
              <Trash2 size={14} /> Vaciar Vista
            </button>
          </div>
          {groupedHistory.length === 0 ? (
            <div className="kds-empty">
              <p className="kds-empty-text">No hay tickets en historial</p>
            </div>
          ) : (
            <div className="kds-grid">
              {groupedHistory.map((group) => (
                <div key={group.orderId} className="kds-history-card" data-testid={`card-history-group-${group.orderId}`}>
                  <div className="kds-history-header">
                    <span className="kds-history-name">{group.tableNameSnapshot}</span>
                    <span className="kds-history-count">{group.items.length} items</span>
                  </div>
                  <div className="kds-history-items">
                    {group.items.map((item) => (
                      <div key={item.id} className="kds-history-item">
                        <span>{item.qty}x {item.productNameSnapshot}</span>
                        {item.customerNameSnapshot && (
                          <span style={{ color: "var(--text3)", fontSize: 11 }}>{item.customerNameSnapshot}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function KDSPage() {
  return <KDSDisplay destination="cocina" title="Cocina (KDS)" icon={ChefHat} />;
}
