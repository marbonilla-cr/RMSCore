import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { wsManager } from "@/lib/ws";
import { formatCurrency } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  LayoutDashboard, ShoppingBag, DollarSign,
  TrendingUp, XCircle, Clock, ChevronDown, ChevronRight,
  FileText, Loader2, CreditCard, Eye, History, CalendarDays, ArrowLeft, Percent, Calculator, Receipt,
} from "lucide-react";

interface LedgerDetail {
  productNameSnapshot: string;
  categoryNameSnapshot: string;
  qty: number;
  unitPrice: number;
  lineSubtotal: number;
  tableNameSnapshot: string;
  origin: string;
  status: string;
  sentToKitchenAt: string | null;
  kdsReadyAt: string | null;
  paidAt: string | null;
}

interface OrderSummary {
  id: number;
  dailyNumber: number | null;
  globalNumber: number | null;
  tableName: string;
  status: string;
  totalAmount: number;
  openedAt: string | null;
  closedAt: string | null;
}

interface VoidedItemSummary {
  id: number;
  tableName: string;
  productName: string;
  qtyVoided: number;
  unitPrice: number;
  total: number;
  reason: string | null;
  notes: string | null;
  voidedAt: string | null;
  voidedBy: string;
}

interface OrderDetailItem {
  id: number;
  productName: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
  status: string;
  origin: string;
  notes: string | null;
}

interface OrderDetailPayment {
  id: number;
  amount: number;
  method: string;
  paidAt: string | null;
  status: string;
}

interface OrderDetail {
  id: number;
  dailyNumber: number | null;
  globalNumber: number | null;
  tableName: string;
  status: string;
  totalAmount: number;
  openedAt: string | null;
  closedAt: string | null;
  items: OrderDetailItem[];
  payments: OrderDetailPayment[];
}

interface TaxBreakdownItem {
  taxName: string;
  taxRate: number;
  inclusive: boolean;
  totalAmount: number;
}

interface DashboardData {
  openOrders: { count: number; amount: number; orders: OrderSummary[] };
  paidOrders: { count: number; amount: number; orders: OrderSummary[] };
  cancelledOrders: { count: number; amount: number; orders: OrderSummary[] };
  totalDiscounts: number;
  totalTaxes: number;
  taxBreakdown: TaxBreakdownItem[];
  voidedItemsSummary: { count: number; amount: number; items: VoidedItemSummary[] };
  topProducts: { name: string; qty: number; amount: number }[];
  topCategories: { name: string; qty: number; amount: number }[];
  ledgerDetails: LedgerDetail[];
  paymentMethodTotals: Record<string, number>;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleTimeString("es-CR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("es-CR", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return "—";
  }
}

const statusLabels: Record<string, string> = {
  OPEN: "Abierta",
  IN_KITCHEN: "En Cocina",
  READY: "Lista",
  PAID: "Pagada",
  CANCELLED: "Cancelada",
  VOID: "Anulada",
  PENDING: "Pendiente",
  PREPARING: "Preparando",
  VOIDED: "Anulado",
};

function statusBadgeClass(status: string): string {
  if (status === "PAID" || status === "READY") return "badge-ds badge-green";
  if (status === "VOIDED" || status === "CANCELLED" || status === "VOID") return "badge-ds badge-red";
  if (status === "IN_KITCHEN" || status === "PREPARING") return "badge-ds badge-blue";
  return "badge-ds badge-muted";
}

function OrderDetailDialog({ orderId, open, onClose }: { orderId: number | null; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery<OrderDetail>({
    queryKey: ["/api/dashboard/orders", orderId],
    enabled: !!orderId && open,
  });

  if (!open) return null;

  return (
    <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ds-dialog">
        <div className="ds-dialog-title" data-testid="text-order-detail-title">
          {isLoading ? "Cargando..." : data ? `Orden #${data.dailyNumber || data.id} (Global: ${data.globalNumber || "—"})` : "Orden"}
        </div>
        {isLoading && <div style={{ height: 160, background: 'var(--s2)', borderRadius: 'var(--r-sm)', animation: 'pulse 2s infinite' }} />}
        {data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span className={statusBadgeClass(data.status)}>{statusLabels[data.status] || data.status}</span>
              <span className="dash-meta">{data.tableName}</span>
              <span className="dash-meta" style={{ marginLeft: 'auto' }}>Abierta: {formatDateTime(data.openedAt)}</span>
            </div>

            <div>
              <div className="dash-section-title">Items ({data.items.length})</div>
              {data.items.length === 0 ? (
                <p className="dash-empty">Sin ítems</p>
              ) : (
                <table className="top-table" data-testid="table-order-detail-items">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th style={{ textAlign: 'right' }}>Cant</th>
                      <th style={{ textAlign: 'right' }}>P.Unit</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map(item => (
                      <tr key={item.id}>
                        <td>{item.productName}{item.notes ? ` (${item.notes})` : ""}</td>
                        <td style={{ textAlign: 'right' }}>{item.qty}</td>
                        <td style={{ textAlign: 'right', fontFamily: 'var(--f-mono)', color: 'var(--text2)' }}>{formatCurrency(item.unitPrice)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(item.subtotal)}</td>
                        <td>
                          <span className={statusBadgeClass(item.status)} style={{ fontSize: 9 }}>
                            {statusLabels[item.status] || item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {data.payments.length > 0 && (
              <div>
                <div className="dash-section-title">Pagos ({data.payments.length})</div>
                <table className="top-table" data-testid="table-order-detail-payments">
                  <thead>
                    <tr>
                      <th>Método</th>
                      <th style={{ textAlign: 'right' }}>Monto</th>
                      <th>Hora</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map(p => (
                      <tr key={p.id}>
                        <td>{p.method}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(p.amount)}</td>
                        <td>{formatTime(p.paidAt)}</td>
                        <td>
                          <span className={statusBadgeClass(p.status)} style={{ fontSize: 9 }}>
                            {statusLabels[p.status] || p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-ds)', paddingTop: 12 }}>
              <span className="dash-section-title" style={{ marginBottom: 0 }}>Total</span>
              <span className="kpi-value" style={{ fontSize: 18, color: 'var(--green)' }} data-testid="text-order-detail-total">
                {formatCurrency(data.totalAmount)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderListSection({ orders, label }: { orders: OrderSummary[]; label: string }) {
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  if (orders.length === 0) {
    return <p className="dash-empty">Sin {label.toLowerCase()}</p>;
  }

  return (
    <>
      <table className="top-table" data-testid={`table-${label.toLowerCase().replace(/\s/g, "-")}`}>
        <thead>
          <tr>
            <th>#Día</th>
            <th>#Global</th>
            <th>Mesa</th>
            <th style={{ textAlign: 'right' }}>Total</th>
            <th>Hora</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map(o => (
            <tr
              key={o.id}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedOrderId(o.id)}
              data-testid={`row-order-${o.id}`}
            >
              <td style={{ fontWeight: 600 }}>{o.dailyNumber || "—"}</td>
              <td style={{ color: 'var(--text3)' }}>{o.globalNumber || "—"}</td>
              <td>{o.tableName}</td>
              <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(o.totalAmount)}</td>
              <td style={{ color: 'var(--text3)' }}>{formatTime(o.openedAt)}</td>
              <td>
                <Eye className="w-3.5 h-3.5" style={{ color: 'var(--text3)' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <OrderDetailDialog
        orderId={selectedOrderId}
        open={!!selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </>
  );
}

function VoidedItemsListSection({ items }: { items: VoidedItemSummary[] }) {
  if (items.length === 0) {
    return <p className="dash-empty">Sin anulaciones</p>;
  }

  return (
    <table className="top-table" data-testid="table-voided-items-list">
      <thead>
        <tr>
          <th>Producto</th>
          <th>Mesa</th>
          <th style={{ textAlign: 'right' }}>Cant</th>
          <th style={{ textAlign: 'right' }}>Total</th>
          <th>Razón</th>
          <th>Anuló</th>
          <th>Hora</th>
        </tr>
      </thead>
      <tbody>
        {items.map(v => (
          <tr key={v.id} data-testid={`row-voided-${v.id}`}>
            <td style={{ fontWeight: 500 }}>{v.productName}</td>
            <td>{v.tableName}</td>
            <td style={{ textAlign: 'right' }}>{v.qtyVoided}</td>
            <td style={{ textAlign: 'right' }}>{formatCurrency(v.total)}</td>
            <td style={{ color: 'var(--text3)' }}>{v.reason || v.notes || "—"}</td>
            <td data-testid={`text-voided-by-${v.id}`}>{v.voidedBy}</td>
            <td style={{ color: 'var(--text3)' }}>{formatTime(v.voidedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LedgerDetailTable({ items }: { items: LedgerDetail[] }) {
  if (items.length === 0) {
    return <p className="dash-empty">Sin detalles</p>;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <table className="top-table" data-testid="table-ledger-details">
        <thead>
          <tr>
            <th>Mesa</th>
            <th style={{ textAlign: 'right' }}>Cant</th>
            <th style={{ textAlign: 'right' }}>P. Unit</th>
            <th style={{ textAlign: 'right' }}>Subtotal</th>
            <th>Origen</th>
            <th>Hora Pago</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx}>
              <td>{item.tableNameSnapshot || "—"}</td>
              <td style={{ textAlign: 'right' }}>{item.qty}</td>
              <td style={{ textAlign: 'right', fontFamily: 'var(--f-mono)', color: 'var(--text2)' }}>
                {formatCurrency(item.unitPrice)}
              </td>
              <td style={{ textAlign: 'right' }}>
                {formatCurrency(item.lineSubtotal)}
              </td>
              <td>{item.origin || "—"}</td>
              <td>{formatTime(item.paidAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpandableRow({
  index,
  name,
  qty,
  amount,
  details,
  testIdPrefix,
}: {
  index: number;
  name: string;
  qty: number;
  amount: number;
  details: LedgerDetail[];
  testIdPrefix: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="expand-row"
          data-testid={`${testIdPrefix}-row-${index}`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {open ? (
              <ChevronDown className="w-3.5 h-3.5" style={{ color: 'var(--text3)', flexShrink: 0 }} />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text3)', flexShrink: 0 }} />
            )}
            <span className="expand-idx">{index + 1}.</span>
            <span className="expand-name">{name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <span className="expand-qty">{qty} uds</span>
            <span className="expand-amount">{formatCurrency(amount)}</span>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <LedgerDetailTable items={details} />
      </CollapsibleContent>
    </Collapsible>
  );
}

type PeriodType = "day" | "month" | "year" | "range" | "hour";

function getToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

function getDateRange(period: PeriodType, dateValue: string): { from: string; to: string } {
  if (period === "day") {
    return { from: dateValue, to: dateValue };
  }
  if (period === "month") {
    const [y, m] = dateValue.split("-");
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(lastDay).padStart(2, "0")}` };
  }
  if (period === "year") {
    return { from: `${dateValue}-01-01`, to: `${dateValue}-12-31` };
  }
  return { from: dateValue, to: dateValue };
}

function formatPeriodLabel(period: PeriodType, dateValue: string): string {
  if (period === "day") {
    try {
      return new Date(dateValue + "T12:00:00").toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch { return dateValue; }
  }
  if (period === "month") {
    const [y, m] = dateValue.split("-");
    try {
      const d = new Date(Number(y), Number(m) - 1, 15);
      return d.toLocaleDateString("es-CR", { month: "long", year: "numeric" });
    } catch { return dateValue; }
  }
  if (period === "year") {
    return `Año ${dateValue}`;
  }
  return dateValue;
}

export default function DashboardPage() {
  const [historicalMode, setHistoricalMode] = useState(false);
  const [period, setPeriod] = useState<PeriodType>("day");
  const [dateValue, setDateValue] = useState(getToday());
  const [rangeFrom, setRangeFrom] = useState(getToday());
  const [rangeTo, setRangeTo] = useState(getToday());
  const [hourFrom, setHourFrom] = useState(0);
  const [hourTo, setHourTo] = useState(23);

  const queryParams = (() => {
    if (!historicalMode) return "";
    if (period === "range") {
      return `?from=${rangeFrom}&to=${rangeTo}`;
    }
    if (period === "hour") {
      return `?from=${dateValue}&to=${dateValue}&hourFrom=${hourFrom}&hourTo=${hourTo}`;
    }
    const { from, to } = getDateRange(period, dateValue);
    return `?from=${from}&to=${to}`;
  })();

  useEffect(() => {
    if (historicalMode) return;
    wsManager.connect();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard", ""] });
    };
    const unsub1 = wsManager.on("order_updated", invalidate);
    const unsub2 = wsManager.on("payment_completed", invalidate);
    const unsub3 = wsManager.on("payment_voided", invalidate);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [historicalMode]);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard${queryParams}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando datos");
      return res.json();
    },
    refetchInterval: historicalMode ? false : 10000,
  });

  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const [qboStatus, setQboStatus] = useState<{
    status: string;
    message?: string;
  } | null>(null);

  const qboMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/qbo/export");
      return await res.json();
    },
    onSuccess: (responseData) => {
      setQboStatus(responseData);
    },
    onError: (error: Error) => {
      setQboStatus({ status: "error", message: error.message });
    },
  });

  const ledgerDetails = data?.ledgerDetails || [];

  const paymentTotals = (() => {
    const totals = data?.paymentMethodTotals || {};
    return Object.entries(totals).sort((a, b) => Number(b[1]) - Number(a[1]));
  })();

  const maxPayment = paymentTotals.length > 0 ? Math.max(...paymentTotals.map(([, a]) => Number(a))) : 1;

  const toggleCard = (key: string) => {
    setExpandedCard(prev => prev === key ? null : key);
  };

  const handlePeriodChange = (newPeriod: PeriodType) => {
    setPeriod(newPeriod);
    if (newPeriod === "day") {
      setDateValue(getToday());
    } else if (newPeriod === "month") {
      setDateValue(getToday().slice(0, 7));
    } else if (newPeriod === "year") {
      setDateValue(String(new Date().getFullYear()));
    } else if (newPeriod === "range") {
      setRangeFrom(getToday());
      setRangeTo(getToday());
    } else if (newPeriod === "hour") {
      setDateValue(getToday());
      setHourFrom(0);
      setHourTo(23);
    }
  };

  const currentYears = (() => {
    const curr = new Date().getFullYear();
    const years: string[] = [];
    for (let y = curr; y >= curr - 5; y--) {
      years.push(String(y));
    }
    return years;
  })();

  if (isLoading) {
    return (
      <div className="dash-layout">
        <style>{dashStyles}</style>
        <div className="dash-header">
          <LayoutDashboard size={22} />
          <span className="dash-title">Dashboard</span>
        </div>
        <div className="kpi-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="kpi-card" style={{ height: 100, background: 'var(--s2)', animation: 'pulse 2s infinite' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="dash-layout">
      <style>{dashStyles}</style>

      <div className="dash-header">
        <LayoutDashboard size={22} />
        <span className="dash-title" data-testid="text-page-title">Dashboard</span>
        <div className="dash-date-controls">
          {!historicalMode ? (
            <button
              className="btn-secondary"
              onClick={() => { setHistoricalMode(true); handlePeriodChange("day"); }}
              data-testid="button-historical"
            >
              <History className="w-4 h-4" />
              Histórico
            </button>
          ) : (
            <button
              className="btn-secondary"
              onClick={() => setHistoricalMode(false)}
              data-testid="button-back-today"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver a Hoy
            </button>
          )}
        </div>
      </div>

      {!historicalMode ? (
        <div style={{ padding: '0 18px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="dash-meta">Resumen del día</span>
          <span data-testid="badge-hoy" style={{
            background: 'rgba(74,124,89,0.09)', color: '#4a7c59',
            border: '1px solid rgba(74,124,89,0.22)',
            borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600,
          }}>Hoy</span>
        </div>
      ) : (
        <div style={{ padding: '0 18px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <CalendarDays className="w-4 h-4" style={{ color: 'var(--text3)' }} />
            <select
              className="dash-field"
              value={period}
              onChange={(e) => handlePeriodChange(e.target.value as PeriodType)}
              data-testid="select-period"
            >
              <option value="day">Por Día</option>
              <option value="month">Por Mes</option>
              <option value="year">Por Año</option>
              <option value="hour">Por Hora</option>
              <option value="range">Rango</option>
            </select>

            {period === "day" && (
              <input
                type="date"
                className="dash-field date-input"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                data-testid="input-date-day"
              />
            )}

            {period === "month" && (
              <input
                type="month"
                className="dash-field date-input"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                data-testid="input-date-month"
              />
            )}

            {period === "year" && (
              <select
                className="dash-field"
                value={dateValue}
                onChange={(e) => setDateValue(e.target.value)}
                data-testid="select-year"
              >
                {currentYears.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}

            {period === "hour" && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <input
                  type="date"
                  className="dash-field date-input"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  data-testid="input-date-hour"
                />
                <span className="dash-meta">De:</span>
                <select
                  className="dash-field"
                  value={String(hourFrom)}
                  onChange={(e) => setHourFrom(Number(e.target.value))}
                  data-testid="select-hour-from"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>{String(i).padStart(2, "0")}:00</option>
                  ))}
                </select>
                <span className="dash-meta">A:</span>
                <select
                  className="dash-field"
                  value={String(hourTo)}
                  onChange={(e) => setHourTo(Number(e.target.value))}
                  data-testid="select-hour-to"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={String(i)}>{String(i).padStart(2, "0")}:59</option>
                  ))}
                </select>
              </div>
            )}

            {period === "range" && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span className="dash-meta">Desde:</span>
                <input
                  type="date"
                  className="dash-field date-input"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  data-testid="input-range-from"
                />
                <span className="dash-meta">Hasta:</span>
                <input
                  type="date"
                  className="dash-field date-input"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  data-testid="input-range-to"
                />
              </div>
            )}
          </div>
          <span className="dash-meta" data-testid="text-period-label">
            {period === "range"
              ? `${rangeFrom} al ${rangeTo}`
              : period === "hour"
                ? `${dateValue} de ${String(hourFrom).padStart(2, "0")}:00 a ${String(hourTo).padStart(2, "0")}:59`
                : formatPeriodLabel(period, dateValue)}
          </span>
          {dateValue === getToday() && period === "day" && (
            <span data-testid="badge-hoy-hist" style={{
              background: 'rgba(74,124,89,0.09)', color: '#4a7c59',
              border: '1px solid rgba(74,124,89,0.22)',
              borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 600,
            }}>Hoy</span>
          )}
        </div>
      )}

      <div className="kpi-grid">
        <div
          className="kpi-card amber"
          data-testid="card-open-orders"
          onClick={() => toggleCard("open")}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-label">Órdenes Abiertas</span>
            <Clock className="w-4 h-4" style={{ color: 'var(--text3)' }} />
          </div>
          <span className="kpi-value">{data?.openOrders.count || 0}</span>
          <span className="kpi-sub">{formatCurrency(data?.openOrders.amount || 0)}</span>
          {expandedCard === "open" && (
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text3)', alignSelf: 'center' }} />
          )}
        </div>

        <div
          className="kpi-card green"
          data-testid="card-paid-orders"
          onClick={() => toggleCard("paid")}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-label">Órdenes Pagadas</span>
            <DollarSign className="w-4 h-4" style={{ color: 'var(--green)' }} />
          </div>
          <span className="kpi-value" style={{ color: 'var(--green)' }}>{data?.paidOrders.count || 0}</span>
          <span className="kpi-sub">{formatCurrency(data?.paidOrders.amount || 0)}</span>
          {expandedCard === "paid" && (
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text3)', alignSelf: 'center' }} />
          )}
        </div>

        <div className="kpi-card blue" data-testid="card-total-projected">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-label">Venta Neta Proyectada</span>
            <Calculator className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <span className="kpi-value" style={{ color: 'var(--blue)' }}>
            {formatCurrency((data?.openOrders.amount || 0) + (data?.paidOrders.amount || 0) - (data?.totalDiscounts || 0) - (data?.totalTaxes || 0))}
          </span>
          <span className="kpi-sub" style={{ fontSize: 10 }}>Abiertas + Pagadas - Desc - Imp</span>
        </div>

        <div
          className="kpi-card purple"
          data-testid="card-taxes"
          onClick={() => toggleCard("taxes")}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-label">Impuestos</span>
            <Receipt className="w-4 h-4" style={{ color: 'var(--purple, #a855f7)' }} />
          </div>
          <span className="kpi-value" style={{ color: 'var(--purple, #a855f7)' }}>{formatCurrency(data?.totalTaxes || 0)}</span>
          {expandedCard === "taxes" && (
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text3)', alignSelf: 'center' }} />
          )}
        </div>

        <div className="kpi-card amber" data-testid="card-discounts">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-label">Descuentos</span>
            <Percent className="w-4 h-4" style={{ color: 'var(--amber)' }} />
          </div>
          <span className="kpi-value" style={{ color: 'var(--amber)' }}>{formatCurrency(data?.totalDiscounts || 0)}</span>
        </div>

        <div
          className="kpi-card red"
          data-testid="card-voided-items"
          onClick={() => toggleCard("voided")}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="kpi-label">Items Anulados</span>
            <XCircle className="w-4 h-4" style={{ color: 'var(--red)' }} />
          </div>
          <span className="kpi-value">{data?.voidedItemsSummary?.count || 0}</span>
          <span className="kpi-sub">{formatCurrency(data?.voidedItemsSummary?.amount || 0)}</span>
          {expandedCard === "voided" && (
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text3)', alignSelf: 'center' }} />
          )}
        </div>
      </div>

      {expandedCard === "open" && (
        <div className="voided-section" data-testid="card-open-orders-detail">
          <div className="dash-section-title" style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Clock className="w-5 h-5" /> Órdenes Abiertas
          </div>
          <div style={{ padding: '0 16px 14px' }}>
            <OrderListSection orders={data?.openOrders.orders || []} label="Órdenes Abiertas" />
          </div>
        </div>
      )}

      {expandedCard === "paid" && (
        <div className="voided-section" data-testid="card-paid-orders-detail">
          <div className="dash-section-title" style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <DollarSign className="w-5 h-5" /> Órdenes Pagadas
          </div>
          <div style={{ padding: '0 16px 14px' }}>
            <OrderListSection orders={data?.paidOrders.orders || []} label="Órdenes Pagadas" />
          </div>
        </div>
      )}

      {expandedCard === "taxes" && (
        <div className="voided-section" data-testid="card-taxes-detail">
          <div className="dash-section-title" style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Receipt className="w-5 h-5" /> Desglose de Impuestos
          </div>
          <div style={{ padding: '0 16px 14px' }}>
            {(!data?.taxBreakdown || data.taxBreakdown.length === 0) ? (
              <p className="dash-empty">Sin impuestos registrados en este período</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data.taxBreakdown.map((tax, i) => (
                  <div
                    key={i}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                    data-testid={`tax-breakdown-${i}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span className="badge-ds badge-muted">
                        {tax.taxName} ({tax.taxRate}%)
                      </span>
                      <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--text3)' }}>
                        {tax.inclusive ? "Incluido" : "Aditivo"}
                      </span>
                    </div>
                    <span className="expand-amount" style={{ flexShrink: 0 }}>
                      {formatCurrency(tax.totalAmount)}
                    </span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid var(--border-ds)', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="dash-section-title" style={{ marginBottom: 0 }}>Total Impuestos</span>
                  <span className="expand-amount" style={{ color: 'var(--green)' }} data-testid="text-tax-grand-total">
                    {formatCurrency(data?.totalTaxes || 0)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {expandedCard === "voided" && (
        <div className="voided-section" data-testid="card-voided-items-detail">
          <div className="dash-section-title" style={{ padding: '14px 16px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <XCircle className="w-5 h-5" /> Items Anulados
          </div>
          <div style={{ padding: '0 16px 14px', overflowX: 'auto' }}>
            <VoidedItemsListSection items={data?.voidedItemsSummary?.items || []} />
          </div>
        </div>
      )}

      <div className="dash-two-col">
        <div className="dash-section" data-testid="card-top-products">
          <div className="dash-section-label">
            <ShoppingBag className="w-4 h-4" />
            Top Productos
          </div>
          {!data?.topProducts || data.topProducts.length === 0 ? (
            <p className="dash-empty">Sin datos para este período</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {data.topProducts.map((item, i) => {
                const details = ledgerDetails.filter(
                  (d) => d.productNameSnapshot === item.name
                );
                return (
                  <ExpandableRow
                    key={i}
                    index={i}
                    name={item.name}
                    qty={item.qty}
                    amount={item.amount}
                    details={details}
                    testIdPrefix="product"
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="dash-section" data-testid="card-top-categories">
          <div className="dash-section-label">
            <TrendingUp className="w-4 h-4" />
            Top Categorías
          </div>
          {!data?.topCategories || data.topCategories.length === 0 ? (
            <p className="dash-empty">Sin datos para este período</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {data.topCategories.map((item, i) => {
                const details = ledgerDetails.filter(
                  (d) => d.categoryNameSnapshot === item.name
                );
                return (
                  <ExpandableRow
                    key={i}
                    index={i}
                    name={item.name}
                    qty={item.qty}
                    amount={item.amount}
                    details={details}
                    testIdPrefix="category"
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="dash-two-col">
        <div className="dash-section" data-testid="card-payment-totals">
          <div className="dash-section-label">
            <CreditCard className="w-4 h-4" />
            Totales por Método de Pago
          </div>
          {paymentTotals.length === 0 ? (
            <p className="dash-empty">Sin pagos registrados en este período</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {paymentTotals.map(([method, amount]) => (
                <div
                  key={method}
                  className="payment-row"
                  data-testid={`payment-method-${method}`}
                >
                  <span className="pr-method">{method}</span>
                  <div className="pr-bar-wrap">
                    <div className="pr-bar" style={{ width: `${(Number(amount) / maxPayment) * 100}%` }} />
                  </div>
                  <span className="pr-amount">{formatCurrency(Number(amount))}</span>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--border-ds)', paddingTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="dash-section-title" style={{ marginBottom: 0 }}>Total</span>
                <span
                  className="expand-amount"
                  style={{ color: 'var(--green)' }}
                  data-testid="text-payment-grand-total"
                >
                  {formatCurrency(paymentTotals.reduce((sum, [, a]) => sum + Number(a), 0))}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="dash-section" data-testid="card-qbo-export">
          <div className="dash-section-label">
            <FileText className="w-4 h-4" />
            Reporte QBO
          </div>
          <p className="dash-meta" style={{ marginBottom: 12 }}>
            Exportar las ventas del día al formato QBO.
          </p>
          <button
            className="btn-secondary"
            onClick={() => qboMutation.mutate()}
            disabled={qboMutation.isPending}
            data-testid="button-export-qbo"
            style={{ width: '100%' }}
          >
            {qboMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Exportando...
              </>
            ) : (
              "Exportar a QBO"
            )}
          </button>
          {qboStatus && (
            <div style={{ marginTop: 12 }} data-testid="qbo-export-status">
              <span className={`badge-ds ${qboStatus.status === "error" ? "badge-red" : "badge-green"}`}>
                {qboStatus.status === "error"
                  ? "Error"
                  : qboStatus.status === "success"
                    ? "Completado"
                    : qboStatus.status}
              </span>
              {qboStatus.message && (
                <p className="dash-meta" style={{ marginTop: 6 }}>
                  {qboStatus.message}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const dashStyles = `
  .dash-layout {
    background: var(--bg);
    min-height: 100dvh;
    font-family: var(--f-body);
    color: var(--text);
    padding-bottom: 24px;
  }

  .dash-header {
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    background: var(--s0);
    border-bottom: 1px solid var(--border-ds);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .dash-title {
    font-family: var(--f-disp);
    font-size: 20px;
    font-weight: 800;
    color: var(--text);
  }

  .dash-date-controls {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-left: auto;
  }

  .dash-meta {
    font-family: var(--f-mono);
    font-size: 12px;
    color: var(--text3);
  }

  .dash-field {
    background: var(--s2);
    border: 1.5px solid var(--border-ds);
    border-radius: var(--r-sm);
    color: var(--text);
    padding: 8px 12px;
    font-family: var(--f-body);
    font-size: 14px;
    outline: none;
  }
  .dash-field:focus {
    border-color: var(--green-m);
  }

  .date-input {
    max-width: 160px;
    font-family: var(--f-mono);
    font-size: 12px;
    padding: 7px 10px;
  }

  .dash-empty {
    font-family: var(--f-mono);
    font-size: 12px;
    color: var(--text3);
    text-align: center;
    padding: 16px 0;
    margin: 0;
  }

  .dash-section-title {
    font-family: var(--f-disp);
    font-size: 14px;
    font-weight: 700;
    color: var(--text);
    margin-bottom: 8px;
  }

  /* KPI Grid */
  .kpi-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 14px 18px;
  }
  @media (min-width: 768px) {
    .kpi-grid { grid-template-columns: repeat(3, 1fr); }
  }

  .kpi-card {
    background: var(--s1);
    border: 1.5px solid var(--border-ds);
    border-radius: var(--r-md);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
    transition: all var(--t-fast);
  }
  .kpi-card:active { background: var(--s2); }
  .kpi-card.green  { border-top: 3px solid var(--green); }
  .kpi-card.blue   { border-top: 3px solid var(--blue); }
  .kpi-card.red    { border-top: 3px solid var(--red); }
  .kpi-card.amber  { border-top: 3px solid var(--amber); }
  .kpi-card.purple { border-top: 3px solid var(--purple, #a855f7); }

  .kpi-value {
    font-family: var(--f-mono);
    font-size: 22px;
    font-weight: 600;
    color: var(--text);
  }
  .kpi-label {
    font-family: var(--f-mono);
    font-size: 10px;
    color: var(--text3);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .kpi-sub {
    font-family: var(--f-mono);
    font-size: 12px;
    color: var(--text2);
  }

  /* Expanded detail panels */
  .voided-section {
    background: var(--s1);
    border: 1px solid var(--border-ds);
    border-radius: var(--r-md);
    overflow: hidden;
    margin: 0 18px 16px;
  }

  /* Two-column layout */
  .dash-two-col {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    padding: 0 18px 14px;
  }
  @media (min-width: 768px) {
    .dash-two-col { grid-template-columns: 1fr 1fr; }
  }

  .dash-section {
    background: var(--s1);
    border: 1.5px solid var(--border-ds);
    border-radius: var(--r-md);
    padding: 14px;
  }

  .dash-section-label {
    font-family: var(--f-disp);
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }

  /* Payment bars */
  .payment-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .pr-method {
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--text3);
    width: 70px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex-shrink: 0;
  }
  .pr-bar-wrap {
    flex: 1;
    height: 6px;
    background: var(--s3);
    border-radius: 4px;
    overflow: hidden;
  }
  .pr-bar {
    height: 100%;
    background: var(--green);
    border-radius: 4px;
    transition: width 0.8s ease;
  }
  .pr-amount {
    font-family: var(--f-mono);
    font-size: 12px;
    color: var(--text);
    width: 90px;
    text-align: right;
    flex-shrink: 0;
  }

  /* Top tables */
  .top-table {
    width: 100%;
    border-collapse: collapse;
  }
  .top-table th {
    font-family: var(--f-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text3);
    padding: 6px 4px;
    border-bottom: 1px solid var(--border-ds);
    text-align: left;
    font-weight: 500;
  }
  .top-table td {
    padding: 9px 4px;
    border-bottom: 1px solid var(--border-ds);
    font-size: 13px;
    color: var(--text);
  }
  .top-table td:last-child {
    font-family: var(--f-mono);
    color: var(--green);
    text-align: right;
  }
  .top-table tbody tr:hover {
    background: var(--s2);
  }

  /* Expandable rows */
  .expand-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 4px;
    border-radius: var(--r-sm);
    cursor: pointer;
    background: none;
    border: none;
    color: var(--text);
    transition: background var(--t-fast);
  }
  .expand-row:hover { background: var(--s2); }
  .expand-idx {
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--text3);
    width: 20px;
    text-align: right;
  }
  .expand-name {
    font-family: var(--f-body);
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .expand-qty {
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--text3);
  }
  .expand-amount {
    font-family: var(--f-mono);
    font-size: 13px;
    font-weight: 600;
    color: var(--green);
  }

  /* Dialog overlay */
  .ds-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .ds-dialog {
    background: var(--s1);
    border: 1.5px solid var(--border-ds);
    border-radius: var(--r-lg);
    padding: 20px;
    max-width: 560px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
  }
  .ds-dialog-title {
    font-family: var(--f-disp);
    font-size: 18px;
    font-weight: 800;
    margin-bottom: 16px;
    color: var(--text);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;
