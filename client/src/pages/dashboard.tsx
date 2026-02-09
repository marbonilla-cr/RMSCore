import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { wsManager } from "@/lib/ws";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LayoutDashboard, ShoppingBag, DollarSign,
  TrendingUp, XCircle, Clock, ChevronDown, ChevronRight,
  FileText, Loader2, CreditCard, Eye,
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

interface DashboardData {
  openOrders: { count: number; amount: number; orders: OrderSummary[] };
  paidOrders: { count: number; amount: number; orders: OrderSummary[] };
  cancelledOrders: { count: number; amount: number; orders: OrderSummary[] };
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

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "PAID" || status === "READY") return "default";
  if (status === "VOIDED" || status === "CANCELLED" || status === "VOID") return "destructive";
  return "secondary";
}

function OrderDetailDialog({ orderId, open, onClose }: { orderId: number | null; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery<OrderDetail>({
    queryKey: ["/api/dashboard/orders", orderId],
    enabled: !!orderId && open,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-order-detail-title">
            {isLoading ? "Cargando..." : data ? `Orden #${data.dailyNumber || data.id} (Global: ${data.globalNumber || "—"})` : "Orden"}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <Skeleton className="h-40" />}
        {data && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(data.status)}>{statusLabels[data.status] || data.status}</Badge>
              <span className="text-sm text-muted-foreground">{data.tableName}</span>
              <span className="text-sm text-muted-foreground ml-auto">Abierta: {formatDateTime(data.openedAt)}</span>
            </div>

            <div>
              <h4 className="text-sm font-bold mb-2">Items ({data.items.length})</h4>
              {data.items.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sin ítems</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-order-detail-items">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 font-medium">Producto</th>
                        <th className="text-right p-2 font-medium">Cant</th>
                        <th className="text-right p-2 font-medium">P.Unit</th>
                        <th className="text-right p-2 font-medium">Subtotal</th>
                        <th className="text-left p-2 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map(item => (
                        <tr key={item.id} className="border-b last:border-b-0">
                          <td className="p-2">{item.productName}{item.notes ? ` (${item.notes})` : ""}</td>
                          <td className="p-2 text-right">{item.qty}</td>
                          <td className="p-2 text-right">₡{item.unitPrice.toLocaleString()}</td>
                          <td className="p-2 text-right">₡{item.subtotal.toLocaleString()}</td>
                          <td className="p-2">
                            <Badge variant={statusVariant(item.status)} className="text-[10px]">
                              {statusLabels[item.status] || item.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {data.payments.length > 0 && (
              <div>
                <h4 className="text-sm font-bold mb-2">Pagos ({data.payments.length})</h4>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs" data-testid="table-order-detail-payments">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 font-medium">Método</th>
                        <th className="text-right p-2 font-medium">Monto</th>
                        <th className="text-left p-2 font-medium">Hora</th>
                        <th className="text-left p-2 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payments.map(p => (
                        <tr key={p.id} className="border-b last:border-b-0">
                          <td className="p-2">{p.method}</td>
                          <td className="p-2 text-right">₡{p.amount.toLocaleString()}</td>
                          <td className="p-2">{formatTime(p.paidAt)}</td>
                          <td className="p-2">
                            <Badge variant={statusVariant(p.status)} className="text-[10px]">
                              {statusLabels[p.status] || p.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-sm font-bold">Total</span>
              <span className="text-sm font-bold" data-testid="text-order-detail-total">
                ₡{data.totalAmount.toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OrderListSection({ orders, label }: { orders: OrderSummary[]; label: string }) {
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  if (orders.length === 0) {
    return <p className="text-xs text-muted-foreground py-2 text-center">Sin {label.toLowerCase()}</p>;
  }

  return (
    <>
      <div className="rounded-md border overflow-x-auto mt-2">
        <table className="w-full text-xs" data-testid={`table-${label.toLowerCase().replace(/\s/g, "-")}`}>
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-2 font-medium">#Día</th>
              <th className="text-left p-2 font-medium">#Global</th>
              <th className="text-left p-2 font-medium">Mesa</th>
              <th className="text-right p-2 font-medium">Total</th>
              <th className="text-left p-2 font-medium">Hora</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr
                key={o.id}
                className="border-b last:border-b-0 cursor-pointer hover-elevate"
                onClick={() => setSelectedOrderId(o.id)}
                data-testid={`row-order-${o.id}`}
              >
                <td className="p-2 font-medium">{o.dailyNumber || "—"}</td>
                <td className="p-2 text-muted-foreground">{o.globalNumber || "—"}</td>
                <td className="p-2">{o.tableName}</td>
                <td className="p-2 text-right font-medium">₡{o.totalAmount.toLocaleString()}</td>
                <td className="p-2 text-muted-foreground">{formatTime(o.openedAt)}</td>
                <td className="p-2">
                  <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    return <p className="text-xs text-muted-foreground py-2 text-center">Sin anulaciones</p>;
  }

  return (
    <div className="rounded-md border overflow-x-auto mt-2">
      <table className="w-full text-xs" data-testid="table-voided-items-list">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 font-medium">Producto</th>
            <th className="text-left p-2 font-medium">Mesa</th>
            <th className="text-right p-2 font-medium">Cant</th>
            <th className="text-right p-2 font-medium">Total</th>
            <th className="text-left p-2 font-medium">Razón</th>
            <th className="text-left p-2 font-medium">Hora</th>
          </tr>
        </thead>
        <tbody>
          {items.map(v => (
            <tr key={v.id} className="border-b last:border-b-0" data-testid={`row-voided-${v.id}`}>
              <td className="p-2 font-medium">{v.productName}</td>
              <td className="p-2">{v.tableName}</td>
              <td className="p-2 text-right">{v.qtyVoided}</td>
              <td className="p-2 text-right">₡{v.total.toLocaleString()}</td>
              <td className="p-2 text-muted-foreground">{v.reason || v.notes || "—"}</td>
              <td className="p-2 text-muted-foreground">{formatTime(v.voidedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerDetailTable({ items }: { items: LedgerDetail[] }) {
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-2 text-center">
        Sin detalles
      </p>
    );
  }
  return (
    <div className="mt-2 rounded-md border overflow-x-auto">
      <table className="w-full text-xs" data-testid="table-ledger-details">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 font-medium">Mesa</th>
            <th className="text-right p-2 font-medium">Cant</th>
            <th className="text-right p-2 font-medium">P. Unit</th>
            <th className="text-right p-2 font-medium">Subtotal</th>
            <th className="text-left p-2 font-medium">Origen</th>
            <th className="text-left p-2 font-medium">Hora Pago</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={idx} className="border-b last:border-b-0">
              <td className="p-2">{item.tableNameSnapshot || "—"}</td>
              <td className="p-2 text-right">{item.qty}</td>
              <td className="p-2 text-right">
                ₡{item.unitPrice.toLocaleString()}
              </td>
              <td className="p-2 text-right">
                ₡{item.lineSubtotal.toLocaleString()}
              </td>
              <td className="p-2">{item.origin || "—"}</td>
              <td className="p-2">{formatTime(item.paidAt)}</td>
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
          className="w-full flex items-center justify-between py-1.5 rounded-md hover-elevate cursor-pointer"
          data-testid={`${testIdPrefix}-row-${index}`}
        >
          <div className="flex items-center gap-2 min-w-0">
            {open ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            )}
            <span className="text-xs text-muted-foreground w-5 text-right">
              {index + 1}.
            </span>
            <span className="text-sm font-medium truncate">{name}</span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xs text-muted-foreground">{qty} uds</span>
            <span className="text-sm font-medium">
              ₡{amount.toLocaleString()}
            </span>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <LedgerDetailTable items={details} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function DashboardPage() {
  useEffect(() => {
    wsManager.connect();
    const unsub1 = wsManager.on("order_updated", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    });
    const unsub2 = wsManager.on("payment_completed", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    });
    const unsub3 = wsManager.on("payment_voided", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
    refetchInterval: 30000,
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

  const toggleCard = (key: string) => {
    setExpandedCard(prev => prev === key ? null : key);
  };

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6" /> Dashboard
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1
          className="text-2xl font-bold flex items-center gap-2"
          data-testid="text-page-title"
        >
          <LayoutDashboard className="w-6 h-6" /> Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Resumen del día</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card
          data-testid="card-open-orders"
          className="cursor-pointer hover-elevate"
          onClick={() => toggleCard("open")}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-muted-foreground">
                Órdenes Abiertas
              </span>
              <Clock className="w-4 h-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">
              {data?.openOrders.count || 0}
            </p>
            <p className="text-sm text-muted-foreground">
              ₡{(data?.openOrders.amount || 0).toLocaleString()}
            </p>
            {expandedCard === "open" && (
              <ChevronDown className="w-4 h-4 text-muted-foreground mx-auto mt-1" />
            )}
          </CardContent>
        </Card>

        <Card
          data-testid="card-paid-orders"
          className="cursor-pointer hover-elevate"
          onClick={() => toggleCard("paid")}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-muted-foreground">
                Órdenes Pagadas
              </span>
              <DollarSign className="w-4 h-4 text-green-500" />
            </div>
            <p className="text-2xl font-bold text-green-600">
              {data?.paidOrders.count || 0}
            </p>
            <p className="text-sm text-muted-foreground">
              ₡{(data?.paidOrders.amount || 0).toLocaleString()}
            </p>
            {expandedCard === "paid" && (
              <ChevronDown className="w-4 h-4 text-muted-foreground mx-auto mt-1" />
            )}
          </CardContent>
        </Card>

        <Card
          data-testid="card-voided-items"
          className="cursor-pointer hover-elevate"
          onClick={() => toggleCard("voided")}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-muted-foreground">
                Ítems Anulados
              </span>
              <XCircle className="w-4 h-4 text-destructive" />
            </div>
            <p className="text-2xl font-bold">
              {data?.voidedItemsSummary?.count || 0}
            </p>
            <p className="text-sm text-muted-foreground">
              ₡{(data?.voidedItemsSummary?.amount || 0).toLocaleString()}
            </p>
            {expandedCard === "voided" && (
              <ChevronDown className="w-4 h-4 text-muted-foreground mx-auto mt-1" />
            )}
          </CardContent>
        </Card>
      </div>

      {expandedCard === "open" && (
        <Card className="mb-6" data-testid="card-open-orders-detail">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <Clock className="w-5 h-5" />
            <h3 className="font-bold">Órdenes Abiertas</h3>
          </CardHeader>
          <CardContent>
            <OrderListSection orders={data?.openOrders.orders || []} label="Órdenes Abiertas" />
          </CardContent>
        </Card>
      )}

      {expandedCard === "paid" && (
        <Card className="mb-6" data-testid="card-paid-orders-detail">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <DollarSign className="w-5 h-5" />
            <h3 className="font-bold">Órdenes Pagadas</h3>
          </CardHeader>
          <CardContent>
            <OrderListSection orders={data?.paidOrders.orders || []} label="Órdenes Pagadas" />
          </CardContent>
        </Card>
      )}

      {expandedCard === "voided" && (
        <Card className="mb-6" data-testid="card-voided-items-detail">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <XCircle className="w-5 h-5" />
            <h3 className="font-bold">Ítems Anulados</h3>
          </CardHeader>
          <CardContent>
            <VoidedItemsListSection items={data?.voidedItemsSummary?.items || []} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card data-testid="card-top-products">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <ShoppingBag className="w-5 h-5" />
            <h3 className="font-bold">Top Productos</h3>
          </CardHeader>
          <CardContent>
            {!data?.topProducts || data.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sin datos para hoy
              </p>
            ) : (
              <div className="space-y-1">
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
          </CardContent>
        </Card>

        <Card data-testid="card-top-categories">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            <h3 className="font-bold">Top Categorías</h3>
          </CardHeader>
          <CardContent>
            {!data?.topCategories || data.topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sin datos para hoy
              </p>
            ) : (
              <div className="space-y-1">
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
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card data-testid="card-payment-totals">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <CreditCard className="w-5 h-5" />
            <h3 className="font-bold">Totales por Método de Pago</h3>
          </CardHeader>
          <CardContent>
            {paymentTotals.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                Sin pagos registrados hoy
              </p>
            ) : (
              <div className="space-y-3">
                {paymentTotals.map(([method, amount]) => (
                  <div
                    key={method}
                    className="flex items-center justify-between"
                    data-testid={`payment-method-${method}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="secondary" className="text-xs">
                        {method}
                      </Badge>
                    </div>
                    <span className="text-sm font-medium flex-shrink-0">
                      ₡{Number(amount).toLocaleString()}
                    </span>
                  </div>
                ))}
                <div className="border-t pt-2 flex items-center justify-between">
                  <span className="text-sm font-bold">Total</span>
                  <span
                    className="text-sm font-bold"
                    data-testid="text-payment-grand-total"
                  >
                    ₡
                    {paymentTotals
                      .reduce((sum, [, a]) => sum + Number(a), 0)
                      .toLocaleString()}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-qbo-export">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <FileText className="w-5 h-5" />
            <h3 className="font-bold">Reporte QBO</h3>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Exportar las ventas del día al formato QBO.
            </p>
            <Button
              onClick={() => qboMutation.mutate()}
              disabled={qboMutation.isPending}
              data-testid="button-export-qbo"
            >
              {qboMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Exportando...
                </>
              ) : (
                "Exportar a QBO"
              )}
            </Button>
            {qboStatus && (
              <div className="mt-4" data-testid="qbo-export-status">
                <Badge
                  variant={
                    qboStatus.status === "error" ? "destructive" : "secondary"
                  }
                >
                  {qboStatus.status === "error"
                    ? "Error"
                    : qboStatus.status === "success"
                      ? "Completado"
                      : qboStatus.status}
                </Badge>
                {qboStatus.message && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {qboStatus.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
