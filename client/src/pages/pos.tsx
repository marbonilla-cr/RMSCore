import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { wsManager } from "@/lib/ws";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, DollarSign, Loader2, Receipt,
  Banknote, ArrowLeft, Lock, Unlock, Wallet, Coins,
  Split, Trash2, XCircle, Mail, Printer, ArrowRight, ArrowLeftRight,
  Percent, X, Plus, Minus, Save, SendHorizontal,
} from "lucide-react";
import type { PaymentMethod, Product, Category } from "@shared/schema";
import { printReceipt } from "@/lib/print-receipt";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { PayDialog } from "@/components/pos/PayDialog";
import { SplitDialog } from "@/components/pos/SplitDialog";
import "@/components/pos/pos-dialogs.css";
import { formatCurrency } from "@/lib/utils";

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
  customerNameSnapshot?: string | null;
  subaccountId?: number | null;
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
  parentOrderId?: number | null;
  splitIndex?: number | null;
  dailyNumber?: number | null;
  globalNumber?: number | null;
  ticketNumber?: string;
  totalAmount: string;
  openedAt?: string | null;
  itemCount: number;
  items: POSItem[];
  totalDiscounts?: string;
  totalTaxes?: string;
  taxBreakdown?: TaxBreakdownEntry[];
  subaccountNames?: string[];
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
  const canViewCashReport = hasPermission("POS_VIEW_CASH_REPORT");

  const [tab, setTab] = useState("tables");
  const [selectedTable, setSelectedTable] = useState<POSTable | null>(null);
  const [detailView, setDetailView] = useState(false);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [payingSplitId, setPayingSplitId] = useState<number | null>(null);

  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payDialogSplitId, setPayDialogSplitId] = useState<number | null>(null);
  const [payDialogSplitLabel, setPayDialogSplitLabel] = useState("");
  const [payDialogSplitTotal, setPayDialogSplitTotal] = useState(0);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);

  const [cashOpen, setCashOpen] = useState(false);
  const [openingCash, setOpeningCash] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");

  const [cashStep, setCashStep] = useState<"select" | "change" | null>(null);
  const [cashReceived, setCashReceived] = useState<number>(0);
  const [customCashInput, setCustomCashInput] = useState("");

  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([]);
  const [splitLabel, setSplitLabel] = useState("");
  const [splitMode, setSplitMode] = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  const [movingItemId, setMovingItemId] = useState<number | null>(null);

  const [voidOrderOpen, setVoidOrderOpen] = useState(false);
  const [voidOrderId, setVoidOrderId] = useState<number | null>(null);
  const [voidOrderReason, setVoidOrderReason] = useState("");
  const [activeSplitId, setActiveSplitId] = useState<number | null>(null);
  const [highlightedOrderIds, setHighlightedOrderIds] = useState<number[]>([]);

  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountItemId, setDiscountItemId] = useState<number | null>(null);

  const [printConfirmOrderId, setPrintConfirmOrderId] = useState<number | null>(null);
  const [printConfirmSplitPaymentId, setPrintConfirmSplitPaymentId] = useState<number | null>(null);
  const [printConfirmSplitLabel, setPrintConfirmSplitLabel] = useState<string>("");
  const [printConfirmPaidItemIds, setPrintConfirmPaidItemIds] = useState<number[]>([]);
  const [paidTicketActions, setPaidTicketActions] = useState<{orderId: number; tableName: string; ticketNumber: string} | null>(null);
  const [paidEmailInput, setPaidEmailInput] = useState("");
  const [paidShowEmailForm, setPaidShowEmailForm] = useState(false);
  const [paidSendingEmail, setPaidSendingEmail] = useState(false);
  const [paidPrintingDirect, setPaidPrintingDirect] = useState(false);

  useEffect(() => {
    wsManager.connect();
    const invalidateTables = () => {
      queryClient.refetchQueries({ queryKey: ["/api/pos/tables"] });
    };
    const invalidateOrderDetail = () => {
      if (selectedTable?.orderId) {
        queryClient.refetchQueries({ queryKey: ["/api/pos/orders", selectedTable.orderId, "splits"] });
        queryClient.refetchQueries({ queryKey: ["/api/pos/orders", selectedTable.orderId, "payments"] });
      }
    };
    const invalidatePaymentData = () => {
      invalidateTables();
      invalidateOrderDetail();
      queryClient.refetchQueries({ queryKey: ["/api/pos/cash-session"] });
      queryClient.refetchQueries({ queryKey: ["/api/pos/paid-orders"] });
    };
    const unsubs = [
      wsManager.on("order_updated", () => { invalidateTables(); invalidateOrderDetail(); }),
      wsManager.on("table_status_changed", invalidateTables),
      wsManager.on("payment_completed", invalidatePaymentData),
      wsManager.on("payment_voided", invalidatePaymentData),
      wsManager.on("kitchen_item_status_changed", () => { invalidateTables(); invalidateOrderDetail(); }),
      wsManager.on("qr_submission_created", invalidateTables),
    ];
    return () => unsubs.forEach(u => u());
  }, [selectedTable?.orderId]);

  const { data: posTables = [], isLoading } = useQuery<POSTable[]>({
    queryKey: ["/api/pos/tables"],
    refetchInterval: 2000,
  });

  useEffect(() => {
    if (selectedTable && posTables.length > 0) {
      const fresh = posTables.find(t => t.orderId === selectedTable.orderId);
      if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedTable)) {
        setSelectedTable(fresh);
      }
    }
  }, [posTables]);

  const { data: paymentMethods = [] } = useQuery<PaymentMethod[]>({
    queryKey: ["/api/pos/payment-methods"],
  });

  const { data: cashSession } = useQuery<any>({
    queryKey: ["/api/pos/cash-session"],
  });

  interface PaidOrder {
    orderId: number;
    tableName: string;
    ticketNumber: string;
    dailyNumber: number | null;
    splitIndex: number | null;
    totalAmount: string;
    closedAt: string | null;
    paymentMethods: string[];
    itemCount: number;
    items: { id: number; productNameSnapshot: string; qty: number; productPriceSnapshot: string }[];
  }

  const { data: paidOrders = [], isLoading: paidLoading } = useQuery<PaidOrder[]>({
    queryKey: ["/api/pos/paid-orders"],
    enabled: tab === "paid",
  });

  const { data: splits = [], isLoading: splitsLoading } = useQuery<SplitAccountData[]>({
    queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"],
    enabled: !!selectedTable?.orderId && (detailView || splitDialogOpen || !!payDialogSplitId),
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

  const { data: systemDiscounts = [], isLoading: discountsLoading } = useQuery<any[]>({
    queryKey: ["/api/pos/discounts"],
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
      const savedOrderId = tbl.orderId;

      const pmUsed = paymentMethods.find(m => m.id.toString() === paymentMethodId);
      const wasCash = pmUsed ? (pmUsed.paymentCode.toUpperCase().includes("CASH") || pmUsed.paymentCode.toUpperCase().includes("EFECT")) : false;
      if (wasCash) {
        apiRequest("POST", "/api/pos/open-drawer", {}).catch(() => {});
      }

      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setPaymentOpen(false);
      setSelectedTable(null);
      setDetailView(false);
      setClientName("");
      setClientEmail("");
      setCashStep(null);
      setCashReceived(0);
      setCustomCashInput("");
      toast({ title: "Pago procesado" });
      setPrintConfirmOrderId(savedOrderId);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const paySplitMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/pos/pay-split", {
        splitId: payingSplitId,
        paymentMethodId: parseInt(paymentMethodId),
        clientName: clientName || null,
        clientEmail: clientEmail || null,
      });
      return resp.json();
    },
    onSuccess: (data: any) => {
      const tbl = selectedTable!;
      const savedOrderId = tbl.orderId;

      const pmUsed = paymentMethods.find(m => m.id.toString() === paymentMethodId);
      const wasCash = pmUsed ? (pmUsed.paymentCode.toUpperCase().includes("CASH") || pmUsed.paymentCode.toUpperCase().includes("EFECT")) : false;
      if (wasCash) {
        apiRequest("POST", "/api/pos/open-drawer", {}).catch(() => {});
      }

      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      setPaymentOpen(false);
      setPayingSplitId(null);
      setClientName("");
      setClientEmail("");
      setCashStep(null);
      setCashReceived(0);
      setCustomCashInput("");
      toast({ title: "Subcuenta pagada" });
      setPrintConfirmSplitPaymentId(data?.paymentId || null);
      setPrintConfirmSplitLabel(data?.splitLabel || "");
      setPrintConfirmPaidItemIds(data?.paidItemIds || []);
      setPrintConfirmOrderId(savedOrderId);
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

  const moveBulkMutation = useMutation({
    mutationFn: async ({ orderItemIds, fromSplitId, toSplitId }: { orderItemIds: number[]; fromSplitId?: number | null; toSplitId?: number | null }) => {
      return apiRequest("POST", "/api/pos/split-items/move-bulk", { orderItemIds, fromSplitId: fromSplitId || null, toSplitId: toSplitId || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      setSelectedItemIds([]);
    },
    onError: (err: any) => {
      toast({ title: "Error al mover items", description: err.message, variant: "destructive" });
    },
  });

  const splitBySubaccountMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/pos/orders/${selectedTable!.orderId}/splits-from-subaccounts`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", selectedTable?.orderId, "splits"] });
      setSplitMode(true);
      toast({ title: "Cuenta separada por subcuenta" });
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
    mutationFn: async (params: { discountName: string; discountType: string; discountValue: string; applyToAll: boolean }) => {
      if (params.applyToAll && selectedTable?.orderId) {
        return apiRequest("POST", `/api/pos/orders/${selectedTable.orderId}/discount-all`, {
          discountName: params.discountName,
          discountType: params.discountType,
          discountValue: params.discountValue,
        });
      }
      return apiRequest("POST", `/api/pos/order-items/${discountItemId}/discount`, {
        discountName: params.discountName,
        discountType: params.discountType,
        discountValue: params.discountValue,
      });
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/pos/tables"] });
      setDiscountOpen(false);
      setDiscountItemId(null);
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
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ["/api/pos/tables"] });
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

  const splitOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTable) throw new Error("No hay orden seleccionada");
      return apiRequest("POST", "/api/pos/split-order", {
        orderId: selectedTable.orderId,
      });
    },
    onSuccess: async (res: any) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setSplitMode(false);
      setDetailView(false);
      setSelectedTable(null);
      setSelectedItemIds([]);
      setActiveSplitId(null);
      const childIds = data.childOrderIds || [];
      setHighlightedOrderIds(childIds);
      setTimeout(() => setHighlightedOrderIds([]), 2500);
      toast({ title: "Cuenta separada en tiquetes independientes" });
    },
    onError: (err: any) => {
      toast({ title: "Error al separar", description: err.message, variant: "destructive" });
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
    if (!activeSplitId || selectedItemIds.length === 0) return;
    moveBulkMutation.mutate({ orderItemIds: selectedItemIds, fromSplitId: null, toSplitId: activeSplitId });
  };

  const openDiscountDialog = (itemId: number) => {
    setDiscountItemId(itemId);
    setDiscountOpen(true);
  };

  const activePaymentMethods = paymentMethods.filter((m) => m.active);

  const getOrderSubtotal = (table: POSTable) => {
    return table.items.filter(i => i.status !== "VOIDED" && i.status !== "PAID").reduce((s, i) => s + getItemTotal(i), 0);
  };

  interface GroupedPOSItem {
    key: string;
    items: POSItem[];
    totalQty: number;
    productNameSnapshot: string;
    productPriceSnapshot: string;
    customerNameSnapshot?: string | null;
    modifiers: POSItemModifier[];
    totalAmount: number;
    totalDiscount: number;
    discounts: POSItemDiscount[];
    hasPaid: boolean;
    firstItemId: number;
  }

  const groupItems = (items: POSItem[]): GroupedPOSItem[] => {
    const map = new Map<string, GroupedPOSItem>();
    for (const item of items) {
      if (item.status === "VOIDED") continue;
      const modSig = (item.modifiers || []).map(m => `${m.nameSnapshot}:${m.priceDeltaSnapshot}`).sort().join("|");
      const custName = item.customerNameSnapshot || "";
      const key = `${item.productNameSnapshot}::${item.productPriceSnapshot}::${modSig}::${custName}`;
      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
        existing.totalQty += item.qty;
        existing.totalAmount += getItemTotal(item);
        const itemDiscounts = item.discounts || [];
        const itemDiscountTotal = itemDiscounts.reduce((s, d) => s + Number(d.amountApplied), 0);
        existing.totalDiscount += itemDiscountTotal;
        existing.discounts = [...existing.discounts, ...itemDiscounts];
        if (item.status === "PAID") existing.hasPaid = true;
      } else {
        const itemDiscounts = item.discounts || [];
        const itemDiscountTotal = itemDiscounts.reduce((s, d) => s + Number(d.amountApplied), 0);
        map.set(key, {
          key,
          items: [item],
          totalQty: item.qty,
          productNameSnapshot: item.productNameSnapshot,
          productPriceSnapshot: item.productPriceSnapshot,
          customerNameSnapshot: item.customerNameSnapshot,
          modifiers: item.modifiers || [],
          totalAmount: getItemTotal(item),
          totalDiscount: itemDiscountTotal,
          discounts: [...itemDiscounts],
          hasPaid: item.status === "PAID",
          firstItemId: item.id,
        });
      }
    }
    return Array.from(map.values());
  };

  const [addItemsOpen, setAddItemsOpen] = useState(false);
  const [posCart, setPosCart] = useState<{ productId: number; name: string; price: string; qty: number; notes: string; modifiers: { optionId: number; name: string; priceDelta: string; qty: number }[] }[]>([]);

  const { data: posProducts = [] } = useQuery<Product[]>({
    queryKey: ["/api/waiter/menu"],
    enabled: addItemsOpen,
  });

  const { data: posCategories = [] } = useQuery<Category[]>({
    queryKey: ["/api/waiter/categories"],
    enabled: addItemsOpen,
  });

  const posCategoryProducts = posProducts.filter(p => p.active).reduce((acc: Record<number | string, Product[]>, p) => {
    const catId = p.categoryId ?? "sin-categoria";
    if (!acc[catId]) acc[catId] = [];
    acc[catId].push(p);
    return acc;
  }, {});

  const [posModDialogProduct, setPosModDialogProduct] = useState<Product | null>(null);
  const [posModGroups, setPosModGroups] = useState<{ id: number; name: string; required: boolean; multiSelect: boolean; minSelections: number; maxSelections: number | null; options: { id: number; name: string; priceDelta: string; active: boolean; sortOrder: number }[] }[]>([]);
  const [posSelectedMods, setPosSelectedMods] = useState<Record<number, number[]>>({});
  const [posLoadingMods, setPosLoadingMods] = useState(false);

  const makePosCartKey = (productId: number, mods: { optionId: number }[]) => {
    return `${productId}:${mods.map(m => m.optionId).sort((a, b) => a - b).join(",")}`;
  };

  const addToPosCart = async (product: Product) => {
    setPosLoadingMods(true);
    try {
      const res = await fetch(`/api/products/${product.id}/modifiers`);
      const groups = await res.json();
      if (groups.length > 0) {
        setPosModDialogProduct(product);
        setPosModGroups(groups);
        setPosSelectedMods({});
        setPosLoadingMods(false);
        return;
      }
    } catch {}
    setPosLoadingMods(false);

    const key = makePosCartKey(product.id, []);
    const existing = posCart.find(c => c.productId === product.id && c.modifiers.length === 0);
    if (existing) {
      setPosCart(posCart.map(c => c.productId === product.id && c.modifiers.length === 0 ? { ...c, qty: c.qty + 1 } : c));
    } else {
      setPosCart([...posCart, { productId: product.id, name: product.name, price: product.price, qty: 1, notes: "", modifiers: [] }]);
    }
  };

  const confirmPosModifiers = () => {
    if (!posModDialogProduct) return;
    const product = posModDialogProduct;
    for (const group of posModGroups) {
      const selected = posSelectedMods[group.id] || [];
      if (group.required && selected.length === 0) {
        toast({ title: `"${group.name}" es requerido`, variant: "destructive" });
        return;
      }
      if (group.minSelections && selected.length < group.minSelections) {
        toast({ title: `"${group.name}": seleccione al menos ${group.minSelections}`, variant: "destructive" });
        return;
      }
      if (group.maxSelections && selected.length > group.maxSelections) {
        toast({ title: `"${group.name}": máximo ${group.maxSelections} opciones`, variant: "destructive" });
        return;
      }
    }
    const mods: { optionId: number; name: string; priceDelta: string; qty: number }[] = [];
    for (const group of posModGroups) {
      const selected = posSelectedMods[group.id] || [];
      for (const optId of selected) {
        const opt = group.options.find(o => o.id === optId);
        if (opt) mods.push({ optionId: opt.id, name: opt.name, priceDelta: opt.priceDelta, qty: 1 });
      }
    }
    const key = makePosCartKey(product.id, mods);
    const existing = posCart.find(c => makePosCartKey(c.productId, c.modifiers) === key);
    if (existing) {
      setPosCart(posCart.map(c => makePosCartKey(c.productId, c.modifiers) === key ? { ...c, qty: c.qty + 1 } : c));
    } else {
      const modDelta = mods.reduce((s, m) => s + Number(m.priceDelta), 0);
      const displayPrice = (Number(product.price) + modDelta).toFixed(2);
      setPosCart([...posCart, { productId: product.id, name: product.name + (mods.length > 0 ? ` (${mods.map(m => m.name).join(", ")})` : ""), price: displayPrice, qty: 1, notes: "", modifiers: mods }]);
    }
    setPosModDialogProduct(null);
    setPosModGroups([]);
    setPosSelectedMods({});
  };

  const removePosCartItem = (idx: number) => {
    setPosCart(posCart.filter((_, i) => i !== idx));
  };

  const updatePosCartQty = (idx: number, qty: number) => {
    if (qty <= 0) return removePosCartItem(idx);
    setPosCart(posCart.map((c, i) => i === idx ? { ...c, qty } : c));
  };

  const posCartTotal = posCart.reduce((s, c) => s + Number(c.price) * c.qty, 0);

  const addItemsMutation = useMutation({
    mutationFn: async (sendToKds: boolean) => {
      return apiRequest("POST", `/api/pos/orders/${selectedTable!.orderId}/add-items`, {
        items: posCart.map(c => ({ productId: c.productId, qty: c.qty, notes: c.notes || null, modifiers: c.modifiers })),
        sendToKds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setPosCart([]);
      setAddItemsOpen(false);
      toast({ title: "Items agregados" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

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

  const openNewPayDialog = (table: POSTable, splitId?: number | null, splitLabel?: string, splitTotal?: number) => {
    setSelectedTable(table);
    setPayDialogSplitId(splitId || null);
    setPayDialogSplitLabel(splitLabel || "");
    setPayDialogSplitTotal(splitTotal || 0);
    setPayDialogOpen(true);
  };

  const handlePayDialogSuccess = (pmId: string, clName: string, clEmail: string, wasCash: boolean, cashReceived?: number, changeAmount?: number, paymentId?: number, paidItemIds?: number[]) => {
    if (!selectedTable) return;
    const tbl = selectedTable;

    if (wasCash) {
      apiRequest("POST", "/api/pos/open-drawer", {}).catch(() => {});
    }

    queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pos/cash-session"] });
    queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", tbl.orderId, "splits"] });
    queryClient.invalidateQueries({ queryKey: ["/api/pos/paid-orders"] });

    if (payDialogSplitId && paymentId) {
      setPrintConfirmSplitPaymentId(paymentId);
      setPrintConfirmSplitLabel(payDialogSplitLabel);
      setPrintConfirmPaidItemIds(paidItemIds || []);
    } else {
      setPrintConfirmSplitPaymentId(null);
      setPrintConfirmSplitLabel("");
      setPrintConfirmPaidItemIds([]);
    }

    if (!payDialogSplitId) {
      setSelectedTable(null);
      setDetailView(false);
    }
    toast({ title: payDialogSplitId ? "Subcuenta pagada" : "Pago procesado" });
    setPrintConfirmOrderId(tbl.orderId);
  };

  const openSplitDialog = async (table: POSTable) => {
    setSelectedTable(table);
    setNormalizing(true);
    try {
      await apiRequest("POST", `/api/pos/orders/${table.orderId}/normalize-split`);
      await queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", table.orderId, "splits"] });
      const freshTables: POSTable[] = queryClient.getQueryData(["/api/pos/tables"]) || [];
      const freshTable = freshTables.find(t => t.orderId === table.orderId);
      if (freshTable) setSelectedTable(freshTable);
      setSplitDialogOpen(true);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setNormalizing(false);
    }
  };

  const handleSplitPaySub = (splitId: number, label: string, total: number) => {
    setSplitDialogOpen(false);
    setPayDialogSplitId(splitId);
    setPayDialogSplitLabel(label);
    setPayDialogSplitTotal(total);
    setPayDialogOpen(true);
  };

  const handleSplitPayAll = () => {
    setSplitDialogOpen(false);
    setPayDialogSplitId(null);
    setPayDialogSplitLabel("");
    setPayDialogSplitTotal(0);
    setPayDialogOpen(true);
  };

  const handleSplitSeparated = (childIds: number[]) => {
    setSplitDialogOpen(false);
    setDetailView(false);
    setSelectedTable(null);
    setHighlightedOrderIds(childIds);
    setTimeout(() => setHighlightedOrderIds([]), 2500);
  };

  const payingAmount = Number(selectedTable?.totalAmount || 0);
  const payingLabel = selectedTable?.tableName || "";

  const selectedPm = paymentMethods.find(m => m.id.toString() === paymentMethodId);
  const isCashPayment = selectedPm ? (selectedPm.paymentCode.toUpperCase().includes("CASH") || selectedPm.paymentCode.toUpperCase().includes("EFECT")) : false;

  const getCashDenominations = (total: number): number[] => {
    const bills = [1000, 2000, 5000, 10000, 20000];
    const suggestions = new Set<number>();
    suggestions.add(total);
    for (const bill of bills) {
      const rounded = Math.ceil(total / bill) * bill;
      if (rounded >= total) suggestions.add(rounded);
    }
    const sorted = Array.from(suggestions).sort((a, b) => a - b);
    return sorted.slice(0, 6);
  };

  return (
    <div className="pos-layout">
      <style>{`
        .pos-layout {
          background: var(--bg);
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          font-family: var(--f-body);
          color: var(--text);
        }
        .pos-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px 18px;
          background: var(--s0);
          border-bottom: 1px solid var(--border-ds);
          position: sticky; top: 0; z-index: 20;
          flex-wrap: wrap;
        }
        .pos-header-title {
          font-family: var(--f-disp);
          font-size: 20px;
          font-weight: 800;
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
        }
        .pos-cash-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 4px 12px;
          border-radius: 20px;
          font-family: var(--f-mono);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .pos-cash-badge.open { background: var(--green-d); color: var(--green); border: 1px solid var(--green-m); }
        .pos-cash-badge.closed { background: var(--s2); color: var(--text3); }

        .pos-tabs {
          display: flex;
          gap: 4px;
          padding: 12px 18px 0;
          border-bottom: 1px solid var(--border-ds);
        }
        .pos-tab {
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
        .pos-tab.active {
          background: var(--s1);
          border-color: var(--border-ds);
          color: var(--green);
        }

        .pos-content { flex: 1; padding: 16px 18px; overflow-y: auto; }

        .pos-table-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 12px;
        }
        .pos-table-card {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-md);
          padding: 14px;
          cursor: pointer;
          transition: all var(--t-fast);
        }
        .pos-table-card:active { background: var(--s2); }
        .pos-table-card.highlighted { border-color: var(--green); box-shadow: 0 0 12px rgba(46,204,113,0.15); }
        .pos-tc-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .pos-tc-name { font-family: var(--f-disp); font-size: 20px; font-weight: 800; }
        .pos-tc-subs { font-size: 12px; color: var(--text3); margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pos-tc-items-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 10px; border-radius: 20px;
          font-family: var(--f-mono); font-size: 10px; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase;
          background: var(--s2); color: var(--text3);
        }
        .pos-tc-mid { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .pos-tc-amount { font-family: var(--f-mono); font-size: 18px; font-weight: 600; color: var(--green); }
        .pos-tc-time { font-family: var(--f-mono); font-size: 11px; color: var(--text3); }
        .pos-tc-actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

        .pos-empty {
          text-align: center; padding: 60px 20px; color: var(--text3);
        }
        .pos-empty-icon { margin-bottom: 16px; opacity: 0.3; }
        .pos-empty-text { font-family: var(--f-mono); font-size: 14px; }

        .pos-loading { display: flex; justify-content: center; padding: 60px; color: var(--text3); }

        .pos-detail-header {
          display: flex; align-items: center; gap: 10px;
          margin-bottom: 16px; flex-wrap: wrap;
        }
        .pos-detail-title { font-family: var(--f-disp); font-size: 20px; font-weight: 800; }

        .pos-detail-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        @media (min-width: 768px) {
          .pos-detail-grid { grid-template-columns: 1fr 1fr; }
        }

        .pos-detail-card {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-md);
          overflow: hidden;
        }
        .pos-dc-header {
          padding: 12px 14px;
          border-bottom: 1px solid var(--border-ds);
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          flex-wrap: wrap;
        }
        .pos-dc-title { font-family: var(--f-disp); font-size: 15px; font-weight: 800; }
        .pos-dc-body { padding: 14px; }

        .pos-action-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
          margin-bottom: 12px;
        }

        .pos-item-grid-header {
          display: grid;
          grid-template-columns: 36px 1fr auto auto 36px;
          gap: 8px;
          align-items: center;
          padding: 0 14px 6px;
          font-family: var(--f-mono); font-size: 10px; font-weight: 600;
          color: var(--text3); letter-spacing: 0.08em; text-transform: uppercase;
          border-bottom: 1px solid var(--border-ds);
        }
        .pos-item-row {
          display: grid;
          grid-template-columns: 36px 1fr auto auto 36px;
          gap: 8px;
          align-items: start;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border-ds);
        }
        .pos-item-row:last-child { border-bottom: none; }
        .pos-item-row.paid-item { opacity: 0.5; }
        .pos-ir-qty {
          width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          background: var(--s2); border: 1px solid var(--border-ds);
          border-radius: var(--r-xs);
          font-family: var(--f-mono); font-size: 12px; font-weight: 600;
        }
        .pos-ir-name { font-family: var(--f-body); font-size: 14px; font-weight: 500; min-width: 0; }
        .pos-ir-sub { font-family: var(--f-mono); font-size: 11px; color: var(--text3); margin-top: 2px; }
        .pos-ir-price { font-family: var(--f-mono); font-size: 13px; font-weight: 600; text-align: right; white-space: nowrap; }
        .pos-ir-strikethrough { text-decoration: line-through; color: var(--text3); }
        .pos-ir-disc-btn {
          width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          background: var(--s2); border: 1px solid var(--border-ds);
          border-radius: var(--r-xs); cursor: pointer;
          color: var(--text2); font-size: 14px;
          transition: all var(--t-fast);
        }
        .pos-ir-disc-btn:active { background: var(--s3); }
        .pos-discount-line {
          display: flex; align-items: center; gap: 8px;
          padding: 2px 14px 6px 58px;
          font-family: var(--f-mono); font-size: 11px;
        }
        .pos-disc-text { color: var(--green); }
        .pos-disc-net { font-weight: 600; color: var(--text); }
        .pos-disc-remove {
          width: 20px; height: 20px;
          display: flex; align-items: center; justify-content: center;
          background: var(--s2); border: 1px solid var(--border-ds);
          border-radius: var(--r-xs); cursor: pointer;
          color: var(--text3); font-size: 12px;
        }

        .pos-totals {
          padding: 14px;
          border-top: 1px solid var(--border-ds);
        }
        .pos-totals-row {
          display: flex; justify-content: space-between; padding: 3px 0;
        }
        .pos-totals-label { font-family: var(--f-mono); font-size: 12px; color: var(--text3); }
        .pos-totals-val { font-family: var(--f-mono); font-size: 12px; color: var(--text2); }
        .pos-totals-val.discount { color: var(--green); }
        .pos-totals-sep { height: 1px; background: var(--border-ds); margin: 6px 0; }
        .pos-totals-total { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
        .pos-totals-total-label { font-family: var(--f-disp); font-size: 16px; font-weight: 800; }
        .pos-totals-total-val { font-family: var(--f-mono); font-size: 18px; font-weight: 600; color: var(--green); }

        .cash-session-card {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-md);
          padding: 16px;
        }
        .csc-title { font-family: var(--f-disp); font-size: 16px; font-weight: 800; margin-bottom: 12px; }
        .csc-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 14px 0; }
        .csc-stat { background: var(--s2); border-radius: var(--r-sm); padding: 10px 12px; }
        .csc-stat-label { font-family: var(--f-mono); font-size: 10px; color: var(--text3); letter-spacing: 0.08em; text-transform: uppercase; }
        .csc-stat-val { font-family: var(--f-mono); font-size: 14px; font-weight: 600; color: var(--text); margin-top: 4px; }
        .csc-methods { border-top: 1px solid var(--border-ds); padding-top: 12px; margin-top: 12px; }
        .csc-methods-title { font-family: var(--f-disp); font-size: 13px; font-weight: 700; margin-bottom: 8px; }
        .csc-method-row {
          display: flex; justify-content: space-between; padding: 4px 0;
          font-family: var(--f-mono); font-size: 13px;
        }
        .csc-method-name { color: var(--text3); }
        .csc-method-val { color: var(--text); font-weight: 500; }

        .paid-order-item {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 14px; background: var(--s1);
          border: 1px solid var(--border-ds); border-radius: var(--r-sm);
          margin-bottom: 6px; cursor: pointer;
          transition: all var(--t-fast);
        }
        .paid-order-item:active { background: var(--s2); }
        .poi-left { flex: 1; min-width: 0; }
        .poi-name { font-family: var(--f-disp); font-size: 15px; font-weight: 700; }
        .poi-ticket { font-family: var(--f-mono); font-size: 11px; color: var(--text3); margin-top: 2px; }
        .poi-time { font-family: var(--f-mono); font-size: 10px; color: var(--text3); }
        .poi-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .poi-amount { font-family: var(--f-mono); font-size: 15px; font-weight: 600; color: var(--green); }
        .poi-pm-badge {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 20px;
          font-family: var(--f-mono); font-size: 9px; font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase;
          background: var(--s2); color: var(--text3);
        }
        .poi-items-badge {
          display: inline-flex; padding: 2px 8px; border-radius: 20px;
          font-family: var(--f-mono); font-size: 9px; font-weight: 600;
          background: var(--s2); color: var(--text3);
        }

        .ds-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
        }
        .ds-dialog {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-lg);
          width: 100%; max-width: 440px;
          max-height: 85vh; overflow-y: auto;
          animation: dsDialogIn 0.2s ease;
        }
        @keyframes dsDialogIn {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .ds-dialog-lg { max-width: 520px; }
        .ds-dlg-header {
          padding: 16px 18px 12px;
          border-bottom: 1px solid var(--border-ds);
        }
        .ds-dlg-title { font-family: var(--f-disp); font-size: 18px; font-weight: 800; }
        .ds-dlg-body { padding: 16px 18px; }
        .ds-dlg-sub { font-family: var(--f-body); font-size: 13px; color: var(--text3); margin-bottom: 12px; }
        .ds-dlg-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 16px; }

        .pos-split-card {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-md);
          padding: 12px;
          cursor: pointer;
          transition: all var(--t-fast);
          margin-bottom: 8px;
        }
        .pos-split-card.active-split { border-color: var(--green); }
        .pos-split-card:active { background: var(--s2); }
        .psc-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
        .psc-label { font-family: var(--f-disp); font-size: 14px; font-weight: 700; }
        .psc-dest-badge {
          padding: 2px 8px; border-radius: 20px;
          font-family: var(--f-mono); font-size: 9px; font-weight: 600;
          background: var(--green-d); color: var(--green);
        }
        .psc-item {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 0; font-size: 13px;
        }
        .psc-item-name { flex: 1; }
        .psc-item-price { font-family: var(--f-mono); font-size: 12px; color: var(--text2); }
        .psc-item-return {
          width: 24px; height: 24px;
          display: flex; align-items: center; justify-content: center;
          background: var(--s2); border: 1px solid var(--border-ds);
          border-radius: var(--r-xs); cursor: pointer;
          color: var(--text2); font-size: 12px;
        }
        .psc-total {
          border-top: 1px solid var(--border-ds);
          padding-top: 6px; margin-top: 6px;
          font-family: var(--f-mono); font-size: 14px; font-weight: 600;
        }
        .psc-empty { font-size: 12px; color: var(--text3); text-align: center; padding: 8px 0; }

        .pos-split-main-item {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 10px; background: var(--s2);
          border: 1px solid var(--border-ds); border-radius: var(--r-sm);
          margin-bottom: 4px; cursor: pointer;
          transition: all var(--t-fast);
        }
        .pos-split-main-item.selected { border-color: var(--green); background: var(--green-d); }
        .pos-split-main-item:active { background: var(--s3); }
        .psmi-name { flex: 1; font-size: 13px; }
        .psmi-sub { font-size: 11px; color: var(--text3); }
        .psmi-price { font-family: var(--f-mono); font-size: 12px; color: var(--text2); }

        .pos-payment-row {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; padding: 8px 0;
          border-bottom: 1px solid var(--border-ds);
        }
        .pos-payment-amount { font-family: var(--f-mono); font-size: 14px; font-weight: 600; }
        .pos-payment-method { font-family: var(--f-mono); font-size: 12px; color: var(--text3); }

        .pos-add-items-overlay {
          position: fixed; inset: 0; z-index: 100;
          background: rgba(0,0,0,0.6);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
        }
        .pos-add-items-dialog {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-lg);
          width: 100%; max-width: 480px;
          max-height: 80vh;
          display: flex; flex-direction: column;
          animation: dsDialogIn 0.2s ease;
        }
        .pos-aid-header {
          padding: 16px 18px 12px;
          border-bottom: 1px solid var(--border-ds);
        }
        .pos-aid-title { font-family: var(--f-disp); font-size: 18px; font-weight: 800; }
        .pos-aid-body { flex: 1; overflow-y: auto; padding: 12px 18px; }
        .pos-aid-product {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; padding: 6px 8px; border-radius: var(--r-sm);
          min-height: 40px;
        }
        .pos-aid-pname { font-size: 14px; font-weight: 500; }
        .pos-aid-pprice { font-family: var(--f-mono); font-size: 12px; color: var(--text3); margin-left: 8px; }
        .pos-aid-qty-controls { display: flex; align-items: center; gap: 4px; }
        .pos-aid-qty { font-family: var(--f-mono); font-size: 13px; width: 24px; text-align: center; }
        .pos-aid-footer {
          border-top: 1px solid var(--border-ds);
          padding: 12px 18px;
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
        }
        .pos-aid-cart-info { font-family: var(--f-mono); font-size: 13px; font-weight: 600; }

        .pos-mod-dialog {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-lg);
          width: 100%; max-width: 380px;
          max-height: 80vh; overflow-y: auto;
          animation: dsDialogIn 0.2s ease;
        }

        .pos-mod-group { margin-bottom: 16px; }
        .pos-mod-group-title {
          font-family: var(--f-disp); font-size: 14px; font-weight: 700;
          margin-bottom: 6px;
        }
        .pos-mod-required { color: var(--red); margin-left: 4px; }
        .pos-mod-option {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 8px; border-radius: var(--r-sm);
          cursor: pointer; transition: all var(--t-fast);
        }
        .pos-mod-option:active { background: var(--s2); }
        .pos-mod-opt-name { flex: 1; font-size: 14px; }
        .pos-mod-opt-price { font-family: var(--f-mono); font-size: 11px; color: var(--text3); }
      `}</style>

      <div className="pos-header">
        <div className="pos-header-title" data-testid="text-page-title">
          <CreditCard size={22} /> POS / Caja
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          <button
            className="pos-drawer-btn"
            onClick={(e) => {
              const btn = e.currentTarget;
              if (btn.dataset.busy === "1") return;
              btn.dataset.busy = "1";
              btn.classList.add("pos-drawer-btn--active");
              apiRequest("POST", "/api/pos/open-drawer", {})
                .then(r => r.json())
                .then(() => {
                  btn.classList.remove("pos-drawer-btn--active");
                  btn.classList.add("pos-drawer-btn--success");
                  toast({ title: "Gaveta abierta" });
                })
                .catch(() => {
                  btn.classList.remove("pos-drawer-btn--active");
                  btn.classList.add("pos-drawer-btn--error");
                  toast({ title: "Error", description: "No se pudo abrir la gaveta", variant: "destructive" });
                })
                .finally(() => {
                  setTimeout(() => {
                    btn.classList.remove("pos-drawer-btn--success", "pos-drawer-btn--error");
                    btn.dataset.busy = "0";
                  }, 2000);
                });
            }}
            data-testid="button-open-drawer"
          >
            <Banknote size={14} /> Gaveta
          </button>
          {cashSession?.id && !cashSession.closedAt ? (
            <span className="pos-cash-badge open">
              <Unlock size={12} /> Caja Abierta
            </span>
          ) : (
            <span className="pos-cash-badge closed">
              <Lock size={12} /> Caja Cerrada
            </span>
          )}
        </div>
      </div>

      {detailView && selectedTable ? (
        <div className="pos-content">
          <div className="pos-detail-header">
            <button className="back-btn" onClick={closeDetailView} data-testid="button-back-to-tables">
              <ArrowLeft size={18} />
            </button>
            <span className="pos-detail-title" data-testid="text-detail-table-name">{selectedTable.tableName}</span>
            <span className="pos-tc-items-badge">{selectedTable.itemCount} items</span>
          </div>
          {selectedTable.subaccountNames && selectedTable.subaccountNames.length > 0 && (
            <div className="pos-tc-subs" style={{ marginTop: -8, marginBottom: 10, paddingLeft: 40 }} data-testid="text-detail-subnames">
              {selectedTable.subaccountNames.join(", ")}
            </div>
          )}

          {splitMode ? (
            <div className="pos-detail-grid">
              <div className="pos-detail-card">
                <div className="pos-dc-header">
                  <span className="pos-dc-title">Cuenta Principal</span>
                  <button className="btn-secondary" onClick={() => setSplitMode(false)} data-testid="button-exit-split" style={{ padding: '6px 14px', minHeight: 36 }}>
                    <ArrowLeft size={14} /> Salir
                  </button>
                </div>
                <div className="pos-dc-body">
                  {selectedTable.items
                    .filter(item => !assignedItemIds.includes(item.id) && item.status !== "PAID")
                    .map((item) => (
                    <div
                      key={item.id}
                      className={`pos-split-main-item ${selectedItemIds.includes(item.id) ? "selected" : ""}`}
                      onClick={() => toggleItemSelection(item.id)}
                      data-testid={`split-item-row-${item.id}`}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="psmi-name">{item.productNameSnapshot}</div>
                        {item.customerNameSnapshot && <div className="psmi-sub">{item.customerNameSnapshot}</div>}
                        {(item.modifiers && item.modifiers.length > 0) && (
                          <div className="psmi-sub">
                            {item.modifiers.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +${formatCurrency(Number(m.priceDeltaSnapshot))}` : "")).join(", ")}
                          </div>
                        )}
                        {item.notes && <div className="psmi-sub" style={{ fontStyle: 'italic' }}>{item.notes}</div>}
                      </div>
                      <span className="psmi-price">{formatCurrency(getItemUnitPrice(item))}</span>
                    </div>
                  ))}
                  {selectedTable.items.filter(item => !assignedItemIds.includes(item.id) && item.status !== "PAID").length === 0 && (
                    <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', padding: '16px 0' }}>Todos los items están asignados a subcuentas</p>
                  )}
                  {selectedItemIds.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border-ds)', paddingTop: 12, marginTop: 12 }}>
                      {activeSplitId ? (
                        <button className="btn-primary" style={{ width: '100%' }} onClick={moveSelectedToActive} disabled={moveBulkMutation.isPending} data-testid="button-move-to-active">
                          <ArrowRight size={14} /> Mover {selectedItemIds.length} ítem(s) a {splits.find(s => s.id === activeSplitId)?.label || "Subcuenta"}
                        </button>
                      ) : (
                        <p style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>Seleccione subcuenta para mover</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontFamily: 'var(--f-disp)', fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Split size={16} /> Subcuentas
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn-icon" onClick={() => createSplitMutation.mutate()} disabled={createSplitMutation.isPending} data-testid="button-add-split">
                      <Plus size={16} />
                    </button>
                    <button className="btn-icon" onClick={removeLastEmptySplit} disabled={!lastEmptySplit} data-testid="button-remove-split">
                      <Minus size={16} />
                    </button>
                  </div>
                </div>

                {splitsLoading ? (
                  <div className="pos-loading"><Loader2 size={24} className="animate-spin" /></div>
                ) : splits.length === 0 ? (
                  <div className="pos-detail-card">
                    <div className="pos-dc-body" style={{ textAlign: 'center', padding: '24px 14px' }}>
                      <p style={{ fontSize: 13, color: 'var(--text3)' }}>Usa el botón + para crear subcuentas.</p>
                    </div>
                  </div>
                ) : (
                  splits.map((split) => (
                    <div
                      key={split.id}
                      className={`pos-split-card ${activeSplitId === split.id ? "active-split" : ""}`}
                      onClick={() => setActiveSplitId(activeSplitId === split.id ? null : split.id)}
                      data-testid={`card-split-${split.id}`}
                    >
                      <div className="psc-header">
                        <span className="psc-label">{split.label}</span>
                        {activeSplitId === split.id && <span className="psc-dest-badge">Destino</span>}
                      </div>
                      {split.items.length === 0 ? (
                        <p className="psc-empty">Sin items</p>
                      ) : (
                        split.items.map((si) => {
                          const oi = selectedTable.items.find((i) => i.id === si.orderItemId);
                          if (!oi) return null;
                          return (
                            <div key={si.id} className="psc-item">
                              <div className="psc-item-name">
                                {oi.qty}x {oi.productNameSnapshot}
                                {oi.customerNameSnapshot && <div className="psmi-sub">{oi.customerNameSnapshot}</div>}
                                {(oi.modifiers && oi.modifiers.length > 0) && (
                                  <div className="psmi-sub">
                                    {oi.modifiers.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +${formatCurrency(Number(m.priceDeltaSnapshot))}` : "")).join(", ")}
                                  </div>
                                )}
                              </div>
                              <span className="psc-item-price">{formatCurrency(getItemUnitPrice(oi))}</span>
                              <button
                                className="psc-item-return"
                                onClick={(e) => { e.stopPropagation(); moveItemMutation.mutate({ orderItemId: oi.id, fromSplitId: split.id, toSplitId: null }); }}
                                disabled={moveItemMutation.isPending}
                                data-testid={`button-return-item-${oi.id}`}
                              >
                                <ArrowLeft size={12} />
                              </button>
                            </div>
                          );
                        })
                      )}
                      {split.items.length > 0 && (
                        <div className="psc-total" data-testid={`text-split-total-${split.id}`}>
                          {formatCurrency(getSplitTotal(split))}
                        </div>
                      )}
                    </div>
                  ))
                )}

                {splits.length > 0 && splits.some(s => s.items.length > 0) && (
                  <button
                    className="btn-primary"
                    style={{ width: '100%' }}
                    disabled={splitOrderMutation.isPending}
                    onClick={() => splitOrderMutation.mutate()}
                    data-testid="button-confirm-split"
                  >
                    {splitOrderMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Split size={16} />}
                    Separar
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="pos-detail-grid">
              <div className="pos-detail-card">
                <div className="pos-dc-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                  <div className="pos-action-grid">
                    <button className="btn-secondary" style={{ width: '100%' }} onClick={() => { setPosCart([]); setAddItemsOpen(true); }} data-testid="button-add-items">
                      <Plus size={14} /> Agregar
                    </button>
                    {canSplit && (
                      <button className="btn-secondary" style={{ width: '100%' }} onClick={() => openSplitDialog(selectedTable)} disabled={normalizing} data-testid="button-enter-split">
                        {normalizing ? <Loader2 size={14} className="animate-spin" /> : <Split size={14} />}
                        Dividir Cuenta
                      </button>
                    )}
                    {canSplit && (
                      <button className="btn-secondary" style={{ width: '100%' }} onClick={() => splitBySubaccountMutation.mutate()} disabled={splitBySubaccountMutation.isPending} data-testid="button-split-by-subaccount">
                        {splitBySubaccountMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
                        Por Subcuenta
                      </button>
                    )}
                    {canPay && (
                      <button className="btn-primary" style={{ width: '100%' }} onClick={() => openNewPayDialog(selectedTable)} disabled={!cashSession?.id || !!cashSession.closedAt} data-testid="button-pay-full">
                        <DollarSign size={14} /> Pagar Todo
                      </button>
                    )}
                  </div>
                  <span className="pos-dc-title">Items de la Orden</span>
                </div>
                <div className="pos-item-grid-header">
                  <span>Cant</span>
                  <span>Item</span>
                  <span style={{ textAlign: 'right' }}>P.Unit</span>
                  <span style={{ textAlign: 'right' }}>Subtot</span>
                  <span style={{ textAlign: 'center' }}>Desc</span>
                </div>
                <div>
                  {groupItems(selectedTable.items).map((group) => {
                    const hasDiscount = group.totalDiscount > 0;
                    const unitPrice = Number(group.productPriceSnapshot) + (group.modifiers || []).reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
                    return (
                      <div key={group.key} data-testid={`item-row-${group.firstItemId}`}>
                        <div className={`pos-item-row ${group.hasPaid ? "paid-item" : ""}`}>
                          <div className="pos-ir-qty">{group.totalQty}</div>
                          <div className="pos-ir-name">
                            {group.productNameSnapshot}
                            {group.hasPaid && <span className="badge-ds badge-muted" style={{ marginLeft: 6 }}>Pagado</span>}
                            {group.customerNameSnapshot && <div className="pos-ir-sub">{group.customerNameSnapshot}</div>}
                            {group.modifiers.length > 0 && (
                              <div className="pos-ir-sub">{group.modifiers.map(m => m.nameSnapshot).join(", ")}</div>
                            )}
                          </div>
                          <span className="pos-ir-price">{formatCurrency(unitPrice)}</span>
                          <span className={`pos-ir-price ${hasDiscount ? "pos-ir-strikethrough" : ""}`}>{formatCurrency(group.totalAmount)}</span>
                          <div style={{ display: 'flex', justifyContent: 'center' }}>
                            {!group.hasPaid && canPay ? (
                              <button className="pos-ir-disc-btn" onClick={() => openDiscountDialog(group.firstItemId)} data-testid={`button-discount-item-${group.firstItemId}`}>
                                <Percent size={13} />
                              </button>
                            ) : (
                              <span style={{ fontSize: 13, color: 'var(--text3)' }}>-</span>
                            )}
                          </div>
                        </div>
                        {hasDiscount && (
                          <div className="pos-discount-line">
                            <span className="pos-disc-text">
                              -{group.discounts[0]?.discountName}: {formatCurrency(group.totalDiscount)}
                            </span>
                            <span className="pos-disc-net">
                              = {formatCurrency(group.totalAmount - group.totalDiscount)}
                            </span>
                            {!group.hasPaid && canPay && (
                              <button
                                className="pos-disc-remove"
                                onClick={() => removeDiscountMutation.mutate(group.firstItemId)}
                                disabled={removeDiscountMutation.isPending}
                                data-testid={`button-remove-discount-${group.firstItemId}`}
                              >
                                <X size={11} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="pos-totals">
                  <div className="pos-totals-row">
                    <span className="pos-totals-label">Subtotal</span>
                    <span className="pos-totals-val">{formatCurrency(getOrderSubtotal(selectedTable))}</span>
                  </div>
                  {selectedTable.taxBreakdown && selectedTable.taxBreakdown.length > 0 ? (
                    selectedTable.taxBreakdown.map((tb, idx) => (
                      <div key={idx} className="pos-totals-row">
                        <span className="pos-totals-label">{tb.taxName}{tb.inclusive ? " (ii)" : ""}</span>
                        <span className="pos-totals-val">{tb.inclusive ? "" : "+"}{formatCurrency(Number(tb.totalAmount))}</span>
                      </div>
                    ))
                  ) : (
                    <div className="pos-totals-row">
                      <span className="pos-totals-label">Impuestos</span>
                      <span className="pos-totals-val">{formatCurrency(0)}</span>
                    </div>
                  )}
                  <div className="pos-totals-row">
                    <span className="pos-totals-label">Descuentos</span>
                    <span className={`pos-totals-val ${Number(selectedTable.totalDiscounts || 0) > 0 ? "discount" : ""}`}>
                      {Number(selectedTable.totalDiscounts || 0) > 0 ? `-${formatCurrency(Number(selectedTable.totalDiscounts))}` : formatCurrency(0)}
                    </span>
                  </div>
                  <div className="pos-totals-sep" />
                  <div className="pos-totals-total" data-testid="text-detail-total">
                    <span className="pos-totals-total-label">Total a pagar</span>
                    <span className="pos-totals-total-val">{formatCurrency(Number(selectedTable.totalAmount))}</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn-secondary"
                      style={{ width: '100%' }}
                      onClick={() => {
                        const tbl = selectedTable;
                        apiRequest("POST", "/api/pos/print-precuenta", { orderId: tbl.orderId })
                          .then(r => r.json())
                          .then(data => toast({ title: "Pre-cuenta impresa", description: `Enviado a ${data.printer}` }))
                          .catch(() => {
                            const orderNum = tbl.globalNumber ? `G-${tbl.globalNumber}` : (tbl.dailyNumber ? `D-${tbl.dailyNumber}` : `#${tbl.orderId}`);
                            const grouped = groupItems(tbl.items);
                            const receiptItems = grouped.map((g) => {
                              const modDelta = g.modifiers.reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
                              const modLabel = g.modifiers.length > 0 ? ` (${g.modifiers.map(m => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +${formatCurrency(Number(m.priceDeltaSnapshot))}` : "")).join(", ")})` : "";
                              const unitPrice = Number(g.productPriceSnapshot) + modDelta;
                              return { name: g.productNameSnapshot + modLabel, qty: g.totalQty, price: unitPrice, total: g.totalAmount };
                            });
                            triggerReceiptPrint(
                              receiptItems,
                              Number(tbl.totalAmount),
                              "PRE-CUENTA",
                              tbl.tableName,
                              orderNum,
                              undefined,
                              Number(tbl.totalDiscounts || 0),
                              Number(tbl.totalTaxes || 0),
                              tbl.taxBreakdown
                            );
                          });
                      }}
                      data-testid="button-pre-cuenta"
                    >
                      <Receipt size={14} /> Pre-cuenta
                    </button>
                  </div>
                </div>
              </div>

              <div>
                {canVoid && orderPayments.filter(p => p.status === "PAID").length > 0 && (
                  <div className="pos-detail-card" style={{ marginBottom: 16 }}>
                    <div className="pos-dc-header">
                      <span className="pos-dc-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <XCircle size={14} /> Anulaciones
                      </span>
                    </div>
                    <div className="pos-dc-body">
                      <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Pagos activos de esta orden:</p>
                      {orderPayments.filter(p => p.status === "PAID").map((p: any) => (
                        <div key={p.id} className="pos-payment-row" data-testid={`payment-row-${p.id}`}>
                          <div>
                            <span className="pos-payment-amount">{formatCurrency(Number(p.amount))}</span>
                            <span className="pos-payment-method" style={{ marginLeft: 8 }}>{p.paymentMethodName}</span>
                          </div>
                          <button
                            className="btn-danger"
                            style={{ padding: '6px 12px', minHeight: 32, fontSize: 12 }}
                            onClick={() => voidPaymentMutation.mutate(p.id)}
                            disabled={voidPaymentMutation.isPending}
                            data-testid={`button-void-payment-${p.id}`}
                          >
                            <XCircle size={12} /> Anular
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="pos-tabs">
            <button className={`pos-tab ${tab === "tables" ? "active" : ""}`} onClick={() => setTab("tables")} data-testid="tab-pos-tables">Mesas</button>
            <button className={`pos-tab ${tab === "cash" ? "active" : ""}`} onClick={() => setTab("cash")} data-testid="tab-cash">Caja</button>
            <button className={`pos-tab ${tab === "paid" ? "active" : ""}`} onClick={() => setTab("paid")} data-testid="tab-paid-tickets">Pagados</button>
          </div>

          <div className="pos-content">
            {tab === "tables" && (
              <>
                {isLoading ? (
                  <div className="pos-loading"><Loader2 size={32} className="animate-spin" /></div>
                ) : posTables.length === 0 ? (
                  <div className="pos-empty">
                    <div className="pos-empty-icon"><Receipt size={48} /></div>
                    <div className="pos-empty-text">No hay mesas con consumos pendientes de pago</div>
                  </div>
                ) : (
                  <div className="pos-table-grid">
                    {[...posTables].sort((a, b) => {
                      if (a.id !== b.id) return a.id - b.id;
                      const aIsParent = !a.parentOrderId ? 0 : 1;
                      const bIsParent = !b.parentOrderId ? 0 : 1;
                      if (aIsParent !== bIsParent) return aIsParent - bIsParent;
                      const aSplit = a.splitIndex || 0;
                      const bSplit = b.splitIndex || 0;
                      return aSplit - bSplit;
                    }).map((t) => (
                      <div
                        key={`${t.id}-${t.orderId}`}
                        className={`pos-table-card ${highlightedOrderIds.includes(t.orderId) ? "highlighted" : ""}`}
                        onClick={() => { setSelectedTable(t); setDetailView(true); }}
                        data-testid={`card-pos-table-${t.id}-order-${t.orderId}`}
                      >
                        <div className="pos-tc-top">
                          <span className="pos-tc-name">{t.tableName}</span>
                          <span className="pos-tc-items-badge">{t.itemCount} items</span>
                        </div>
                        {t.subaccountNames && t.subaccountNames.length > 0 && (
                          <div className="pos-tc-subs" data-testid={`text-subnames-${t.orderId}`}>
                            {t.subaccountNames.join(", ")}
                          </div>
                        )}
                        <div className="pos-tc-mid">
                          <span className="pos-tc-amount">{formatCurrency(Number(t.totalAmount))}</span>
                          {t.openedAt && (
                            <span className="pos-tc-time">
                              {(() => {
                                const diff = Date.now() - new Date(t.openedAt).getTime();
                                const mins = Math.floor(diff / 60000);
                                if (mins < 60) return `${mins}m`;
                                const hrs = Math.floor(mins / 60);
                                return `${hrs}h ${mins % 60}m`;
                              })()}
                            </span>
                          )}
                        </div>
                        <div className="pos-tc-actions">
                          {canPay && (
                            <button
                              className="btn-primary"
                              style={{ padding: '8px 14px', fontSize: 12, minHeight: 36 }}
                              onClick={(e) => { e.stopPropagation(); openNewPayDialog(t); }}
                              disabled={!cashSession?.id || !!cashSession.closedAt}
                              data-testid={`button-pay-table-${t.id}-order-${t.orderId}`}
                            >
                              <DollarSign size={14} /> Pagar
                            </button>
                          )}
                          {canSplit && !t.parentOrderId && (
                            <button
                              className="btn-secondary"
                              style={{ padding: '8px 14px', fontSize: 12, minHeight: 36 }}
                              onClick={(e) => { e.stopPropagation(); openSplitDialog(t); }}
                              data-testid={`button-split-table-${t.id}`}
                            >
                              <Split size={14} /> Dividir
                            </button>
                          )}
                          {canVoidOrder && (
                            <button
                              className="btn-danger"
                              style={{ padding: '8px 14px', fontSize: 12, minHeight: 36 }}
                              onClick={(e) => { e.stopPropagation(); setVoidOrderId(t.orderId); setVoidOrderOpen(true); }}
                              data-testid={`button-void-order-table-${t.id}`}
                            >
                              <XCircle size={14} /> Anular
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "paid" && (
              <>
                {paidLoading ? (
                  <div className="pos-loading"><Loader2 size={32} className="animate-spin" /></div>
                ) : paidOrders.length === 0 ? (
                  <div className="pos-empty">
                    <div className="pos-empty-icon"><Receipt size={48} /></div>
                    <div className="pos-empty-text">No hay tiquetes pagados hoy</div>
                  </div>
                ) : (
                  <div>
                    {paidOrders.map((t) => (
                      <div
                        key={t.orderId}
                        className="paid-order-item"
                        onClick={() => setPaidTicketActions({ orderId: t.orderId, tableName: t.tableName, ticketNumber: t.ticketNumber })}
                        data-testid={`card-paid-ticket-${t.orderId}`}
                      >
                        <div className="poi-left">
                          <div className="poi-name">{t.tableName}</div>
                          {t.ticketNumber && <div className="poi-ticket">{t.ticketNumber}</div>}
                          {t.closedAt && (
                            <div className="poi-time">
                              {new Date(t.closedAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          )}
                        </div>
                        <div className="poi-right">
                          <span className="poi-amount">{formatCurrency(Number(t.totalAmount))}</span>
                          <span className="poi-pm-badge">{t.paymentMethods.join(", ")}</span>
                          <span className="poi-items-badge">{t.itemCount} items</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {tab === "cash" && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16, maxWidth: 600 }}>
                <div className="cash-session-card">
                  <div className="csc-title">Sesión de Caja</div>
                  {cashSession?.id && !cashSession.closedAt ? (
                    <div>
                      <div className="csc-stats">
                        <div className="csc-stat">
                          <div className="csc-stat-label">Apertura</div>
                          <div className="csc-stat-val">{formatCurrency(Number(cashSession.openingCash))}</div>
                        </div>
                        {canViewCashReport && (
                          <div className="csc-stat">
                            <div className="csc-stat-label">Efectivo Esperado</div>
                            <div className="csc-stat-val">{formatCurrency(Number(cashSession.expectedCash || 0))}</div>
                          </div>
                        )}
                      </div>
                      {canViewCashReport && cashSession.totalsByMethod && typeof cashSession.totalsByMethod === "object" && (
                        <div className="csc-methods">
                          <div className="csc-methods-title">Totales por Método</div>
                          {Object.entries(cashSession.totalsByMethod as Record<string, number>).map(([method, amount]) => (
                            <div key={method} className="csc-method-row" data-testid={`text-live-total-method-${method}`}>
                              <span className="csc-method-name">{method}</span>
                              <span className="csc-method-val">{formatCurrency(Number(amount))}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {canCashClose && (
                        <button className="btn-danger" style={{ width: '100%', marginTop: 16 }} onClick={() => setCloseOpen(true)} data-testid="button-close-cash">
                          <Lock size={14} /> Cerrar Caja
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>No hay sesión de caja abierta</p>
                      <button className="btn-primary" style={{ width: '100%' }} onClick={() => setCashOpen(true)} data-testid="button-open-cash">
                        <Unlock size={14} /> Abrir Caja
                      </button>
                    </div>
                  )}
                </div>

                {cashSession?.closedAt && (
                  <div className="cash-session-card">
                    <div className="csc-title">Último Cierre</div>
                    <div className="csc-stats">
                      <div className="csc-stat">
                        <div className="csc-stat-label">Apertura</div>
                        <div className="csc-stat-val">{formatCurrency(Number(cashSession.openingCash))}</div>
                      </div>
                      <div className="csc-stat">
                        <div className="csc-stat-label">Contado</div>
                        <div className="csc-stat-val">{formatCurrency(Number(cashSession.countedCash || 0))}</div>
                      </div>
                    </div>
                    {canViewCashReport && (
                      <>
                        <div className="csc-stats" style={{ marginTop: 0 }}>
                          <div className="csc-stat">
                            <div className="csc-stat-label">Esperado</div>
                            <div className="csc-stat-val">{formatCurrency(Number(cashSession.expectedCash || 0))}</div>
                          </div>
                          <div className="csc-stat">
                            <div className="csc-stat-label">Diferencia</div>
                            <div className="csc-stat-val" style={{ color: Number(cashSession.difference || 0) < 0 ? 'var(--red)' : 'var(--text)' }}>
                              {formatCurrency(Number(cashSession.difference || 0))}
                            </div>
                          </div>
                        </div>
                        {cashSession.totalsByMethod && typeof cashSession.totalsByMethod === "object" && (
                          <div className="csc-methods">
                            <div className="csc-methods-title">Totales por Método</div>
                            {Object.entries(cashSession.totalsByMethod as Record<string, number>).map(([method, amount]) => (
                              <div key={method} className="csc-method-row" data-testid={`text-total-method-${method}`}>
                                <span className="csc-method-name">{method}</span>
                                <span className="csc-method-val">{formatCurrency(Number(amount))}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <PayDialog
        open={payDialogOpen}
        onClose={() => setPayDialogOpen(false)}
        table={selectedTable}
        paymentMethods={paymentMethods}
        splitId={payDialogSplitId}
        splitLabel={payDialogSplitLabel}
        splitTotal={payDialogSplitTotal}
        canEditCustomer={canEditCustomerPrepay}
        canEmailTicket={canEmailTicket}
        canPrint={canPrint}
        onSuccess={handlePayDialogSuccess}
      />

      <SplitDialog
        open={splitDialogOpen}
        onClose={() => setSplitDialogOpen(false)}
        table={selectedTable}
        onPaySplit={handleSplitPaySub}
        onPayAll={handleSplitPayAll}
        onSeparated={handleSplitSeparated}
      />

      {cashOpen && (
        <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCashOpen(false); }}>
          <div className="ds-dialog">
            <div className="ds-dlg-header">
              <div className="ds-dlg-title">Abrir Caja</div>
            </div>
            <div className="ds-dlg-body">
              <div className="field" style={{ marginBottom: 16 }}>
                <label className="field-lbl">Monto Inicial en Efectivo</label>
                <input className="field-input" data-testid="input-opening-cash" type="number" step="0.01" value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0.00" />
              </div>
              <button className="btn-primary" style={{ width: '100%' }} onClick={() => openCashMutation.mutate()} disabled={openCashMutation.isPending} data-testid="button-confirm-open-cash">
                {openCashMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Abrir Caja
              </button>
            </div>
          </div>
        </div>
      )}

      {closeOpen && (
        <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCloseOpen(false); }}>
          <div className="ds-dialog">
            <div className="ds-dlg-header">
              <div className="ds-dlg-title">Cerrar Caja</div>
            </div>
            <div className="ds-dlg-body">
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="field-lbl">Efectivo Contado</label>
                <input className="field-input" data-testid="input-counted-cash" type="number" step="0.01" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} placeholder="0.00" />
              </div>
              <div className="field" style={{ marginBottom: 16 }}>
                <label className="field-lbl">Notas</label>
                <input className="field-input" value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Observaciones del cierre" />
              </div>
              <button className="btn-danger" style={{ width: '100%' }} onClick={() => closeCashMutation.mutate()} disabled={closeCashMutation.isPending} data-testid="button-confirm-close-cash">
                {closeCashMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                Confirmar Cierre
              </button>
            </div>
          </div>
        </div>
      )}

      {discountOpen && (
        <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDiscountOpen(false); }}>
          <div className="ds-dialog ds-dialog-lg">
            <div className="ds-dlg-header">
              <div className="ds-dlg-title">Aplicar Descuento</div>
            </div>
            <div className="ds-dlg-body">
              {discountItemId && selectedTable && (() => {
                const item = selectedTable.items.find(i => i.id === discountItemId);
                if (!item) return null;
                return (
                  <p className="ds-dlg-sub">
                    {item.qty}x {item.productNameSnapshot} - {formatCurrency(getItemTotal(item))}
                  </p>
                );
              })()}
              {discountsLoading ? (
                <div className="pos-loading"><Loader2 size={20} className="animate-spin" /></div>
              ) : systemDiscounts.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--text3)', padding: '16px 0', textAlign: 'center' }}>No hay descuentos configurados. Cree descuentos desde el panel de administración.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {systemDiscounts.map((d: any) => (
                    <div key={d.id} className="pos-detail-card" style={{ padding: 12 }} data-testid={`discount-option-${d.id}`}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <div>
                          <span style={{ fontWeight: 500, fontSize: 14 }}>{d.name}</span>
                          <span className="badge-ds badge-muted" style={{ marginLeft: 8 }}>
                            {d.type === "percentage" ? `${Number(d.value)}%` : formatCurrency(Number(d.value))}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                          onClick={() => applyDiscountMutation.mutate({ discountName: d.name, discountType: d.type, discountValue: d.value, applyToAll: false })}
                          disabled={applyDiscountMutation.isPending}
                          data-testid={`button-apply-discount-item-${d.id}`}
                        >
                          {applyDiscountMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                          Aplicar a este item
                        </button>
                        <button
                          className="btn-primary"
                          style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                          onClick={() => applyDiscountMutation.mutate({ discountName: d.name, discountType: d.type, discountValue: d.value, applyToAll: true })}
                          disabled={applyDiscountMutation.isPending}
                          data-testid={`button-apply-discount-all-${d.id}`}
                        >
                          {applyDiscountMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                          Aplicar a toda la cuenta
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {voidOrderOpen && (
        <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setVoidOrderOpen(false); setVoidOrderId(null); setVoidOrderReason(""); } }}>
          <div className="ds-dialog">
            <div className="ds-dlg-header">
              <div className="ds-dlg-title">Anular Orden Completa</div>
            </div>
            <div className="ds-dlg-body">
              <p className="ds-dlg-sub">
                Esta acción anulará todos los ítems de la orden y liberará la mesa. Esta acción no se puede deshacer.
              </p>
              <div className="field" style={{ marginBottom: 16 }}>
                <label className="field-lbl">Motivo (opcional)</label>
                <input
                  className="field-input"
                  value={voidOrderReason}
                  onChange={(e) => setVoidOrderReason(e.target.value)}
                  placeholder="Motivo de la anulación..."
                  data-testid="input-void-order-reason"
                />
              </div>
              <div className="ds-dlg-actions">
                <button className="btn-secondary" onClick={() => { setVoidOrderOpen(false); setVoidOrderId(null); setVoidOrderReason(""); }} data-testid="button-cancel-void-order">
                  Cancelar
                </button>
                <button
                  className="btn-danger"
                  onClick={() => voidOrderMutation.mutate()}
                  disabled={voidOrderMutation.isPending}
                  data-testid="button-confirm-void-order"
                >
                  {voidOrderMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                  Anular Orden
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {addItemsOpen && (
        <div className="pos-add-items-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setAddItemsOpen(false); setPosCart([]); } }}>
          <div className="pos-add-items-dialog">
            <div className="pos-aid-header">
              <div className="pos-aid-title">Agregar Productos</div>
            </div>
            <div className="pos-aid-body">
              <Accordion type="multiple" className="w-full">
                {posCategories.filter((c: Category) => c.active).map((cat: Category) => {
                  const prods = posCategoryProducts[cat.id] || [];
                  if (prods.length === 0) return null;
                  return (
                    <AccordionItem key={cat.id} value={`cat-${cat.id}`}>
                      <AccordionTrigger data-testid={`accordion-category-${cat.id}`}>{cat.name}</AccordionTrigger>
                      <AccordionContent>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {prods.map((p: Product) => {
                            const inCart = posCart.find(c => c.productId === p.id);
                            return (
                              <div key={p.id} className="pos-aid-product" data-testid={`product-row-${p.id}`}>
                                <div style={{ flex: 1 }}>
                                  <span className="pos-aid-pname">{p.name}</span>
                                  <span className="pos-aid-pprice">{formatCurrency(Number(p.price))}</span>
                                </div>
                                {inCart ? (
                                  <div className="pos-aid-qty-controls">
                                    <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => updatePosCartQty(posCart.indexOf(inCart), inCart.qty - 1)} data-testid={`button-decrease-${p.id}`}>
                                      <Minus size={12} />
                                    </button>
                                    <span className="pos-aid-qty" data-testid={`text-cart-qty-${p.id}`}>{inCart.qty}</span>
                                    <button className="btn-icon" style={{ width: 28, height: 28 }} onClick={() => updatePosCartQty(posCart.indexOf(inCart), inCart.qty + 1)} data-testid={`button-increase-${p.id}`}>
                                      <Plus size={12} />
                                    </button>
                                  </div>
                                ) : (
                                  <button className="btn-icon" style={{ width: 28, height: 28, background: 'transparent', border: 'none' }} onClick={() => addToPosCart(p)} data-testid={`button-add-product-${p.id}`}>
                                    <Plus size={16} />
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
            {posCart.length > 0 && (
              <div className="pos-aid-footer">
                <div className="pos-aid-cart-info">
                  {posCart.reduce((s, c) => s + c.qty, 0)} items · {formatCurrency(posCartTotal)}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn-icon"
                    onClick={() => addItemsMutation.mutate(false)}
                    disabled={addItemsMutation.isPending}
                    title="Solo Guardar"
                    data-testid="button-save-only"
                  >
                    {addItemsMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  </button>
                  <button
                    className="btn-icon"
                    style={{ background: 'var(--green)', color: '#050f08', border: 'none' }}
                    onClick={() => addItemsMutation.mutate(true)}
                    disabled={addItemsMutation.isPending}
                    title="Guardar y Enviar a KDS"
                    data-testid="button-save-and-kds"
                  >
                    {addItemsMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <SendHorizontal size={16} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {posModDialogProduct && (
        <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setPosModDialogProduct(null); setPosModGroups([]); setPosSelectedMods({}); } }}>
          <div className="pos-mod-dialog">
            <div className="ds-dlg-header">
              <div className="ds-dlg-title" data-testid="text-pos-modifier-title">{posModDialogProduct?.name} - Modificadores</div>
            </div>
            <div className="ds-dlg-body">
              {posModGroups.map((group) => (
                <div key={group.id} className="pos-mod-group">
                  <div className="pos-mod-group-title">
                    {group.name}
                    {group.required && <span className="pos-mod-required">*</span>}
                  </div>
                  <div>
                    {group.options.filter(o => o.active).map((opt) => {
                      const selected = posSelectedMods[group.id] || [];
                      const isChecked = selected.includes(opt.id);
                      return (
                        <label key={opt.id} className="pos-mod-option" data-testid={`pos-mod-option-${opt.id}`}>
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) => {
                              if (group.multiSelect) {
                                setPosSelectedMods(prev => ({
                                  ...prev,
                                  [group.id]: checked
                                    ? [...(prev[group.id] || []), opt.id]
                                    : (prev[group.id] || []).filter(id => id !== opt.id),
                                }));
                              } else {
                                setPosSelectedMods(prev => ({
                                  ...prev,
                                  [group.id]: checked ? [opt.id] : [],
                                }));
                              }
                            }}
                          />
                          <span className="pos-mod-opt-name">{opt.name}</span>
                          {Number(opt.priceDelta) > 0 && (
                            <span className="pos-mod-opt-price">+{formatCurrency(Number(opt.priceDelta))}</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button className="btn-primary" style={{ width: '100%' }} onClick={confirmPosModifiers} data-testid="button-confirm-pos-modifiers">
                Agregar al carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {paidTicketActions && (
        <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setPaidTicketActions(null); setPaidShowEmailForm(false); setPaidEmailInput(""); } }}>
          <div className="ds-dialog">
            <div className="ds-dlg-header">
              <div className="ds-dlg-title">Tiquete Pagado</div>
            </div>
            <div className="ds-dlg-body">
              <p className="ds-dlg-sub">
                {paidTicketActions?.tableName} {paidTicketActions?.ticketNumber}
              </p>
              {paidShowEmailForm ? (
                <div>
                  <div className="field" style={{ marginBottom: 12 }}>
                    <label className="field-lbl">Correo electrónico del cliente</label>
                    <input
                      className="field-input"
                      data-testid="input-paid-client-email"
                      type="email"
                      placeholder="cliente@ejemplo.com"
                      value={paidEmailInput}
                      onChange={(e) => setPaidEmailInput(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button
                      className="btn-primary"
                      data-testid="button-paid-confirm-send-email"
                      disabled={paidSendingEmail || !paidEmailInput.trim()}
                      onClick={async () => {
                        if (!paidTicketActions || !paidEmailInput.trim()) return;
                        setPaidSendingEmail(true);
                        try {
                          await apiRequest("POST", "/api/pos/send-ticket", {
                            orderId: paidTicketActions.orderId,
                            clientEmail: paidEmailInput.trim(),
                          });
                          toast({ title: "Tiquete enviado", description: `Enviado a ${paidEmailInput.trim()}` });
                          setPaidShowEmailForm(false);
                          setPaidEmailInput("");
                        } catch (err: any) {
                          toast({ title: "Error al enviar", description: err.message, variant: "destructive" });
                        } finally {
                          setPaidSendingEmail(false);
                        }
                      }}
                    >
                      {paidSendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
                      Enviar
                    </button>
                    <button
                      className="btn-secondary"
                      data-testid="button-paid-cancel-email"
                      onClick={() => { setPaidShowEmailForm(false); setPaidEmailInput(""); }}
                    >
                      <ArrowLeft size={14} /> Regresar
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {canPrint && (
                    <>
                      <button
                        className="btn-primary"
                        data-testid="button-paid-direct-print"
                        disabled={paidPrintingDirect}
                        onClick={async () => {
                          if (!paidTicketActions) return;
                          setPaidPrintingDirect(true);
                          try {
                            const res = await apiRequest("POST", "/api/pos/print-receipt", {
                              orderId: paidTicketActions.orderId,
                            });
                            const data = await res.json();
                            toast({ title: "Impreso", description: `Enviado a ${data.printer}` });
                          } catch (err: any) {
                            toast({ title: "Error de impresora", description: err.message, variant: "destructive" });
                          } finally {
                            setPaidPrintingDirect(false);
                          }
                        }}
                      >
                        {paidPrintingDirect ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                        Imprimir en Impresora WiFi
                      </button>
                      <button
                        className="btn-secondary"
                        data-testid="button-paid-browser-print"
                        onClick={async () => {
                          if (!paidTicketActions) return;
                          try {
                            const res = await fetch(`/api/pos/receipt-data/${paidTicketActions.orderId}`, { credentials: "include" });
                            if (res.ok) {
                              const data = await res.json();
                              triggerReceiptPrint(
                                data.items,
                                data.total,
                                data.paymentMethod,
                                data.tableName,
                                data.orderNumber,
                                data.clientName,
                                data.totalDiscounts,
                                data.totalTaxes,
                                data.taxBreakdown
                              );
                            } else {
                              toast({ title: "Error", description: "No se pudo obtener datos del tiquete", variant: "destructive" });
                            }
                          } catch (err: any) {
                            toast({ title: "Error", description: err.message, variant: "destructive" });
                          }
                        }}
                      >
                        <Receipt size={14} /> Ver Tiquete en Pantalla
                      </button>
                    </>
                  )}
                  {canEmailTicket && (
                    <button
                      className="btn-secondary"
                      data-testid="button-paid-send-email"
                      onClick={() => setPaidShowEmailForm(true)}
                    >
                      <Mail size={14} /> Enviar Tiquete por Correo
                    </button>
                  )}
                  {canReopen && (
                    <button
                      className="btn-danger"
                      data-testid="button-paid-reopen"
                      onClick={async () => {
                        if (!paidTicketActions) return;
                        try {
                          await apiRequest("POST", `/api/pos/reopen/${paidTicketActions.orderId}`);
                          toast({ title: "Orden reabierta" });
                          queryClient.invalidateQueries({ queryKey: ["/api/pos/paid-orders"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
                          setPaidTicketActions(null);
                        } catch (err: any) {
                          toast({ title: "Error", description: err.message, variant: "destructive" });
                        }
                      }}
                    >
                      <Unlock size={14} /> Reabrir Orden
                    </button>
                  )}
                  <button
                    className="btn-secondary"
                    data-testid="button-paid-close-dialog"
                    onClick={() => setPaidTicketActions(null)}
                  >
                    <ArrowLeft size={14} /> Regresar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {printConfirmOrderId !== null && (
        <div className="ds-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setPrintConfirmOrderId(null); setPrintConfirmSplitPaymentId(null); setPrintConfirmSplitLabel(""); setPrintConfirmPaidItemIds([]); } }}>
          <div className="ds-dialog" style={{ maxWidth: 360 }}>
            <div className="ds-dlg-header">
              <div className="ds-dlg-title">Imprimir Recibo{printConfirmSplitLabel ? ` — ${printConfirmSplitLabel}` : ""}</div>
            </div>
            <div className="ds-dlg-body" style={{ textAlign: 'center', padding: '20px 24px' }}>
              <p style={{ fontSize: 15, marginBottom: 20 }}>¿Desea imprimir el recibo?</p>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button
                  className="btn-primary"
                  data-testid="button-print-yes"
                  style={{ minWidth: 120 }}
                  onClick={() => {
                    const printBody: any = { orderId: printConfirmOrderId };
                    if (printConfirmSplitPaymentId) {
                      printBody.splitPaymentId = printConfirmSplitPaymentId;
                      printBody.splitLabel = printConfirmSplitLabel;
                      if (printConfirmPaidItemIds.length > 0) {
                        printBody.paidItemIds = printConfirmPaidItemIds;
                      }
                    }
                    apiRequest("POST", "/api/pos/print-receipt", printBody)
                      .then(r => r.json())
                      .then(data => toast({ title: "Impreso", description: `Enviado a ${data.printer}` }))
                      .catch(() => toast({ title: "Error al imprimir", variant: "destructive" }));
                    setPrintConfirmOrderId(null);
                    setPrintConfirmSplitPaymentId(null);
                    setPrintConfirmSplitLabel("");
                    setPrintConfirmPaidItemIds([]);
                  }}
                >
                  Sí, Imprimir
                </button>
                <button
                  className="btn-secondary"
                  data-testid="button-print-no"
                  style={{ minWidth: 120 }}
                  onClick={() => { setPrintConfirmOrderId(null); setPrintConfirmSplitPaymentId(null); setPrintConfirmSplitLabel(""); setPrintConfirmPaidItemIds([]); }}
                >
                  No Imprimir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
