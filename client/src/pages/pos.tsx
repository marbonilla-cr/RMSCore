import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { wsManager } from "@/lib/ws";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  CreditCard, DollarSign, Loader2, Receipt,
  Banknote, ArrowLeft, Lock, Unlock,
  Split, Trash2, XCircle, Mail, Printer,
} from "lucide-react";
import type { PaymentMethod } from "@shared/schema";
import { printReceipt } from "@/lib/print-receipt";

interface POSTable {
  id: number;
  tableName: string;
  orderId: number;
  dailyNumber?: number | null;
  globalNumber?: number | null;
  totalAmount: string;
  itemCount: number;
  items: { id: number; productNameSnapshot: string; qty: number; productPriceSnapshot: string; status: string }[];
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
  const isManager = user?.role === "MANAGER";

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
    enabled: !!selectedTable?.orderId && detailView && isManager,
  });

  const assignedItemIds = splits.flatMap((s) => s.items.map((si) => si.orderItemId));

  const getItemTotal = (item: POSTable["items"][0]) =>
    Number(item.productPriceSnapshot) * item.qty;

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

  const triggerReceiptPrint = (items: { name: string; qty: number; price: number; total: number }[], total: number, pmName: string, tblName: string, ordNum: string, clName?: string) => {
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
      const receiptItems = tbl.items.filter(i => i.status !== "VOIDED").map((i) => ({
        name: i.productNameSnapshot,
        qty: i.qty,
        price: Number(i.productPriceSnapshot),
        total: Number(i.productPriceSnapshot) * i.qty,
      }));
      const orderNum = tbl.globalNumber ? `G-${tbl.globalNumber}` : (tbl.dailyNumber ? `D-${tbl.dailyNumber}` : `#${tbl.orderId}`);
      triggerReceiptPrint(receiptItems, Number(tbl.totalAmount), pm?.paymentName || "", tbl.tableName, orderNum, clientName || undefined);

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

  const activePaymentMethods = paymentMethods.filter((m) => m.active);

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

  const handleCobrarClick = (table: POSTable) => {
    setSelectedTable(table);
    setDetailView(true);
    setSelectedItemIds([]);
    setSplitLabel("");
  };

  const closeDetailView = () => {
    setDetailView(false);
    setSelectedTable(null);
    setSelectedItemIds([]);
    setSplitLabel("");
  };

  const payingAmount = payingSplitId
    ? getSplitTotal(splits.find((s) => s.id === payingSplitId)!)
    : Number(selectedTable?.totalAmount || 0);

  const payingLabel = payingSplitId
    ? splits.find((s) => s.id === payingSplitId)?.label || "Subcuenta"
    : selectedTable?.tableName || "";

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
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
            <span className="font-bold text-lg ml-auto" data-testid="text-detail-total">
              Total: ₡{Number(selectedTable.totalAmount).toLocaleString()}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                <h3 className="font-bold">Items de la Orden</h3>
                <Button
                  onClick={openPaymentForFull}
                  disabled={!cashSession?.id || !!cashSession.closedAt}
                  data-testid="button-pay-full"
                >
                  <DollarSign className="w-4 h-4 mr-1" /> Pagar Todo
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {selectedTable.items.map((item) => {
                    const isAssigned = assignedItemIds.includes(item.id);
                    const isPaid = item.status === "PAID";
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 py-2 px-2 rounded-md ${isPaid ? "opacity-50" : ""} ${isAssigned && !isPaid ? "opacity-60" : ""}`}
                        data-testid={`item-row-${item.id}`}
                      >
                        {!isPaid && !isAssigned && (
                          <Checkbox
                            checked={selectedItemIds.includes(item.id)}
                            onCheckedChange={() => toggleItemSelection(item.id)}
                            data-testid={`checkbox-item-${item.id}`}
                          />
                        )}
                        {isPaid && (
                          <Badge variant="secondary" className="text-xs">Pagado</Badge>
                        )}
                        {isAssigned && !isPaid && (
                          <Badge variant="outline" className="text-xs">Asignado</Badge>
                        )}
                        <span className="flex-1 text-sm">
                          {item.qty}x {item.productNameSnapshot}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          ₡{getItemTotal(item).toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {selectedItemIds.length > 0 && (
                  <div className="mt-4 border-t pt-3 space-y-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Input
                        placeholder={nextSplitLabel()}
                        value={splitLabel}
                        onChange={(e) => setSplitLabel(e.target.value)}
                        className="flex-1 min-w-[150px]"
                        data-testid="input-split-label"
                      />
                      <Button
                        onClick={() => createSplitMutation.mutate()}
                        disabled={createSplitMutation.isPending}
                        data-testid="button-create-split"
                      >
                        {createSplitMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-1" />
                        ) : (
                          <Split className="w-4 h-4 mr-1" />
                        )}
                        Crear Subcuenta ({selectedItemIds.length})
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Subtotal seleccionado: ₡{selectedTable.items
                        .filter((i) => selectedItemIds.includes(i.id))
                        .reduce((s, i) => s + getItemTotal(i), 0)
                        .toLocaleString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <h3 className="font-bold flex items-center gap-2">
                <Split className="w-4 h-4" /> Dividir Cuenta
              </h3>

              {splitsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : splits.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center">
                    <p className="text-muted-foreground text-sm">
                      No hay subcuentas. Selecciona items y crea una subcuenta.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                splits.map((split) => {
                  const splitTotal = getSplitTotal(split);
                  const allSplitItemsPaid = split.items.every((si) => {
                    const oi = selectedTable.items.find((i) => i.id === si.orderItemId);
                    return oi?.status === "PAID";
                  });

                  return (
                    <Card key={split.id} data-testid={`card-split-${split.id}`}>
                      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold">{split.label}</h4>
                          {allSplitItemsPaid && (
                            <Badge variant="default">Pagado</Badge>
                          )}
                        </div>
                        {!allSplitItemsPaid && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteSplitMutation.mutate(split.id)}
                            disabled={deleteSplitMutation.isPending}
                            data-testid={`button-delete-split-${split.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-1 mb-3">
                          {split.items.map((si) => {
                            const oi = selectedTable.items.find((i) => i.id === si.orderItemId);
                            if (!oi) return null;
                            return (
                              <div key={si.id} className="flex items-center justify-between text-sm py-1">
                                <span>{oi.qty}x {oi.productNameSnapshot}</span>
                                <span className="text-muted-foreground">₡{getItemTotal(oi).toLocaleString()}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="border-t pt-3 flex items-center justify-between gap-2 flex-wrap">
                          <span className="font-bold text-lg" data-testid={`text-split-total-${split.id}`}>
                            ₡{splitTotal.toLocaleString()}
                          </span>
                          {!allSplitItemsPaid ? (
                            <Button
                              onClick={() => openPaymentForSplit(split.id)}
                              disabled={!cashSession?.id || !!cashSession.closedAt}
                              data-testid={`button-pay-split-${split.id}`}
                            >
                              <Banknote className="w-4 h-4 mr-1" /> Pagar Subcuenta
                            </Button>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}

              {isManager && orderPayments.filter(p => p.status === "PAID").length > 0 && (
                <Card>
                  <CardHeader className="pb-2 flex flex-row items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    <h4 className="font-bold text-sm">Acciones Gerente</h4>
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
        </div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="tables" data-testid="tab-pos-tables">Mesas por Cobrar</TabsTrigger>
            <TabsTrigger value="cash" data-testid="tab-cash">Caja</TabsTrigger>
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
                {posTables.map((t) => (
                  <Card key={t.id} data-testid={`card-pos-table-${t.id}`}>
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
                      <div className="border-t pt-3 flex items-center justify-between">
                        <span className="font-bold text-lg">₡{Number(t.totalAmount).toLocaleString()}</span>
                        <Button
                          onClick={() => handleCobrarClick(t)}
                          disabled={!cashSession?.id || !!cashSession.closedAt}
                          data-testid={`button-pay-table-${t.id}`}
                        >
                          <Banknote className="w-4 h-4 mr-1" /> Cobrar
                        </Button>
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
                      <Button variant="destructive" className="w-full mt-4" onClick={() => setCloseOpen(true)} data-testid="button-close-cash">
                        <Lock className="w-4 h-4 mr-1" /> Cerrar Caja
                      </Button>
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
              {!payingSplitId && (
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
            <div className="space-y-2">
              <Label>Nombre del Cliente (opcional)</Label>
              <Input data-testid="input-client-name" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nombre" />
            </div>
            <div className="space-y-2">
              <Label>Email (opcional)</Label>
              <Input data-testid="input-client-email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="email@example.com" type="email" />
            </div>
            {clientEmail && (
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
    </div>
  );
}
