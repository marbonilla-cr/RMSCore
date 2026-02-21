import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
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
  onSuccess: (paymentMethodId: string, clientName: string, clientEmail: string, wasCash: boolean) => void;
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
  canEditCustomer, canEmailTicket, canPrint, onSuccess
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

  const total = splitId ? (splitTotal || 0) : Number(table?.totalAmount || 0);
  const change = received - total;
  const canPay = method === "CASH" ? change >= 0 && received > 0 : !!method;

  const activePaymentMethods = paymentMethods.filter((m) => m.active);

  useEffect(() => {
    if (open) {
      setStep(1);
      setMethod(null);
      setMethodId("");
      setReceived(0);
      setCustomInput("");
      setClientName("");
      setClientEmail("");
      setProcessing(false);
      setActiveDenom(null);
    }
  }, [open]);

  const getMethodType = (pm: PaymentMethod): string => {
    const code = pm.paymentCode.toUpperCase();
    if (code.includes("CASH") || code.includes("EFECT")) return "CASH";
    if (code.includes("CARD") || code.includes("TARJ")) return "CARD";
    return "SINPE";
  };

  const getMethodIcon = (type: string) => {
    if (type === "CASH") return "$";
    if (type === "CARD") return "C";
    return "S";
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
      if (splitId) {
        await apiRequest("POST", "/api/pos/pay-split", {
          splitId,
          paymentMethodId: parseInt(methodId),
          clientName: clientName || null,
          clientEmail: clientEmail || null,
        });
      } else {
        await apiRequest("POST", "/api/pos/pay", {
          orderId: table.orderId,
          paymentMethodId: parseInt(methodId),
          amount: table.totalAmount,
          clientName: clientName || null,
          clientEmail: clientEmail || null,
        });
      }

      if (dialogRef.current) {
        dialogRef.current.classList.add("pos-flash-green");
      }

      const pm = paymentMethods.find(m => m.id.toString() === methodId);
      const wasCash = pm ? (pm.paymentCode.toUpperCase().includes("CASH") || pm.paymentCode.toUpperCase().includes("EFECT")) : false;

      setTimeout(() => {
        onSuccess(methodId, clientName, clientEmail, wasCash);
        onClose();
      }, 800);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setProcessing(false);
    }
  }, [table, methodId, splitId, clientName, clientEmail, processing, paymentMethods, onSuccess, onClose, toast]);

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

  return (
    <div
      className={`pos-overlay ${open ? "open" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="pay-dialog-overlay"
    >
      <div className="pos-dialog pos-dialog-pay" ref={dialogRef} data-testid="pay-dialog">
        <div className="pos-drag-handle" />

        {/* HEADER */}
        <div className="pos-dlg-header">
          <span className="pos-dlg-tag">Pago</span>
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

        {/* STEP TABS (mobile) */}
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

        {/* PANELS */}
        <div className={`pos-step-panels slide-${step}`} data-testid="pay-panels">

          {/* ── PANEL 1: Order Summary ── */}
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

          {/* ── PANEL 2: Method & Client ── */}
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
            </div>

            {/* Card/SINPE instant pay */}
            {method && method !== "CASH" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="pos-pay-summary">
                  <div className="pos-pay-summary-label">Total a cobrar</div>
                  <div className="pos-pay-summary-amount" data-testid="pay-instant-amount">₡{total.toLocaleString()}</div>
                </div>
                <div className="pos-desktop-only">
                  <button
                    className="pos-primary-btn"
                    onClick={handleProcess}
                    disabled={processing}
                    data-testid="pay-process-card-desktop"
                  >
                    {processing ? "Procesando..." : `PROCESAR PAGO — ₡${total.toLocaleString()}`}
                  </button>
                </div>
                <div className="pos-mobile-only">
                  <button
                    className="pos-primary-btn"
                    onClick={handleProcess}
                    disabled={processing}
                    data-testid="pay-process-card-mobile"
                  >
                    {processing ? "Procesando..." : `PROCESAR PAGO — ₡${total.toLocaleString()}`}
                  </button>
                </div>
              </div>
            )}

            {/* Cash hint (desktop) */}
            {method === "CASH" && (
              <div className="pos-desktop-only">
                <div className="pos-info-box">
                  <span style={{ fontFamily: "var(--f-mono)", fontWeight: 600 }}>$</span>
                  <span>Selecciona denominación en el panel de efectivo →</span>
                </div>
              </div>
            )}

            {/* Mobile: go to cash or show back */}
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

          {/* ── PANEL 3: Cash / Denominations ── */}
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
      </div>
    </div>
  );
}
