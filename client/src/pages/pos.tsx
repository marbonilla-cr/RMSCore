import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { wsManager } from "@/lib/ws";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, DollarSign, Loader2, Receipt,
  Banknote, ArrowLeft, Lock, Unlock,
  Split, Trash2, XCircle, Mail, Printer, ArrowRight, ArrowLeftRight,
  Percent, X, Plus, Minus,
} from "lucide-react";
import type { PaymentMethod } from "@shared/schema";
import { printReceipt } from "@/lib/print-receipt";

interface POSItemModifier {
  id: number;
  nameSnapshot: string;
  priceDeltaSnapshot: string;
  qty: number;
}

interface POSItemDiscount {
  id: number;
  discountName: string;
  discountType: string;
  discountValue: string;
  amountApplied: string;
}

interface POSItemTax {
  id: number;
  taxName: string;
  taxRate: string;
  taxAmount: string;
}

interface POSItem {
  id: number;
  productNameSnapshot: string;
  qty: number;
  productPriceSnapshot: string;
  status: string;
  notes?: string | null;
  modifiers?: POSItemModifier[];
  discounts?: POSItemDiscount[];
  taxes?: POSItemTax[];
}

interface TaxBreakdownEntry {
  taxName: string;
  taxRate: string;
  inclusive: boolean;
  totalAmount: number;
}

interface POSTable {
  id: number;
  tableName: string;
  orderId: number;
  dailyNumber?: number | null;
  globalNumber?: number | null;
  totalAmount: string;
  openedAt?: string | null;
  itemCount: number;
  items: POSItem[];
  totalDiscounts?: string;
  totalTaxes?: string;
  taxBreakdown?: TaxBreakdownEntry[];
}

interface SplitAccountData {
  id: number;
  orderId: number;
  label: string;
  items: { id: number; splitId: number; orderItemId: number }[];
}

export default function POSPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const isManager = user?.role === "MANAGER";

  const canPay = hasPermission("POS_PAY");
  const canSplit = hasPermission("POS_SPLIT");
  const canPrint = hasPermission("POS_PRINT");
  const canEmailTicket = hasPermission("POS_EMAIL_TICKET");
  const canEditCustomerPrepay = hasPermission("POS_EDIT_CUSTOMER_PREPAY");
  const canVoid = hasPermission("POS_VOID");
  const canReopen = hasPermission("POS_REOPEN");
  const canVoidOrder = hasPermission("POS_VOID_ORDER");
  const canCashClose = hasPermission("CASH_CLOSE");

  const [tab, setTab] = useState("tables");
  const [selectedTable, setSelectedTable] = useState<POSTable | null>(null);
  const [detailView, setDetailView] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [payingSplitId, setPayingSplitId] = useState<number | null>(null);

  const [cashOpen, setCashOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [splitLabel, setSplitLabel] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  const [movingItemId, setMovingItemId] = useState<number | null>(null);
  const [lastPaidOrder, setLastPaidOrder] = useState<{orderId: number; tableName: string; orderNumber: string; paymentMethod: string; clientName?: string; _items: {name:string;qty:number;price:number;total:number}[]; _totalAmount: number; _totalDiscounts?: number; _totalTaxes?: number; _taxBreakdown?: TaxBreakdownEntry[]} | null>(null);
  const [printingDirect, setPrintingDirect] = useState(false);

  const [voidOrderOpen, setVoidOrderOpen] = useState(false);
  const [voidOrderId, setVoidOrderId] = useState<number | null>(null);
  const [voidOrderReason, setVoidOrderReason] = useState("");
  const [activeSplitId, setActiveSplitId] = useState<number | null>(null);
  const [highlightedOrderIds, setHighlightedOrderIds] = useState<number[]>([]);

  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountItemId, setDiscountItemId] = useState<number | null>(null);
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [discountName, setDiscountName] = useState("Descuento");

  useEffect(() => {
    wsManager.connect();
    const unsub1 = wsManager.on("order_updated", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      if (selectedTable?.orderId) {
        queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable.orderId, "splits"] });
        queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable.orderId, "payments"] });
      }
    });
    const unsub2 = wsManager.on("table_status_changed", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
    });
    const unsub3 = wsManager.on("payment_completed", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
    });
    const unsub4 = wsManager.on("payment_voided", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, [selectedTable?.orderId]);

  const { data: posTables = [], isLoading } = useQuery<POSTable[]>({
    queryKey: ["/api/pos/tables"],
    refetchInterval: 10000,
  });

  const { data: paymentMethods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ["/api/pos/payment-methods"],
  });

  const { data: cashSession } = useQuery<any>({
    queryKey: ["/api/pos/cash-session"],
  });

  const { data: splits = [], isLoading: splitsLoading } = useQuery<SplitAccountData[]>({
    queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"],
    enabled: !!selectedTable?.orderId && detailView,
  });

  const { data: orderPayments = [] } = useQuery<any[]>({
    queryKey: ["/api/pos/orders", selectedTable?.orderId, "payments"],
    enabled: !!selectedTable?.orderId && detailView && (canVoid || canReopen),
  });

  const assignedItemIds = splits.flatMap((s) => s.items.map((si) => si.orderItemId));

  const getItemUnitPrice = (item: POSItem) => {
    const base = Number(item.productPriceSnapshot);
    const modTotal = (item.modifiers || []).reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
    return base + modTotal;
  };

  const getItemTotal = (item: POSItem) =>
    getItemUnitPrice(item) * item.qty;

  const getSplitTotal = (split: SplitAccountData) => {
    if (!selectedTable) return 0;
    return split.items.reduce((sum, si) => {
      const oi = selectedTable.items.find((i) => i.id === si.orderItemId);
      return sum + (oi ? getItemTotal(oi) : 0);
    }, 0);
  };

  const nextSplitLabel = () => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const idx = splits.length;
    return `Subcuenta ${letters[idx % letters.length]}`;
  };

  const { data: businessCfg } = useQuery<any>({
    queryKey: ["/api/business-config"],
  });

  const triggerReceiptPrint = (items: { name: string; qty: number; price: number; total: number }[], total: number, pmName: string, tblName: string, ordNum: string, clName?: string, discounts?: number, taxes?: number, taxBk?: TaxBreakdownEntry[]) => {
    const cfg = businessCfg || {};
    printReceipt({
      businessName: cfg.businessName || "",
      legalName: cfg.legalName || "",
      taxId: cfg.taxId || "",
      address: cfg.address || "",
      phone: cfg.phone || "",
      email: cfg.email || "",
      legalNote: cfg.legalNote || "",
      orderNumber: ordNum,
      tableName: tblName,
      items,
      totalAmount: total,
      totalDiscounts: discounts,
      totalTaxes: taxes,
      taxBreakdown: taxBk,
      paymentMethod: pmName,
      clientName: clName || undefined,
      cashierName: user?.displayName || undefined,
      date: new Date().toLocaleString("es-CR"),
    });
  };

  const payMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/pos/pay", {
        orderId: selectedTable!.orderId,
        paymentMethodId: parseInt(paymentMethodId),
        amount: selectedTable!.totalAmount,
        clientName: clientName || null,
        clientEmail: clientEmail || null,
      });
    },
    onSuccess: () => {
      const tbl = selectedTable!;
      const pm = paymentMethods.find((m) => m.id === parseInt(paymentMethodId));
      const orderNum = tbl.globalNumber ? `G-${tbl.globalNumber}` : (tbl.dailyNumber ? `D-${tbl.dailyNumber}` : `#${tbl.orderId}`);
      const receiptItems = tbl.items.filter(i => i.status !== "VOIDED").map((i) => ({
        name: i.productNameSnapshot,
        qty: i.qty,
        price: Number(i.productPriceSnapshot),
        total: Number(i.productPriceSnapshot) * i.qty,
      }));

      setLastPaidOrder({
        orderId: tbl.orderId,
        tableName: tbl.tableName,
        orderNumber: orderNum,
        paymentMethod: pm?.paymentName || "",
        clientName: clientName || undefined,
        _items: receiptItems,
        _totalAmount: Number(tbl.totalAmount),
        _totalDiscounts: Number(tbl.totalDiscounts || 0),
        _totalTaxes: Number(tbl.totalTaxes || 0),
        _taxBreakdown: tbl.taxBreakdown,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setPaymentOpen(false);
      setSelectedTable(null);
      setDetailView(false);
      setClientName("");
      setClientEmail("");
      toast({ title: "Pago procesado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const paySplitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/pos/pay-split", {
        splitId: payingSplitId,
        paymentMethodId: parseInt(paymentMethodId),
        clientName: clientName || null,
        clientEmail: clientEmail || null,
      });
    },
    onSuccess: () => {
      const tbl = selectedTable!;
      const pm = paymentMethods.find((m) => m.id === parseInt(paymentMethodId));
      const split = splits.find((s) => s.id === payingSplitId);
      let receiptItems: { name: string; qty: number; price: number; total: number }[] = [];
      let total = 0;
      if (split && tbl) {
        receiptItems = split.items.map((si) => {
          const oi = tbl.items.find((i) => i.id === si.orderItemId);
          const price = oi ? Number(oi.productPriceSnapshot) : 0;
          const qty = oi ? oi.qty : 0;
          return { name: oi?.productNameSnapshot || "", qty, price, total: price * qty };
        });
        total = receiptItems.reduce((s, i) => s + i.total, 0);
      }
      const orderNum = tbl?.globalNumber ? `G-${tbl.globalNumber}` : (tbl?.dailyNumber ? `D-${tbl.dailyNumber}` : `#${tbl?.orderId}`);
      triggerReceiptPrint(receiptItems, total, pm?.paymentName || "", tbl?.tableName || "", `${orderNum} (${split?.label || ""})`, clientName || undefined);

      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      setPaymentOpen(false);
      setPayingSplitId(null);
      setClientName("");
      setClientEmail("");
      toast({ title: "Subcuenta pagada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const createSplitMutation = useMutation({
    mutationFn: async () => {
      const label = splitLabel || nextSplitLabel();
      return apiRequest("POST", `/api/pos/orders/${selectedTable!.orderId}/splits`, {
        label,
        orderItemIds: selectedItemIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      setSelectedItemIds([]);
      setSplitLabel("");
      toast({ title: "Subcuenta creada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteSplitMutation = useMutation({
    mutationFn: async (splitId: number) => {
      return apiRequest("DELETE", `/api/pos/splits/${splitId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      toast({ title: "Subcuenta eliminada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const moveItemMutation = useMutation({
    mutationFn: async ({ orderItemId, fromSplitId, toSplitId }: { orderItemId: number; fromSplitId?: number | null; toSplitId?: number | null }) => {
      return apiRequest("POST", "/api/pos/split-items/move", { orderItemId, fromSplitId: fromSplitId || null, toSplitId: toSplitId || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      setMovingItemId(null);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const voidPaymentMutation = useMutation({
    mutationFn: async (paymentId: number) => {
      return apiRequest("POST", `/api/pos/void-payment/${paymentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      toast({ title: "Pago anulado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reopenOrderMutation = useMutation({
    mutationFn: async (orderId: number) => {
      return apiRequest("POST", `/api/pos/reopen/${orderId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      toast({ title: "Orden reabierta" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const sendTicketMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/pos/send-ticket", {
        orderId: selectedTable!.orderId,
        clientName: clientName || null,
        clientEmail: clientEmail,
      });
    },
    onSuccess: () => {
      toast({ title: "Ticket enviado", description: `Ticket registrado para ${clientEmail}` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCashMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/pos/cash-session/open", { openingCash }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      setCashOpen(false);
      toast({ title: "Caja abierta" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const closeCashMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/pos/cash-session/close", { countedCash, notes: closeNotes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      setCloseOpen(false);
      toast({ title: "Caja cerrada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const applyDiscountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/pos/order-items/${discountItemId}/discount`, {
        discountName,
        discountType,
        discountValue,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      setDiscountOpen(false);
      setDiscountItemId(null);
      setDiscountValue("");
      setDiscountName("Descuento");
      toast({ title: "Descuento aplicado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const removeDiscountMutation = useMutation({
    mutationFn: async (orderItemId: number) => {
      return apiRequest("DELETE", `/api/pos/order-items/${orderItemId}/discount`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      toast({ title: "Descuento eliminado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const voidOrderMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/pos/void-order/${voidOrderId}`, {
        reason: voidOrderReason || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setVoidOrderOpen(false);
      setVoidOrderId(null);
      setVoidOrderReason("");
      setSelectedTable(null);
      setDetailView(false);
      toast({ title: "Orden anulada completamente" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const lastEmptySplit = splits.filter(s => s.items.length === 0).length > 0;

  const removeLastEmptySplit = () => {
    const emptySplits = splits.filter(s => s.items.length === 0);
    if (emptySplits.length > 0) {
      const lastEmpty = emptySplits[emptySplits.length - 1];
      deleteSplitMutation.mutate(lastEmpty.id);
      if (activeSplitId === lastEmpty.id) setActiveSplitId(null);
    }
  };

  const moveSelectedToActive = () => {
    if (!activeSplitId) return;
    selectedItemIds.forEach(itemId => {
      moveItemMutation.mutate({ orderItemId: itemId, fromSplitId: null, toSplitId: activeSplitId });
    });
    setSelectedItemIds([]);
  };

  const openDiscountDialog = (itemId: number) => {
    setDiscountItemId(itemId);
    setDiscountType("percentage");
    setDiscountValue("");
    setDiscountName("Descuento");
    setDiscountOpen(true);
  };

  const activePaymentMethods = paymentMethods.filter((m) => m.active);

  const getOrderSubtotal = (table: POSTable) => {
    return table.items.filter(i => i.status !== "VOIDED" && i.status !== "PAID").reduce((s, i) => s + getItemTotal(i), 0);
  };

  const toggleItemSelection = (itemId: number) => {
    setSelectedItemIds((prev) =>
      prev.includes(itemId) ? prev.filter((id) => id !== itemId) : [...prev, itemId]
    );
  };

  const openPaymentForSplit = (splitId: number) => {
    setPayingSplitId(splitId);
    setPaymentMethodId("");
    setClientName("");
    setClientEmail("");
    setPaymentOpen(true);
  };

  const openPaymentForFull = () => {
    setPayingSplitId(null);
    setPaymentMethodId("");
    setClientName("");
    setClientEmail("");
    setPaymentOpen(true);
  };

  const enterSplitMode = async () => {
    if (!selectedTable) return;
    setNormalizing(true);
    try {
      await apiRequest("POST", `/api/pos/orders/${selectedTable.orderId}/normalize-split`);
      await queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable.orderId, "splits"] });
      const freshTables: POSTable[] = queryClient.getQueryData(["/api/pos/tables"]) || [];
      const freshTable = freshTables.find(t => t.orderId === selectedTable.orderId);
      if (freshTable) setSelectedTable(freshTable);
      setSplitMode(true);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setNormalizing(false);
    }
  };

  const handleCobrarClick = (table: POSTable) => {
    setSelectedTable(table);
    setDetailView(true);
    setSelectedItemIds([]);
    setSplitLabel("");
    setSplitMode(false);
    setMovingItemId(null);
  };

  const closeDetailView = () => {
    setDetailView(false);
    setSelectedTable(null);
    setSelectedItemIds([]);
    setSplitLabel("");
    setSplitMode(false);
    setMovingItemId(null);
  };

  const payingAmount = payingSplitId
    ? getSplitTotal(splits.find((s) => s.id === payingSplitId)!)
    : Number(selectedTable?.totalAmount || 0);

  const payingLabel = payingSplitId
    ? splits.find((s) => s.id === payingSplitId)?.label || "Subcuenta"
    : selectedTable?.tableName || "";

  return (
    <div className="p-3 md:p-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <CreditCard className="w-6 h-6" /> POS / Caja
        </h1>
        <div className="flex items-center gap-2">
          {cashSession?.id && !cashSession.closedAt ? (
            <Badge variant="default" className="flex items-center gap-1">
              <Unlock className="w-3 h-3" />
              Caja Abierta
            </Badge>
          ) : (
            <Badge variant="secondary" className="flex items-center gap-1">
              <Lock className="w-3 h-3" />
              Caja Cerrada
            </Badge>
          )}
        </div>
      </div>

      {detailView && selectedTable ? (
        <div>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <Button variant="ghost" onClick={closeDetailView} data-testid="button-back-to-tables">
              <ArrowLeft className="w-4 h-4 mr-1" /> Volver
            </Button>
            <h2 className="text-xl font-bold" data-testid="text-detail-table-name">{selectedTable.tableName}</h2>
            <Badge variant="secondary">{selectedTable.itemCount} items</Badge>
          </div>

          {(Number(selectedTable.totalDiscounts || 0) > 0 || Number(selectedTable.totalTaxes || 0) > 0) && (
            <Card className="mb-4">
              <CardContent className="py-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>₡{getOrderSubtotal(selectedTable).toLocaleString()}</span>
                </div>
                {Number(selectedTable.totalDiscounts || 0) > 0 && (
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>Descuentos</span>
                    <span>-₡{Number(selectedTable.totalDiscounts).toLocaleString()}</span>
                  </div>
                )}
                {selectedTable.taxBreakdown?.map((tb, idx) => (
                  <div key={idx} className="flex justify-between text-sm text-muted-foreground">
                    <span>{tb.taxName} ({tb.taxRate}%){tb.inclusive ? " incl." : ""}</span>
                    <span>{tb.inclusive ? "" : "+"}₡{Number(tb.totalAmount).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-lg border-t pt-1" data-testid="text-detail-total">
                  <span>Total</span>
                  <span>₡{Number(selectedTable.totalAmount).toLocaleString()}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {!(Number(selectedTable.totalDiscounts || 0) > 0 || Number(selectedTable.totalTaxes || 0) > 0) && (
            <div className="flex items-center justify-end mb-4">
              <span className="font-bold text-lg" data-testid="text-detail-total">
                Total: ₡{Number(selectedTable.totalAmount).toLocaleString()}
              </span>
            </div>
          )}

          {splitMode ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                  <h3 className="font-bold">Cuenta Principal</h3>
                  <Button variant="ghost" onClick={() => setSplitMode(false)} data-testid="button-exit-split">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Salir
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {selectedTable.items
                      .filter(item => !assignedItemIds.includes(item.id) && item.status !== "PAID")
                      .map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 py-2 px-2 rounded-md min-h-[48px] cursor-pointer transition-colors ${selectedItemIds.includes(item.id) ? "bg-primary/15 ring-1 ring-primary/30" : "hover-elevate"}`}
                        onClick={() => toggleItemSelection(item.id)}
                        data-testid={`split-item-row-${item.id}`}
                      >
                        <div className="flex-1">
                          <span className="text-sm">{item.productNameSnapshot}</span>
                          {(item.modifiers && item.modifiers.length > 0) && (
                            <div className="text-xs text-muted-foreground">
                              {item.modifiers.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")}
                            </div>
                          )}
                          {item.notes && <div className="text-xs text-muted-foreground italic">{item.notes}</div>}
                        </div>
                        <span className="text-sm text-muted-foreground">₡{getItemUnitPrice(item).toLocaleString()}</span>
                      </div>
                    ))}
                    {selectedTable.items.filter(item => !assignedItemIds.includes(item.id) && item.status !== "PAID").length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">Todos los items están asignados a subcuentas</p>
                    )}
                  </div>
                  {selectedItemIds.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      {activeSplitId ? (
                        <Button onClick={moveSelectedToActive} disabled={moveItemMutation.isPending} className="w-full" data-testid="button-move-to-active">
                          <ArrowRight className="w-4 h-4 mr-1" /> Mover {selectedItemIds.length} ítem(s) a {splits.find(s => s.id === activeSplitId)?.label || "Subcuenta"}
                        </Button>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center">Seleccione subcuenta para mover</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-bold flex items-center gap-2">
                    <Split className="w-4 h-4" /> Subcuentas
                  </h3>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" onClick={() => createSplitMutation.mutate()} disabled={createSplitMutation.isPending} data-testid="button-add-split">
                      <Plus className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="outline" onClick={removeLastEmptySplit} disabled={!lastEmptySplit} data-testid="button-remove-split">
                      <Minus className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {splitsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : splits.length === 0 ? (
                  <Card>
                    <CardContent className="py-8 text-center">
                      <p className="text-muted-foreground text-sm">
                        Usa el botón + para crear subcuentas.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  splits.map((split) => (
                    <Card
                      key={split.id}
                      className={`cursor-pointer ${activeSplitId === split.id ? "ring-2 ring-primary" : ""}`}
                      onClick={() => setActiveSplitId(activeSplitId === split.id ? null : split.id)}
                      data-testid={`card-split-${split.id}`}
                    >
                      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold">{split.label}</h4>
                          {activeSplitId === split.id && <Badge variant="secondary">Destino</Badge>}
                        </div>
                      </CardHeader>
                      <CardContent>
                        {split.items.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-2">Sin items</p>
                        ) : (
                          split.items.map((si) => {
                            const oi = selectedTable.items.find((i) => i.id === si.orderItemId);
                            if (!oi) return null;
                            return (
                              <div key={si.id} className="flex items-center gap-2 text-sm py-1 min-h-[48px]">
                                <div className="flex-1">
                                  <span>{oi.qty}x {oi.productNameSnapshot}</span>
                                  {(oi.modifiers && oi.modifiers.length > 0) && (
                                    <div className="text-xs text-muted-foreground">
                                      {oi.modifiers.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")}
                                    </div>
                                  )}
                                </div>
                                <span>₡{getItemUnitPrice(oi).toLocaleString()}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => { e.stopPropagation(); moveItemMutation.mutate({ orderItemId: oi.id, fromSplitId: split.id, toSplitId: null }); }}
                                  disabled={moveItemMutation.isPending}
                                  data-testid={`button-return-item-${oi.id}`}
                                >
                                  <ArrowLeft className="w-3 h-3" />
                                </Button>
                              </div>
                            );
                          })
                        )}
                        {split.items.length > 0 && (
                          <div className="border-t pt-2 mt-2">
                            <span className="font-bold" data-testid={`text-split-total-${split.id}`}>₡{getSplitTotal(split).toLocaleString()}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}

                {splits.length > 0 && splits.some(s => s.items.length > 0) && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      const orderId = selectedTable.orderId;
                      setSplitMode(false);
                      setDetailView(false);
                      setSelectedTable(null);
                      setSelectedItemIds([]);
                      setActiveSplitId(null);
                      setHighlightedOrderIds([orderId]);
                      setTimeout(() => setHighlightedOrderIds([]), 2500);
                    }}
                    data-testid="button-confirm-split"
                  >
                    <Split className="w-4 h-4 mr-1" /> Separar
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                  <h3 className="font-bold">Items de la Orden</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    {canSplit && (
                      <Button
                        variant="outline"
                        onClick={enterSplitMode}
                        disabled={normalizing}
                        data-testid="button-enter-split"
                      >
                        {normalizing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Split className="w-4 h-4 mr-1" />}
                        Dividir Cuenta
                      </Button>
                    )}
                    {canPay && (
                      <Button
                        onClick={openPaymentForFull}
                        disabled={!cashSession?.id || !!cashSession.closedAt}
                        data-testid="button-pay-full"
                      >
                        <DollarSign className="w-4 h-4 mr-1" /> Pagar Todo
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {selectedTable.items.map((item) => {
                      const isPaid = item.status === "PAID";
                      const hasDiscount = item.discounts && item.discounts.length > 0;
                      const discountTotal = (item.discounts || []).reduce((s, d) => s + Number(d.amountApplied), 0);
                      return (
                        <div
                          key={item.id}
                          className={`py-2 px-2 rounded-md min-h-[48px] ${isPaid ? "opacity-50" : ""}`}
                          data-testid={`item-row-${item.id}`}
                        >
                          <div className="flex items-center gap-2">
                            {isPaid && <Badge variant="secondary" className="text-xs">Pagado</Badge>}
                            <div className="flex-1">
                              <span className="text-sm">{item.qty}x {item.productNameSnapshot}</span>
                              {(item.modifiers && item.modifiers.length > 0) && (
                                <div className="text-xs text-muted-foreground">
                                  {item.modifiers.map(m => m.nameSnapshot).join(", ")}
                                </div>
                              )}
                            </div>
                            <span className={`text-sm ${hasDiscount ? "line-through text-muted-foreground" : ""}`}>₡{getItemTotal(item).toLocaleString()}</span>
                            {!isPaid && canPay && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openDiscountDialog(item.id)}
                                data-testid={`button-discount-item-${item.id}`}
                              >
                                <Percent className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                          {hasDiscount && (
                            <div className="flex items-center gap-2 mt-1 ml-6">
                              <span className="text-xs text-green-600 dark:text-green-400">
                                -{item.discounts![0].discountName}: ₡{discountTotal.toLocaleString()}
                              </span>
                              <span className="text-xs font-medium">
                                = ₡{(getItemTotal(item) - discountTotal).toLocaleString()}
                              </span>
                              {!isPaid && canPay && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => removeDiscountMutation.mutate(item.id)}
                                  disabled={removeDiscountMutation.isPending}
                                  data-testid={`button-remove-discount-${item.id}`}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                {canVoid && orderPayments.filter(p => p.status === "PAID").length > 0 && (
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    <h4 className="font-bold text-sm">Anulaciones</h4>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground mb-3">Pagos activos de esta orden:</p>
                    <div className="space-y-2">
                      {orderPayments.filter(p => p.status === "PAID").map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between gap-2 py-1" data-testid={`payment-row-${p.id}`}>
                          <div className="text-sm">
                            <span className="font-medium">₡{Number(p.amount).toLocaleString()}</span>
                            <span className="text-muted-foreground ml-2">{p.paymentMethodName}</span>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => voidPaymentMutation.mutate(p.id)}
                            disabled={voidPaymentMutation.isPending}
                            data-testid={`button-void-payment-${p.id}`}
                          >
                            <XCircle className="w-3 h-3 mr-1" /> Anular
                          </Button>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="tables" className="min-h-[44px]" data-testid="tab-pos-tables">Mesas por Cobrar</TabsTrigger>
            <TabsTrigger value="cash" className="min-h-[44px]" data-testid="tab-cash">Caja</TabsTrigger>
          </TabsList>

          <TabsContent value="tables">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
            ) : posTables.length === 0 ? (
              <Card><CardContent className="py-12 text-center">
                <Receipt className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-muted-foreground">No hay mesas con consumos pendientes de pago</p>
              </CardContent></Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[...posTables].sort((a, b) => {
                  const aTime = a.openedAt ? new Date(a.openedAt).getTime() : 0;
                  const bTime = b.openedAt ? new Date(b.openedAt).getTime() : 0;
                  return aTime - bTime;
                }).map((t) => (
                  <Card key={t.id} className={`hover-elevate cursor-pointer transition-all duration-700 ${highlightedOrderIds.includes(t.orderId) ? "ring-2 ring-primary bg-primary/10" : ""}`} onClick={() => { setSelectedTable(t); setDetailView(true); }} data-testid={`card-pos-table-${t.id}`}>
                    <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                      <h3 className="font-bold text-lg">{t.tableName}</h3>
                      <Badge>{t.itemCount} items</Badge>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                        {t.items.map((item) => (
                          <div key={item.id} className="flex items-center justify-between text-sm py-1">
                            <span>{item.qty}x {item.productNameSnapshot}</span>
                            <span className="text-muted-foreground">₡{Number(Number(item.productPriceSnapshot) * item.qty).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                      <div className="border-t pt-3 flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-bold text-lg">₡{Number(t.totalAmount).toLocaleString()}</span>
                        <div className="flex items-center gap-1 flex-wrap">
                          {canPay && (
                            <Button
                              size="sm"
                              onClick={(e) => { e.stopPropagation(); setSelectedTable(t); openPaymentForFull(); }}
                              disabled={!cashSession?.id || !!cashSession.closedAt}
                              data-testid={`button-pay-table-${t.id}`}
                            >
                              <DollarSign className="w-4 h-4 mr-1" /> Pagar
                            </Button>
                          )}
                          {canSplit && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={async (e) => {
                                e.stopPropagation();
                                setSelectedTable(t);
                                setDetailView(true);
                                setSelectedItemIds([]);
                                setSplitLabel("");
                                setMovingItemId(null);
                                setNormalizing(true);
                                try {
                                  await apiRequest("POST", `/api/pos/orders/${t.orderId}/normalize-split`);
                                  await queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
                                  await queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", t.orderId, "splits"] });
                                  const freshTables: POSTable[] = queryClient.getQueryData(["/api/pos/tables"]) || [];
                                  const freshTable = freshTables.find(ft => ft.orderId === t.orderId);
                                  if (freshTable) setSelectedTable(freshTable);
                                  setSplitMode(true);
                                } catch (err: any) {
                                  toast({ title: "Error", description: err.message, variant: "destructive" });
                                } finally {
                                  setNormalizing(false);
                                }
                              }}
                              data-testid={`button-split-table-${t.id}`}
                            >
                              <Split className="w-4 h-4 mr-1" /> Dividir
                            </Button>
                          )}
                          {canVoidOrder && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={(e) => { e.stopPropagation(); setVoidOrderId(t.orderId); setVoidOrderOpen(true); }}
                              data-testid={`button-void-order-table-${t.id}`}
                            >
                              <XCircle className="w-4 h-4 mr-1" /> Anular
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="cash">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <h3 className="font-bold">Sesión de Caja</h3>
                </CardHeader>
                <CardContent>
                  {cashSession?.id && !cashSession.closedAt ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Apertura</span>
                        <span className="font-medium">₡{Number(cashSession.openingCash).toLocaleString()}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Efectivo Esperado</span>
                        <span className="font-medium">₡{Number(cashSession.expectedCash || 0).toLocaleString()}</span>
                      </div>
                      {canCashClose && (
                        <Button variant="destructive" className="w-full mt-4" onClick={() => setCloseOpen(true)} data-testid="button-close-cash">
                          <Lock className="w-4 h-4 mr-1" /> Cerrar Caja
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">No hay sesión de caja abierta</p>
                      <Button className="w-full" onClick={() => setCashOpen(true)} data-testid="button-open-cash">
                        <Unlock className="w-4 h-4 mr-1" /> Abrir Caja
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {cashSession?.closedAt && (
                <Card>
                  <CardHeader className="pb-2">
                    <h3 className="font-bold">Último Cierre</h3>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Apertura</span>
                      <span>₡{Number(cashSession.openingCash).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Esperado</span>
                      <span>₡{Number(cashSession.expectedCash || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Contado</span>
                      <span>₡{Number(cashSession.countedCash || 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold border-t pt-2">
                      <span>Diferencia</span>
                      <span className={Number(cashSession.difference || 0) < 0 ? "text-destructive" : ""}>
                        ₡{Number(cashSession.difference || 0).toLocaleString()}
                      </span>
                    </div>
                    {cashSession.totalsByMethod && typeof cashSession.totalsByMethod === "object" && (
                      <div className="border-t pt-2 mt-2 space-y-1">
                        <p className="text-sm font-bold mb-1">Totales por Método</p>
                        {Object.entries(cashSession.totalsByMethod as Record<string, number>).map(([method, amount]) => (
                          <div key={method} className="flex justify-between text-sm" data-testid={`text-total-method-${method}`}>
                            <span className="text-muted-foreground">{method}</span>
                            <span>₡{Number(amount).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {payingSplitId ? `Pagar ${payingLabel}` : `Cobrar - ${selectedTable?.tableName}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-3xl font-bold" data-testid="text-payment-total">
                ₡{payingAmount.toLocaleString()}
              </p>
              {!payingSplitId && selectedTable && (Number(selectedTable.totalDiscounts || 0) > 0 || Number(selectedTable.totalTaxes || 0) > 0) && (
                <div className="text-left mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>₡{getOrderSubtotal(selectedTable).toLocaleString()}</span>
                  </div>
                  {Number(selectedTable.totalDiscounts || 0) > 0 && (
                    <div className="flex justify-between text-green-600 dark:text-green-400">
                      <span>Descuentos</span>
                      <span>-₡{Number(selectedTable.totalDiscounts).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedTable.taxBreakdown?.map((tb, idx) => (
                    <div key={idx} className="flex justify-between text-muted-foreground">
                      <span>{tb.taxName} ({tb.taxRate}%){tb.inclusive ? " incl." : ""}</span>
                      <span>{tb.inclusive ? "" : "+"}₡{Number(tb.totalAmount).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
              {!payingSplitId && !(Number(selectedTable?.totalDiscounts || 0) > 0 || Number(selectedTable?.totalTaxes || 0) > 0) && (
                <p className="text-sm text-muted-foreground">{selectedTable?.itemCount} items</p>
              )}
              {payingSplitId && (
                <p className="text-sm text-muted-foreground">{payingLabel}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Método de Pago</Label>
              <Select value={paymentMethodId} onValueChange={setPaymentMethodId}>
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue placeholder="Seleccionar método" />
                </SelectTrigger>
                <SelectContent>
                  {activePaymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.paymentName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canEditCustomerPrepay && (
              <>
                <div className="space-y-2">
                  <Label>Nombre del Cliente (opcional)</Label>
                  <Input data-testid="input-client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label>Email (opcional)</Label>
                  <Input data-testid="input-client-email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@example.com" type="email" />
                </div>
              </>
            )}
            {canEmailTicket && clientEmail && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => sendTicketMutation.mutate()}
                disabled={!clientEmail || sendTicketMutation.isPending}
                data-testid="button-send-ticket"
              >
                {sendTicketMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <Mail className="w-4 h-4 mr-1" />
                )}
                Enviar Ticket por Email
              </Button>
            )}
            <Button
              className="w-full"
              onClick={() => payingSplitId ? paySplitMutation.mutate() : payMutation.mutate()}
              disabled={!paymentMethodId || payMutation.isPending || paySplitMutation.isPending}
              data-testid="button-process-payment"
            >
              {(payMutation.isPending || paySplitMutation.isPending) ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
              ) : (
                <DollarSign className="w-4 h-4 mr-1" />
              )}
              Procesar Pago
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cashOpen} onOpenChange={setCashOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Abrir Caja</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Monto Inicial en Efectivo</Label>
              <Input data-testid="input-opening-cash" type="number" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0.00" />
            </div>
            <Button className="w-full" onClick={() => openCashMutation.mutate()} disabled={openCashMutation.isPending} data-testid="button-confirm-open-cash">
              {openCashMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Abrir Caja
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!lastPaidOrder} onOpenChange={(open) => { if (!open) setLastPaidOrder(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pago Exitoso</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Orden {lastPaidOrder?.orderNumber} - {lastPaidOrder?.tableName}
            </p>
            <div className="flex flex-col gap-2">
              {canPrint && (
                <>
                  <Button
                    data-testid="button-direct-print"
                    disabled={printingDirect}
                    onClick={async () => {
                      if (!lastPaidOrder) return;
                      setPrintingDirect(true);
                      try {
                        const res = await apiRequest("POST", "/api/pos/print-receipt", {
                          orderId: lastPaidOrder.orderId,
                        });
                        const data = await res.json();
                        toast({ title: "Impreso", description: `Enviado a ${data.printer}` });
                      } catch (err: any) {
                        toast({ title: "Error de impresora", description: err.message, variant: "destructive" });
                      } finally {
                        setPrintingDirect(false);
                      }
                    }}
                  >
                    {printingDirect ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Printer className="w-4 h-4 mr-1" />}
                    Imprimir en Impresora WiFi
                  </Button>
                  <Button
                    data-testid="button-browser-print"
                    variant="outline"
                    onClick={() => {
                      if (!lastPaidOrder) return;
                      triggerReceiptPrint(
                        lastPaidOrder._items,
                        lastPaidOrder._totalAmount,
                        lastPaidOrder.paymentMethod,
                        lastPaidOrder.tableName,
                        lastPaidOrder.orderNumber,
                        lastPaidOrder.clientName,
                        lastPaidOrder._totalDiscounts,
                        lastPaidOrder._totalTaxes,
                        lastPaidOrder._taxBreakdown
                      );
                    }}
                  >
                    <Receipt className="w-4 h-4 mr-1" />
                    Ver Tiquete en Pantalla
                  </Button>
                </>
              )}
              <Button
                data-testid="button-close-print-dialog"
                variant="ghost"
                onClick={() => setLastPaidOrder(null)}
              >
                Cerrar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cerrar Caja</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Efectivo Contado</Label>
              <Input data-testid="input-counted-cash" type="number" step="0.01" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Observaciones del cierre" />
            </div>
            <Button variant="destructive" className="w-full" onClick={() => closeCashMutation.mutate()} disabled={closeCashMutation.isPending} data-testid="button-confirm-close-cash">
              {closeCashMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Confirmar Cierre
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aplicar Descuento</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {discountItemId && selectedTable && (() => {
              const item = selectedTable.items.find(i => i.id === discountItemId);
              if (!item) return null;
              return (
                <p className="text-sm text-muted-foreground">
                  {item.qty}x {item.productNameSnapshot} - ₡{getItemTotal(item).toLocaleString()}
                </p>
              );
            })()}
            <div className="space-y-2">
              <Label>Nombre del Descuento</Label>
              <Input
                data-testid="input-discount-name"
                value={discountName}
                onChange={(e) => setDiscountName(e.target.value)}
                placeholder="Descuento"
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as "percentage" | "fixed")}>
                <SelectTrigger data-testid="select-discount-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                  <SelectItem value="fixed">Monto Fijo (₡)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{discountType === "percentage" ? "Porcentaje" : "Monto"}</Label>
              <Input
                data-testid="input-discount-value"
                type="number"
                step="0.01"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                placeholder={discountType === "percentage" ? "10" : "500"}
              />
            </div>
            <Button
              className="w-full"
              onClick={() => applyDiscountMutation.mutate()}
              disabled={!discountValue || applyDiscountMutation.isPending}
              data-testid="button-apply-discount"
            >
              {applyDiscountMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Aplicar Descuento
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={voidOrderOpen} onOpenChange={(o) => { if (!o) { setVoidOrderOpen(false); setVoidOrderId(null); setVoidOrderReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular Orden Completa</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Esta acción anulará todos los ítems de la orden y liberará la mesa. Esta acción no se puede deshacer.
          </p>
          <div className="space-y-3">
            <div>
              <Label>Motivo (opcional)</Label>
              <Input
                value={voidOrderReason}
                onChange={(e) => setVoidOrderReason(e.target.value)}
                placeholder="Motivo de la anulación..."
                data-testid="input-void-order-reason"
              />
            </div>
            <div className="flex gap-2 justify-end flex-wrap">
              <Button variant="outline" onClick={() => { setVoidOrderOpen(false); setVoidOrderId(null); setVoidOrderReason(""); }} data-testid="button-cancel-void-order">
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={() => voidOrderMutation.mutate()}
                disabled={voidOrderMutation.isPending}
                data-testid="button-confirm-void-order"
              >
                {voidOrderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
                Anular Orden
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
