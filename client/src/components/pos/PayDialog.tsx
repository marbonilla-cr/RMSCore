import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PaymentMethod } from "@shared/schema";
import "./pos-dialogs.css";

interface TaxBreakdownEntry {
  taxName: string;
  taxRate: string;
  inclusive: boolean;
  totalAmount: number;
}

interface POSItemModifier {
  id: number;
  nameSnapshot: string;
  priceDeltaSnapshot: string;
  qty: number;
}

interface POSItem {
  id: number;
  productNameSnapshot: string;
  qty: number;
  productPriceSnapshot: string;
  status: string;
  notes?: string | null;
  customerNameSnapshot?: string | null;
  modifiers?: POSItemModifier[];
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
  itemCount: number;
  items: POSItem[];
  totalDiscounts?: string;
  totalTaxes?: string;
  taxBreakdown?: TaxBreakdownEntry[];
}

interface PayDialogProps {
  open: boolean;
  onClose: () => void;
  table: POSTable | null;
  paymentMethods: PaymentMethod[];
  splitId?: number | null;
  splitLabel?: string;
  splitTotal?: number;
  canEditCustomer: boolean;
  canEmailTicket: boolean;
  canPrint: boolean;
  initialClientName?: string;
  initialClientEmail?: string;
  onSuccess: (paymentMethodId: string, clientName: string, clientEmail: string, wasCash: boolean, cashReceived?: number, changeAmount?: number, paymentId?: number, paidItemIds?: number[]) => void;
}

interface PayLeg {
  id: number;
  paymentMethodId: number;
  paymentName: string;
  methodType: string;
  amount: number;
}

const ROUND_TARGETS = [1000, 5000, 10000, 20000, 50000, 100000];

function getSuggestedDenominations(total: number): number[] {
  if (total <= 0) return [1000, 2000, 5000, 10000, 20000, 50000];
  const suggestions = new Set<number>();
  for (const unit of ROUND_TARGETS) {
    const rounded = Math.ceil(total / unit) * unit;
    if (rounded > total) suggestions.add(rounded);
  }
  const sorted = Array.from(suggestions).sort((a, b) => a - b);
  return sorted.slice(0, 6);
}

export function PayDialog({
  open, onClose, table, paymentMethods, splitId, splitLabel, splitTotal,
  canEditCustomer, canEmailTicket, canPrint,
  initialClientName,
  initialClientEmail,
  onSuccess
}: PayDialogProps) {
  const { toast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  const [method, setMethod] = useState<string | null>(null);
  const [methodId, setMethodId] = useState<string>("");
  const [received, setReceived] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [processing, setProcessing] = useState(false);
  const [activeDenom, setActiveDenom] = useState<number | null>(null);

  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

  const [multiMode, setMultiMode] = useState(false);
  const [legs, setLegs] = useState<PayLeg[]>([]);
  const [legNextId, setLegNextId] = useState(1);
  const [legMethodId, setLegMethodId] = useState<string>("");
  const [legAmount, setLegAmount] = useState("");
  const [legCashReceived, setLegCashReceived] = useState(0);
  const [legCashCustom, setLegCashCustom] = useState("");
  const [legCashDenom, setLegCashDenom] = useState<number | null>(null);

  const [loyaltyQuery, setLoyaltyQuery] = useState("");
  const [loyaltyResults, setLoyaltyResults] = useState<any[]>([]);
  const [loyaltySearching, setLoyaltySearching] = useState(false);
  const [selectedLoyaltyCustomer, setSelectedLoyaltyCustomer] = useState<any | null>(null);
  const [redeemMode, setRedeemMode] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const loyaltyDebounceRef = useRef<any>(null);

  const total = splitId ? (splitTotal || 0) : Number(table?.totalAmount || 0);
  const change = received - total;
  const canPay = method === "CASH"
    ? change >= 0 && received > 0
    : method === "EMPLOYEE_CHARGE"
      ? !!selectedEmployeeId
      : !!method;

  const activePaymentMethods = paymentMethods.filter((m) => m.active);

  const legsTotal = legs.reduce((s, l) => s + l.amount, 0);
  const legsRemaining = total - legsTotal;
  const multiCanPay = legs.length >= 2 && Math.abs(legsRemaining) < 1;

  const isEmployeeChargeSelected = method === "EMPLOYEE_CHARGE";

  const { data: employeeList = [] } = useQuery<{ id: number; displayName: string }[]>({
    queryKey: ["/api/pos/employees-for-charge"],
    enabled: isEmployeeChargeSelected,
  });

  useEffect(() => {
    if (open) {
      setStep(1);
      setMethod(null);
      setMethodId("");
      setReceived(0);
      setCustomInput("");
      setClientName(initialClientName || "");
      setClientEmail(initialClientEmail || "");
      setProcessing(false);
      setActiveDenom(null);
      setSelectedEmployeeId("");
      setMultiMode(false);
      setLegs([]);
      setLegNextId(1);
      setLegMethodId("");
      setLegAmount("");
      setLegCashReceived(0);
      setLegCashCustom("");
      setLegCashDenom(null);
      setLoyaltyQuery("");
      setLoyaltyResults([]);
      setSelectedLoyaltyCustomer(null);
      setRedeemMode(false);
      setRedeemInput("");
    }
  }, [open]);

  useEffect(() => {
    if (loyaltyDebounceRef.current) clearTimeout(loyaltyDebounceRef.current);
    if (!loyaltyQuery || loyaltyQuery.length < 2) { setLoyaltyResults([]); return; }
    loyaltyDebounceRef.current = setTimeout(async () => {
      setLoyaltySearching(true);
      try {
        const res = await fetch(`/api/loyalty/customers/search?q=${encodeURIComponent(loyaltyQuery)}`);
        if (res.ok) setLoyaltyResults(await res.json());
      } catch { setLoyaltyResults([]); }
      finally { setLoyaltySearching(false); }
    }, 350);
  }, [loyaltyQuery]);

  const getMethodType = (pm: PaymentMethod): string => {
    const code = pm.paymentCode.toUpperCase();
    if (code === "EMPLOYEE_CHARGE") return "EMPLOYEE_CHARGE";
    if (code.includes("CASH") || code.includes("EFECT")) return "CASH";
    if (code.includes("CARD") || code.includes("TARJ")) return "CARD";
    return "SINPE";
  };

  const getMethodIcon = (type: string) => {
    if (type === "CASH") return "$";
    if (type === "CARD") return "C";
    if (type === "EMPLOYEE_CHARGE") return "👤";
    return "S";
  };

  const getMethodColor = (type: string) => {
    if (type === "CASH") return "var(--c-green)";
    if (type === "CARD") return "var(--c-blue)";
    if (type === "EMPLOYEE_CHARGE") return "var(--c-purple, #7c3aed)";
    return "var(--c-amber)";
  };

  const selectMethod = (pm: PaymentMethod) => {
    const type = getMethodType(pm);
    setMethod(type);
    setMethodId(pm.id.toString());
    setReceived(0);
    setCustomInput("");
    setActiveDenom(null);
  };

  const setDenom = (amount: number) => {
    setReceived(amount);
    setCustomInput("");
    setActiveDenom(amount);
  };

  const setCustom = (val: string) => {
    setCustomInput(val);
    setReceived(parseInt(val) || 0);
    setActiveDenom(null);
  };

  const handleProcess = useCallback(async () => {
    if (!table || !methodId || processing) return;
    setProcessing(true);

    try {
      let responsePaymentId: number | undefined;
      let responsePaidItemIds: number[] | undefined;
      if (splitId) {
        const resp = await apiRequest("POST", "/api/pos/pay-split", {
          splitId,
          paymentMethodId: parseInt(methodId),
          clientName: clientName || null,
          clientEmail: clientEmail || null,
        });
        const data = await resp.json();
        responsePaymentId = data?.paymentId;
        responsePaidItemIds = data?.paidItemIds;
      } else {
        const resp = await apiRequest("POST", "/api/pos/pay", {
          orderId: table.orderId,
          paymentMethodId: parseInt(methodId),
          amount: table.totalAmount,
          clientName: clientName || null,
          clientEmail: clientEmail || null,
          ...(method === "EMPLOYEE_CHARGE" && selectedEmployeeId ? { employeeId: parseInt(selectedEmployeeId) } : {}),
        });
        const data = await resp.json();
        responsePaymentId = data?.paymentId;
      }

      if (dialogRef.current) {
        dialogRef.current.classList.add("pos-flash-green");
      }

      const pm = paymentMethods.find(m => m.id.toString() === methodId);
      const wasCash = pm ? (pm.paymentCode.toUpperCase().includes("CASH") || pm.paymentCode.toUpperCase().includes("EFECT")) : false;

      if (selectedLoyaltyCustomer) {
        const orderId = table!.orderId;
        const amountSpent = total;
        fetch("/api/loyalty/earn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: selectedLoyaltyCustomer.id, orderId, amountSpent }),
        }).then(r => r.json()).then(d => {
          if (d.points > 0) toast({ title: `+${d.points} puntos RMS`, description: `Para ${selectedLoyaltyCustomer.name}` });
        }).catch(() => {});

        if (redeemMode && redeemInput) {
          const pts = parseInt(redeemInput);
          if (pts > 0) {
            fetch("/api/loyalty/redeem", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ customerId: selectedLoyaltyCustomer.id, pointsToRedeem: pts, orderId }),
            }).then(r => r.json()).then(d => {
              if (d.discountAmount) toast({ title: `Redención registrada`, description: `₡${Number(d.discountAmount).toLocaleString("es-CR")} descuento` });
            }).catch(() => {});
          }
        }
      }

      setTimeout(() => {
        onSuccess(methodId, clientName, clientEmail, wasCash, wasCash ? received : undefined, wasCash && change > 0 ? change : undefined, responsePaymentId, responsePaidItemIds);
        onClose();
      }, 800);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setProcessing(false);
    }
  }, [table, methodId, method, selectedEmployeeId, splitId, clientName, clientEmail, processing, paymentMethods, selectedLoyaltyCustomer, redeemMode, redeemInput, total, onSuccess, onClose, toast]);

  const handleMultiProcess = useCallback(async () => {
    if (!table || processing || !multiCanPay) return;
    setProcessing(true);

    try {
      const res = await apiRequest("POST", "/api/pos/pay-multi", {
        orderId: table.orderId,
        payments: legs.map(l => ({ paymentMethodId: l.paymentMethodId, amount: l.amount })),
        clientName: clientName || null,
        clientEmail: clientEmail || null,
      });
      const data = await res.json();

      if (dialogRef.current) {
        dialogRef.current.classList.add("pos-flash-green");
      }

      if (selectedLoyaltyCustomer && table) {
        fetch("/api/loyalty/earn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerId: selectedLoyaltyCustomer.id, orderId: table.orderId, amountSpent: total }),
        }).then(r => r.json()).then(d => {
          if (d.points > 0) toast({ title: `+${d.points} puntos RMS`, description: `Para ${selectedLoyaltyCustomer.name}` });
        }).catch(() => {});
      }

      setTimeout(() => {
        onSuccess("multi", clientName, clientEmail, data.hasCash || false);
        onClose();
      }, 800);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setProcessing(false);
    }
  }, [table, processing, multiCanPay, legs, clientName, clientEmail, selectedLoyaltyCustomer, total, onSuccess, onClose, toast]);

  const addLeg = (pmId: string, amount: number) => {
    const pm = activePaymentMethods.find(m => m.id.toString() === pmId);
    if (!pm || amount <= 0) return;
    const type = getMethodType(pm);
    setLegs(prev => [...prev, {
      id: legNextId,
      paymentMethodId: pm.id,
      paymentName: pm.paymentName,
      methodType: type,
      amount,
    }]);
    setLegNextId(prev => prev + 1);
    setLegMethodId("");
    setLegAmount("");
    setLegCashReceived(0);
    setLegCashCustom("");
    setLegCashDenom(null);
  };

  const removeLeg = (id: number) => {
    setLegs(prev => prev.filter(l => l.id !== id));
  };

  const sendTicketMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/pos/send-ticket", {
        orderId: table!.orderId,
        clientName: clientName || null,
        clientEmail,
      });
    },
    onSuccess: () => {
      toast({ title: "Ticket enviado", description: `Ticket registrado para ${clientEmail}` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!open || !table) return null;

  const items = table.items.filter(i => i.status !== "VOIDED" && i.status !== "PAID");

  const getItemUnitPrice = (item: POSItem) => {
    const base = Number(item.productPriceSnapshot);
    const modTotal = (item.modifiers || []).reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
    return base + modTotal;
  };

  const orderNum = table.globalNumber ? `G-${table.globalNumber}` : (table.dailyNumber ? `D-${table.dailyNumber}` : `#${table.orderId}`);
  const subtotal = items.reduce((s, i) => s + getItemUnitPrice(i) * i.qty, 0);

  const selectedLegPm = activePaymentMethods.find(m => m.id.toString() === legMethodId);
  const selectedLegType = selectedLegPm ? getMethodType(selectedLegPm) : null;
  const legAmountNum = parseInt(legAmount) || 0;
  const legMaxAmount = legsRemaining;

  const renderMultiPanel = () => (
    <div className="pos-step-panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="pos-col-header">
        <span className="pos-col-h-tag" style={{ background: "var(--c-amber)" }}>Multi</span>
        <span className="pos-col-h-title">Varios Métodos</span>
      </div>

      {legs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {legs.map(leg => (
            <div key={leg.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", borderRadius: 8, background: "var(--bg2)", border: "1px solid var(--border1)"
            }} data-testid={`multi-leg-${leg.id}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700, color: "#fff", background: getMethodColor(leg.methodType)
                }}>
                  {getMethodIcon(leg.methodType)}
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--fg1)" }}>{leg.paymentName}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 600, color: "var(--fg1)" }}>
                  ₡{leg.amount.toLocaleString()}
                </span>
                <button
                  onClick={() => removeLeg(leg.id)}
                  style={{
                    width: 24, height: 24, borderRadius: "50%", border: "none", cursor: "pointer",
                    background: "rgba(231,76,60,0.15)", color: "#e74c3c", fontSize: 14, fontWeight: 700,
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}
                  data-testid={`multi-leg-remove-${leg.id}`}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 12px", borderRadius: 8,
        background: legsRemaining <= 0 ? "rgba(46,204,113,0.1)" : "rgba(243,156,18,0.1)",
        border: `1px solid ${legsRemaining <= 0 ? "rgba(46,204,113,0.3)" : "rgba(243,156,18,0.3)"}`
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg2)" }}>Saldo restante</span>
        <span style={{
          fontFamily: "var(--f-mono)", fontSize: 16, fontWeight: 700,
          color: legsRemaining <= 0 ? "var(--c-green)" : "var(--c-amber)"
        }} data-testid="multi-remaining">
          ₡{Math.max(0, Math.round(legsRemaining)).toLocaleString()}
        </span>
      </div>

      {legsRemaining > 0 && (
        <>
          <div className="pos-sep" />
          <div className="pos-sect-lbl">Agregar tramo</div>

          <div className="pos-method-grid">
            {activePaymentMethods.map((pm) => {
              const type = getMethodType(pm);
              const isSelected = legMethodId === pm.id.toString();
              const selClass = isSelected ? `sel-${type.toLowerCase()}` : "";
              return (
                <button
                  key={pm.id}
                  className={`pos-method-btn ${selClass}`}
                  onClick={() => {
                    setLegMethodId(pm.id.toString());
                    setLegAmount("");
                    setLegCashReceived(0);
                    setLegCashCustom("");
                    setLegCashDenom(null);
                  }}
                  data-testid={`multi-method-${pm.id}`}
                >
                  <span className="pos-method-ico">{getMethodIcon(type)}</span>
                  <span>{pm.paymentName}</span>
                </button>
              );
            })}
          </div>

          {selectedLegPm && selectedLegType !== "CASH" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="pos-field">
                <div className="pos-field-lbl">Monto</div>
                <input
                  className="pos-field-input mono"
                  type="number"
                  placeholder={`Máx ₡${Math.round(legMaxAmount).toLocaleString()}`}
                  value={legAmount}
                  onChange={(e) => setLegAmount(e.target.value)}
                  data-testid="multi-leg-amount-input"
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[20000, 50000].filter(v => v <= legMaxAmount).map(preset => (
                  <button
                    key={preset}
                    className={`pos-denom-btn ${legAmount === String(preset) ? "active" : ""}`}
                    onClick={() => setLegAmount(String(preset))}
                    style={{ flex: 1, minWidth: 80 }}
                    data-testid={`multi-preset-${preset}`}
                  >
                    ₡{preset.toLocaleString()}
                  </button>
                ))}
                <button
                  className={`pos-denom-btn ${legAmount === String(Math.round(legMaxAmount)) ? "active" : ""}`}
                  onClick={() => setLegAmount(String(Math.round(legMaxAmount)))}
                  style={{ flex: 1, minWidth: 80, fontWeight: 600 }}
                  data-testid="multi-preset-rest"
                >
                  Resto ₡{Math.round(legMaxAmount).toLocaleString()}
                </button>
              </div>
              <button
                className="pos-primary-btn"
                disabled={legAmountNum <= 0 || legAmountNum > legMaxAmount + 1}
                onClick={() => addLeg(legMethodId, legAmountNum)}
                data-testid="multi-add-leg"
                style={{ marginTop: 4 }}
              >
                AGREGAR ₡{legAmountNum.toLocaleString()} — {selectedLegPm.paymentName}
              </button>
            </div>
          )}

          {selectedLegPm && selectedLegType === "CASH" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="pos-field">
                <div className="pos-field-lbl">Monto en efectivo</div>
                <input
                  className="pos-field-input mono"
                  type="number"
                  placeholder={`Máx ₡${Math.round(legMaxAmount).toLocaleString()}`}
                  value={legAmount}
                  onChange={(e) => setLegAmount(e.target.value)}
                  data-testid="multi-leg-cash-amount"
                />
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  className={`pos-denom-btn ${legAmount === String(Math.round(legMaxAmount)) ? "active" : ""}`}
                  onClick={() => setLegAmount(String(Math.round(legMaxAmount)))}
                  style={{ flex: 1, minWidth: 80, fontWeight: 600 }}
                  data-testid="multi-cash-preset-rest"
                >
                  Resto ₡{Math.round(legMaxAmount).toLocaleString()}
                </button>
              </div>

              {legAmountNum > 0 && (
                <>
                  <div className="pos-sep" />
                  <div className="pos-sect-lbl">Recibido del cliente</div>
                  <div className="pos-denom-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
                    <button
                      className={`pos-denom-btn ${legCashDenom === legAmountNum ? "active" : ""}`}
                      onClick={() => { setLegCashReceived(legAmountNum); setLegCashCustom(""); setLegCashDenom(legAmountNum); }}
                      style={{ fontWeight: 600 }}
                      data-testid="multi-cash-denom-exact"
                    >
                      Exacto
                    </button>
                    {getSuggestedDenominations(legAmountNum).slice(0, 5).map(d => (
                      <button
                        key={d}
                        className={`pos-denom-btn ${legCashDenom === d ? "active" : ""}`}
                        onClick={() => { setLegCashReceived(d); setLegCashCustom(""); setLegCashDenom(d); }}
                        data-testid={`multi-cash-denom-${d}`}
                      >
                        ₡{d.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <div className="pos-field">
                    <div className="pos-field-lbl">Otro monto recibido</div>
                    <input
                      className="pos-field-input mono"
                      type="number"
                      placeholder="₡ Monto"
                      value={legCashCustom}
                      onChange={(e) => { setLegCashCustom(e.target.value); setLegCashReceived(parseInt(e.target.value) || 0); setLegCashDenom(null); }}
                      data-testid="multi-cash-custom-input"
                    />
                  </div>

                  <div style={{
                    padding: "8px 12px", borderRadius: 8, background: "var(--bg2)", border: "1px solid var(--border1)",
                    display: "flex", justifyContent: "space-between", alignItems: "center"
                  }}>
                    <span style={{ fontSize: 13, color: "var(--fg2)" }}>Vuelto</span>
                    <span style={{
                      fontFamily: "var(--f-mono)", fontSize: 16, fontWeight: 700,
                      color: legCashReceived >= legAmountNum ? "var(--c-green)" : "var(--fg3)"
                    }} data-testid="multi-cash-change">
                      ₡{Math.max(0, legCashReceived - legAmountNum).toLocaleString()}
                    </span>
                  </div>
                </>
              )}

              <button
                className="pos-primary-btn"
                disabled={legAmountNum <= 0 || legAmountNum > legMaxAmount + 1 || legCashReceived < legAmountNum}
                onClick={() => addLeg(legMethodId, legAmountNum)}
                data-testid="multi-add-cash-leg"
                style={{ marginTop: 4 }}
              >
                AGREGAR ₡{legAmountNum.toLocaleString()} — {selectedLegPm.paymentName}
              </button>
            </div>
          )}
        </>
      )}

      {multiCanPay && (
        <button
          className="pos-primary-btn"
          onClick={handleMultiProcess}
          disabled={processing}
          data-testid="multi-process-btn"
          style={{ marginTop: 8 }}
        >
          {processing ? "Procesando..." : `PROCESAR PAGO — ₡${total.toLocaleString()}`}
        </button>
      )}

      <button
        className="pos-secondary-btn"
        onClick={() => { setMultiMode(false); setLegs([]); setLegMethodId(""); setLegAmount(""); }}
        data-testid="multi-back-single"
        style={{ marginTop: 4 }}
      >
        Volver a pago único
      </button>
    </div>
  );

  return (
    <div
      className={`pos-overlay ${open ? "open" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="pay-dialog-overlay"
    >
      <div className="pos-dialog pos-dialog-pay" ref={dialogRef} data-testid="pay-dialog">
        <div className="pos-drag-handle" />

        <div className="pos-dlg-header">
          <span className="pos-dlg-tag">{multiMode ? "Pago Mixto" : "Pago"}</span>
          <span className="pos-dlg-title" data-testid="pay-dialog-title">
            {table.tableName}
            {splitLabel && <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 8, opacity: 0.6 }}>({splitLabel})</span>}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 600, color: "var(--c-green)" }} data-testid="pay-dialog-total">
              ₡{total.toLocaleString()}
            </span>
            <button className="pos-dlg-close" onClick={onClose} data-testid="button-close-pay-dialog">✕</button>
          </div>
        </div>

        {!multiMode && (
          <div className="pos-step-nav" data-testid="pay-step-nav">
            {["Orden", "Método", "Efectivo"].map((label, i) => {
              const n = i + 1;
              const cls = n === step ? "active" : n < step ? "done" : "";
              return (
                <button key={n} className={`pos-step-tab ${cls}`} onClick={() => setStep(n)} data-testid={`pay-step-tab-${n}`}>
                  <span className="pos-step-num">{n < step ? "✓" : n}</span>
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {multiMode ? (
          <div style={{ padding: "0 16px 16px", overflowY: "auto", flex: 1 }}>
            {renderMultiPanel()}
          </div>
        ) : (
          <div className={`pos-step-panels slide-${step}`} data-testid="pay-panels">

            <div className="pos-step-panel">
              <div className="pos-col-header">
                <span className="pos-col-h-tag">Orden</span>
                <span className="pos-col-h-title">Resumen</span>
              </div>

              <div className="pos-order-title-row">
                <div>
                  <div className="pos-order-big-title">{table.tableName}</div>
                  <div className="pos-order-meta">{items.length} items · {orderNum}</div>
                </div>
                <div className="pos-chip pos-chip-green">ABIERTA</div>
              </div>

              <div className="pos-item-list" data-testid="pay-items-list">
                {items.map((item) => (
                  <div key={item.id} className="pos-item-row">
                    <span className="pos-item-qty">×{item.qty}</span>
                    <div>
                      <div className="pos-item-name">{item.productNameSnapshot}</div>
                      {item.customerNameSnapshot && <div className="pos-item-sub">{item.customerNameSnapshot}</div>}
                      {item.modifiers && item.modifiers.length > 0 && (
                        <div className="pos-item-sub">{item.modifiers.map(m => m.nameSnapshot).join(", ")}</div>
                      )}
                    </div>
                    <span className="pos-item-price">₡{(getItemUnitPrice(item) * item.qty).toLocaleString()}</span>
                  </div>
                ))}
              </div>

              <div className="pos-sep" />

              <div className="pos-totals-box">
                <div className="pos-totals-row">
                  <span className="pos-totals-label">Subtotal</span>
                  <span className="pos-totals-value">₡{subtotal.toLocaleString()}</span>
                </div>
                {table.taxBreakdown && table.taxBreakdown.length > 0 && table.taxBreakdown.map((tb, idx) => (
                  <div key={idx} className="pos-totals-row">
                    <span className="pos-totals-label">{tb.taxName}{tb.inclusive ? " (ii)" : ""}</span>
                    <span className="pos-totals-value">{tb.inclusive ? "" : "+"}₡{Number(tb.totalAmount).toLocaleString()}</span>
                  </div>
                ))}
                {Number(table.totalDiscounts || 0) > 0 && (
                  <div className="pos-totals-row">
                    <span className="pos-totals-label">Descuentos</span>
                    <span className="pos-totals-value pos-totals-discount">−₡{Number(table.totalDiscounts).toLocaleString()}</span>
                  </div>
                )}
                <div className="pos-sep" />
                <div className="pos-totals-row pos-totals-grand">
                  <span className="pos-totals-label">TOTAL</span>
                  <span className="pos-totals-value">₡{total.toLocaleString()}</span>
                </div>
              </div>

              <div className="pos-mobile-only">
                <button className="pos-primary-btn" onClick={() => setStep(2)} data-testid="pay-mobile-continue-1">
                  CONTINUAR →
                </button>
              </div>
              <div className="pos-desktop-only" />
            </div>

            <div className="pos-step-panel">
              <div className="pos-col-header">
                <span className="pos-col-h-tag">Pago</span>
                <span className="pos-col-h-title">Método & Cliente</span>
              </div>

              {canEditCustomer && (
                <>
                  <div className="pos-field">
                    <div className="pos-field-lbl">Cliente (opcional)</div>
                    <input
                      className="pos-field-input"
                      placeholder="Nombre"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      data-testid="pay-input-client-name"
                    />
                  </div>
                  <div className="pos-field">
                    <div className="pos-field-lbl">Email (opcional)</div>
                    <input
                      className="pos-field-input"
                      type="email"
                      placeholder="correo@ejemplo.com"
                      value={clientEmail}
                      onChange={(e) => setClientEmail(e.target.value)}
                      data-testid="pay-input-client-email"
                    />
                  </div>
                </>
              )}

              {canEmailTicket && clientEmail && (
                <button
                  className="pos-secondary-btn"
                  onClick={() => sendTicketMutation.mutate()}
                  disabled={!clientEmail || sendTicketMutation.isPending}
                  data-testid="pay-button-send-ticket"
                >
                  {sendTicketMutation.isPending ? "Enviando..." : "Enviar Ticket por Email"}
                </button>
              )}

              <div className="pos-sep" />

              <div className="pos-sect-lbl">Loyalty RMS (opcional)</div>
              {selectedLoyaltyCustomer ? (
                <div className="loyalty-customer-card" data-testid="loyalty-selected-customer">
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedLoyaltyCustomer.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{selectedLoyaltyCustomer.email}</div>
                      <div style={{ fontSize: 12, marginTop: 2 }}>
                        <span style={{ color: "var(--c-amber, #f59e0b)", fontWeight: 600 }}>
                          {Math.floor(Number(selectedLoyaltyCustomer.points_balance || 0)).toLocaleString()} pts
                        </span>
                        {" "}disponibles
                      </div>
                    </div>
                    <button
                      className="pos-secondary-btn"
                      style={{ padding: "4px 10px", fontSize: 12 }}
                      onClick={() => { setSelectedLoyaltyCustomer(null); setRedeemMode(false); setRedeemInput(""); }}
                      data-testid="loyalty-clear-customer"
                    >
                      Cambiar
                    </button>
                  </div>
                  {Number(selectedLoyaltyCustomer.points_balance || 0) >= 1 && (
                    <div style={{ marginTop: 10, borderTop: "1px solid var(--b-default)", paddingTop: 8 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={redeemMode}
                          onChange={e => { setRedeemMode(e.target.checked); if (!e.target.checked) setRedeemInput(""); }}
                          data-testid="loyalty-redeem-toggle"
                        />
                        Redimir puntos en este pago
                      </label>
                      {redeemMode && (
                        <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            className="pos-field-input"
                            type="number"
                            min="1"
                            max={Math.floor(Number(selectedLoyaltyCustomer.points_balance || 0))}
                            placeholder="Puntos a redimir"
                            value={redeemInput}
                            onChange={e => setRedeemInput(e.target.value)}
                            style={{ flex: 1 }}
                            data-testid="loyalty-redeem-input"
                          />
                          <button
                            className="pos-secondary-btn"
                            style={{ padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                            onClick={() => setRedeemInput(String(Math.floor(Number(selectedLoyaltyCustomer.points_balance || 0))))}
                            data-testid="loyalty-redeem-max"
                          >
                            Máx
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <input
                    className="pos-field-input"
                    placeholder="Buscar cliente por nombre o email..."
                    value={loyaltyQuery}
                    onChange={e => { setLoyaltyQuery(e.target.value); setSelectedLoyaltyCustomer(null); }}
                    autoComplete="off"
                    data-testid="loyalty-search-input"
                  />
                  {loyaltySearching && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 2px" }}>Buscando...</div>
                  )}
                  {loyaltyResults.length > 0 && (
                    <div className="loyalty-results-dropdown" data-testid="loyalty-results">
                      {loyaltyResults.map((c: any) => (
                        <div
                          key={c.id}
                          className="loyalty-result-item"
                          onClick={() => { setSelectedLoyaltyCustomer(c); setLoyaltyQuery(""); setLoyaltyResults([]); }}
                          data-testid={`loyalty-result-${c.id}`}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                            {c.email} · {Math.floor(Number(c.points_balance || 0)).toLocaleString()} pts
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {loyaltyQuery.length >= 2 && !loyaltySearching && loyaltyResults.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "4px 2px" }}>Sin resultados</div>
                  )}
                </div>
              )}

              <div className="pos-sep" />

              <div className="pos-sect-lbl">Método de pago</div>
              <div className="pos-method-grid">
                {activePaymentMethods.map((pm) => {
                  const type = getMethodType(pm);
                  const isSelected = methodId === pm.id.toString();
                  const selClass = isSelected ? `sel-${type.toLowerCase()}` : "";
                  return (
                    <button
                      key={pm.id}
                      className={`pos-method-btn ${selClass}`}
                      onClick={() => selectMethod(pm)}
                      data-testid={`pay-method-${pm.id}`}
                    >
                      <span className="pos-method-ico">{getMethodIcon(type)}</span>
                      <span>{pm.paymentName}</span>
                    </button>
                  );
                })}
                {activePaymentMethods.length >= 2 && !splitId && (
                  <button
                    className="pos-method-btn"
                    onClick={() => {
                      setMultiMode(true);
                      setMethod(null);
                      setMethodId("");
                    }}
                    style={{ borderStyle: "dashed" }}
                    data-testid="pay-method-multi"
                  >
                    <span className="pos-method-ico" style={{ fontSize: 16 }}>⊞</span>
                    <span>Varios</span>
                  </button>
                )}
              </div>

              {method && method !== "CASH" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="pos-pay-summary">
                    <div className="pos-pay-summary-label">Total a cobrar</div>
                    <div className="pos-pay-summary-amount" data-testid="pay-instant-amount">₡{total.toLocaleString()}</div>
                  </div>

                  {method === "EMPLOYEE_CHARGE" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div className="pos-sect-lbl">Seleccionar empleado</div>
                      <select
                        className="pos-input"
                        value={selectedEmployeeId}
                        onChange={e => setSelectedEmployeeId(e.target.value)}
                        data-testid="pay-employee-select"
                        style={{ padding: "8px 10px", borderRadius: 8, fontSize: 15, border: "1px solid var(--b-default)", background: "var(--bg-card)", color: "inherit" }}
                      >
                        <option value="">— Elige un empleado —</option>
                        {employeeList.map(emp => (
                          <option key={emp.id} value={String(emp.id)}>{emp.displayName}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="pos-desktop-only">
                    <button
                      className="pos-primary-btn"
                      onClick={handleProcess}
                      disabled={processing || !canPay}
                      data-testid="pay-process-card-desktop"
                    >
                      {processing ? "Procesando..." : `PROCESAR PAGO — ₡${total.toLocaleString()}`}
                    </button>
                  </div>
                  <div className="pos-mobile-only">
                    <button
                      className="pos-primary-btn"
                      onClick={handleProcess}
                      disabled={processing || !canPay}
                      data-testid="pay-process-card-mobile"
                    >
                      {processing ? "Procesando..." : `PROCESAR PAGO — ₡${total.toLocaleString()}`}
                    </button>
                  </div>
                </div>
              )}

              {method === "CASH" && (
                <div className="pos-desktop-only">
                  <div className="pos-info-box">
                    <span style={{ fontFamily: "var(--f-mono)", fontWeight: 600 }}>$</span>
                    <span>Selecciona denominación en el panel de efectivo →</span>
                  </div>
                </div>
              )}

              {method === "CASH" && (
                <div className="pos-mobile-only">
                  <button className="pos-primary-btn" onClick={() => setStep(3)} data-testid="pay-mobile-go-cash">
                    VER EFECTIVO →
                  </button>
                </div>
              )}

              {!method && (
                <div className="pos-mobile-only" style={{ marginTop: "auto" }}>
                  <button className="pos-secondary-btn" onClick={() => setStep(1)} data-testid="pay-mobile-back-1">
                    ‹ Atrás
                  </button>
                </div>
              )}
            </div>

            <div className={`pos-step-panel ${method === "CASH" ? "pos-cash-panel-active" : "pos-cash-panel-inactive"}`}>
              <div className="pos-col-header">
                <span className="pos-col-h-tag">Efectivo</span>
                <span className="pos-col-h-title">Denominaciones</span>
              </div>

              <div className="pos-sect-lbl">Monto recibido</div>
              <div className="pos-denom-grid">
                <button
                  className={`pos-denom-btn ${activeDenom === total ? "active" : ""}`}
                  onClick={() => setDenom(total)}
                  data-testid="pay-denom-exact"
                  style={{ background: activeDenom === total ? undefined : 'var(--bg3)', fontWeight: 600 }}
                >
                  Exacto ₡{total.toLocaleString()}
                </button>
                {getSuggestedDenominations(total).map((d) => (
                  <button
                    key={d}
                    className={`pos-denom-btn ${activeDenom === d ? "active" : ""}`}
                    onClick={() => setDenom(d)}
                    data-testid={`pay-denom-${d}`}
                  >
                    ₡{d.toLocaleString()}
                  </button>
                ))}
              </div>

              <div className="pos-field">
                <div className="pos-field-lbl">Otro monto</div>
                <input
                  className="pos-field-input mono"
                  type="number"
                  placeholder="₡ Monto"
                  value={customInput}
                  onChange={(e) => setCustom(e.target.value)}
                  data-testid="pay-input-custom-cash"
                />
              </div>

              <div className="pos-change-card">
                <div className="pos-change-row">
                  <span className="pos-change-label">Total</span>
                  <span className="pos-change-value">₡{total.toLocaleString()}</span>
                </div>
                <div className="pos-change-row">
                  <span className="pos-change-label">Recibido</span>
                  <span className="pos-change-value" data-testid="pay-received-display">₡{received.toLocaleString()}</span>
                </div>
                <div className="pos-sep" />
                <div className="pos-change-row pos-change-big">
                  <span className="pos-change-label">Vuelto</span>
                  <span
                    className={`pos-change-value ${change >= 0 && received > 0 ? "pos-change-positive" : "pos-change-zero"}`}
                    data-testid="pay-change-display"
                  >
                    ₡{(change >= 0 ? change : 0).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="pos-desktop-only">
                <button
                  className="pos-primary-btn"
                  onClick={handleProcess}
                  disabled={!canPay || processing}
                  data-testid="pay-cash-btn-desktop"
                >
                  {processing ? "Procesando..." : `COBRAR — ₡${total.toLocaleString()}`}
                </button>
              </div>

              <div className="pos-mobile-only">
                <button
                  className="pos-primary-btn"
                  onClick={handleProcess}
                  disabled={!canPay || processing}
                  data-testid="pay-cash-btn-mobile"
                >
                  {processing ? "Procesando..." : `COBRAR — ₡${total.toLocaleString()}`}
                </button>
                <button className="pos-secondary-btn" onClick={() => setStep(2)} data-testid="pay-mobile-back-2">
                  ‹ Atrás
                </button>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
