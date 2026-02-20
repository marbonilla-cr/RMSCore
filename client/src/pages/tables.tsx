import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Search, Settings, Loader2, User, UtensilsCrossed, Clock, DollarSign } from "lucide-react";
import { wsManager } from "@/lib/ws";
import { formatCurrency, timeAgo } from "@/lib/utils";

interface TableView {
  id: number;
  tableCode: string;
  tableName: string;
  active: boolean;
  hasOpenOrder: boolean;
  orderId: number | null;
  orderStatus: string | null;
  responsibleWaiterName: string | null;
  openedAt: string | null;
  pendingQrCount: number;
  itemCount: number;
  totalAmount: string | null;
  lastSentToKitchenAt: string | null;
}

function formatElapsed(dateStr: string | null) {
  if (!dateStr) return "--";
  return timeAgo(dateStr);
}

type ColumnKey = "waiter" | "items" | "amount" | "time";

const COLUMN_OPTIONS: { key: ColumnKey; label: string }[] = [
  { key: "waiter", label: "Salonero" },
  { key: "items", label: "Items" },
  { key: "amount", label: "Monto" },
  { key: "time", label: "Tiempo" },
];

function getTableStatusClass(t: TableView): string {
  if (t.pendingQrCount > 0) return "qr";
  if (t.orderStatus === "READY") return "ready";
  if (t.orderStatus === "PREPARING") return "preparing";
  if (t.orderStatus === "IN_KITCHEN") return "kitchen";
  if (t.hasOpenOrder) return "open";
  return "";
}

function getTableBadge(t: TableView): { label: string; cls: string } {
  if (t.pendingQrCount > 0) return { label: "QR Pendiente", cls: "badge-ds badge-amber" };
  if (!t.hasOpenOrder) return { label: "Libre", cls: "badge-ds badge-muted" };
  if (t.orderStatus === "READY") return { label: "Lista", cls: "badge-ds badge-green" };
  if (t.orderStatus === "PREPARING") return { label: "Preparando", cls: "badge-ds badge-amber" };
  if (t.orderStatus === "IN_KITCHEN") return { label: "En Cocina", cls: "badge-ds badge-blue" };
  return { label: "Abierta", cls: "badge-ds badge-green" };
}

function TablesSkeleton() {
  return (
    <div className="tables-grid stagger-children">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="table-card" style={{ opacity: 0.5 }}>
          <div className="skeleton" style={{ height: 20, width: 60, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 16, width: 90, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 12, width: 100 }} />
          <div className="skeleton" style={{ height: 12, width: 80, marginTop: 4 }} />
        </div>
      ))}
    </div>
  );
}

export default function TablesPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    try {
      const saved = localStorage.getItem("tables_visible_columns");
      if (saved) {
        const parsed = JSON.parse(saved) as ColumnKey[];
        return new Set<ColumnKey>(parsed);
      }
    } catch {}
    return new Set<ColumnKey>(["waiter", "items", "amount", "time"]);
  });

  const { data: tables = [], isLoading } = useQuery<TableView[]>({
    queryKey: ["/api/waiter/tables"],
    refetchInterval: 5000,
  });

  useEffect(() => {
    wsManager.connect();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
    };
    const unsubs = [
      wsManager.on("table_status_changed", invalidate),
      wsManager.on("qr_submission_created", (p: any) => {
        invalidate();
        toast({
          title: "Nueva orden QR",
          description: p?.tableName ? `Nueva orden QR en ${p.tableName}` : "Un cliente ha enviado un pedido QR",
        });
        try {
          const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = "sine";
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        } catch {}
      }),
      wsManager.on("order_updated", invalidate),
      wsManager.on("payment_completed", invalidate),
      wsManager.on("payment_voided", invalidate),
      wsManager.on("kitchen_item_status_changed", invalidate),
    ];
    return () => unsubs.forEach((u) => u());
  }, [toast]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem("tables_visible_columns", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const activeTables = tables.filter(t => t.active);
  const filtered = search
    ? activeTables.filter(t => t.tableName.toLowerCase().includes(search.toLowerCase()) || t.tableCode.toLowerCase().includes(search.toLowerCase()))
    : activeTables;
  const isEffectivelyOpen = (t: TableView) =>
    t.hasOpenOrder && (t.itemCount > 0 || Number(t.totalAmount || 0) > 0);
  const withOrder = filtered.filter(t => isEffectivelyOpen(t));
  const withoutOrder = filtered.filter(t => !isEffectivelyOpen(t));
  const occupiedCount = activeTables.filter(t => isEffectivelyOpen(t)).length;

  const now = new Date();
  const dayName = now.toLocaleDateString("es-CR", { weekday: "long" });
  const timeStr = now.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit", hour12: true });

  return (
    <div className="screen-tables page-enter">
      <style>{`
        .screen-tables {
          background: var(--s0);
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          font-family: var(--f-body);
          color: var(--text);
        }

        .tables-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          padding: 0 18px 10px;
        }

        .table-card {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-md);
          padding: 14px;
          cursor: pointer;
          transition: all var(--t-fast);
          position: relative;
          text-decoration: none;
          display: block;
          color: var(--text);
        }
        .table-card:active { background: var(--s2); }
        .table-card.qr { border-color: rgba(243,156,18,0.4); }
        .table-card.kitchen { border-color: rgba(59,130,246,0.3); }
        .table-card.ready { border-color: rgba(46,204,113,0.4); box-shadow: 0 0 16px rgba(46,204,113,0.12); }
        .table-card.preparing { border-color: rgba(243,156,18,0.3); }
        .table-card.open { border-color: rgba(46,204,113,0.2); }

        .tc-name {
          font-family: var(--f-disp);
          font-size: 20px;
          font-weight: 800;
          margin-bottom: 6px;
        }
        .tc-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px 8px;
          margin-top: 8px;
        }
        @media (min-width: 640px) {
          .tc-meta {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 10px;
          }
        }
        .tc-meta-row {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text3);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .tc-meta-row .val {
          color: var(--text2);
        }
        .tc-amount {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text3);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .tc-amount .val {
          color: var(--green);
          font-weight: 600;
        }

        .tables-free-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          padding: 0 18px 16px;
        }
        .table-card-free {
          background: var(--s1);
          border: 1px solid var(--border-ds);
          border-radius: var(--r-sm);
          padding: 12px;
          text-align: center;
          cursor: pointer;
          transition: all var(--t-fast);
          text-decoration: none;
          display: block;
          color: var(--text);
        }
        .table-card-free:active { background: var(--s2); }
        .tcf-name {
          font-family: var(--f-disp);
          font-size: 16px;
          font-weight: 700;
        }
        .tcf-sub {
          font-family: var(--f-mono);
          font-size: 10px;
          color: var(--text3);
          margin-top: 2px;
        }

        .tables-scroll {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 8px;
        }

        .col-picker-overlay {
          position: fixed;
          inset: 0;
          z-index: 99;
        }
        .col-picker {
          position: absolute;
          top: 52px;
          right: 18px;
          background: var(--s1);
          border: 1px solid var(--border-ds);
          border-radius: var(--r-md);
          padding: 10px;
          z-index: 100;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 140px;
        }
        .col-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: var(--r-xs);
          font-family: var(--f-mono);
          font-size: 12px;
          color: var(--text2);
          cursor: pointer;
          background: none;
          border: none;
          width: 100%;
          text-align: left;
          transition: background var(--t-fast);
        }
        .col-option:active { background: var(--s2); }
        .col-option.active { color: var(--green); }
        .col-check {
          width: 16px; height: 16px;
          border-radius: 4px;
          border: 1.5px solid var(--border2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          flex-shrink: 0;
        }
        .col-option.active .col-check {
          background: var(--green);
          border-color: var(--green);
          color: #050f08;
        }

        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: var(--text3);
          font-family: var(--f-mono);
          font-size: 13px;
        }
      `}</style>

      <div className="screen-header">
        <div style={{ flex: 1 }}>
          <div className="header-title" data-testid="text-page-title">Mesas</div>
          <div className="header-sub" style={{ textTransform: "capitalize" }}>
            {dayName} · {timeStr} · <span style={{ color: "var(--green)" }}>{occupiedCount} activas</span>
          </div>
        </div>
        <button
          className="header-action"
          onClick={() => setShowColumnPicker(!showColumnPicker)}
          data-testid="button-column-settings"
        >
          <Settings size={16} />
        </button>
      </div>

      {showColumnPicker && (
        <>
          <div className="col-picker-overlay" onClick={() => setShowColumnPicker(false)} />
          <div className="col-picker" data-testid="column-selector">
            {COLUMN_OPTIONS.map((col) => (
              <button
                key={col.key}
                className={`col-option ${visibleColumns.has(col.key) ? "active" : ""}`}
                onClick={() => toggleColumn(col.key)}
                data-testid={`toggle-column-${col.key}`}
              >
                <span className="col-check">{visibleColumns.has(col.key) ? "\u2713" : ""}</span>
                {col.label}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="tables-topbar">
        <div className="search-bar">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar mesa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-tables"
          />
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: "0 18px" }}>
          <TablesSkeleton />
        </div>
      ) : tables.length === 0 ? (
        <div className="empty-state">
          No hay mesas configuradas. Configure mesas en Admin.
        </div>
      ) : (
        <div className="tables-scroll">
          <div className="section-label">
            Con cuenta abierta
            <span className="section-count">{withOrder.length}</span>
          </div>

          {withOrder.length > 0 ? (
            <div className="tables-grid stagger-children">
              {withOrder.map(table => {
                const badge = getTableBadge(table);
                const statusCls = getTableStatusClass(table);
                return (
                  <Link key={table.id} href={`/tables/${table.id}`} className={`table-card ${statusCls}`} data-testid={`card-table-${table.id}`}>
                    {table.pendingQrCount > 0 && (
                      <div className="qr-alert">{table.pendingQrCount}</div>
                    )}
                    <div className="tc-name" data-testid={`text-table-name-${table.id}`}>{table.tableName}</div>
                    <div className={badge.cls} data-testid={`badge-status-${table.id}`}>{badge.label}</div>
                    <div className="tc-meta">
                      {visibleColumns.has("waiter") && table.responsibleWaiterName && (
                        <div className="tc-meta-row" data-testid={`text-waiter-${table.id}`}>
                          <User size={11} />
                          <span className="val">{table.responsibleWaiterName}</span>
                        </div>
                      )}
                      {visibleColumns.has("items") && (
                        <div className="tc-meta-row" data-testid={`text-items-${table.id}`}>
                          <UtensilsCrossed size={11} />
                          <span className="val">{table.itemCount} items</span>
                        </div>
                      )}
                      {visibleColumns.has("time") && (
                        <div className="tc-meta-row" data-testid={`text-time-open-${table.id}`}>
                          <Clock size={11} />
                          <span className="val">{formatElapsed(table.openedAt)}</span>
                        </div>
                      )}
                      {visibleColumns.has("amount") && table.totalAmount && (
                        <div className="tc-amount" data-testid={`text-amount-${table.id}`}>
                          <DollarSign size={11} />
                          <span className="val">{formatCurrency(table.totalAmount)}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">Ninguna mesa con cuenta</div>
          )}

          <div className="section-label">
            Libres
            <span className="section-count">{withoutOrder.length}</span>
          </div>

          {withoutOrder.length > 0 ? (
            <div className="tables-free-grid stagger-children">
              {withoutOrder.map(table => (
                <Link key={table.id} href={`/tables/${table.id}`} className="table-card-free" data-testid={`card-table-${table.id}`}>
                  <div className="tcf-name" data-testid={`text-table-name-${table.id}`}>{table.tableName}</div>
                  <div className="tcf-sub">Libre</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">Todas las mesas tienen cuenta</div>
          )}
        </div>
      )}
    </div>
  );
}
