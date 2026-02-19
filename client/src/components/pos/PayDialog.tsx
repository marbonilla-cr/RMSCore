import { useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, X, Banknote, CreditCard, Wallet, ChevronLeft, ArrowRight } from "lucide-react";
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

const DENOMINATIONS = [1000, 2000, 5000, 10000, 20000, 50000];

export function PayDialog({
  open, onClose, table, paymentMethods, splitId, splitLabel, splitTotal,
  canEditCustomer, canEmailTicket, canPrint, onSuccess
}: PayDialogProps) {
  const { toast } = useToast();
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
    if (type === "CASH") return <Banknote className="w-5 h-5" />;
    if (type === "CARD") return <CreditCard className="w-5 h-5" />;
    return <Wallet className="w-5 h-5" />;
  };

  const selectMethod = (pm: PaymentMethod) => {
    const type = getMethodType(pm);
    setMethod(type);
    setMethodId(pm.id.toString());
    setReceived(0);
    setCustomInput("");
    setActiveDenom(null);
    if (type === "CASH" && isMobile()) {
      // stay on step 2, user can navigate to step 3
    }
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

  const isMobile = () => typeof window !== "undefined" && window.innerWidth < 640;

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

      const pm = paymentMethods.find(m => m.id.toString() === methodId);
      const wasCash = pm ? (pm.paymentCode.toUpperCase().includes("CASH") || pm.paymentCode.toUpperCase().includes("EFECT")) : false;

      onSuccess(methodId, clientName, clientEmail, wasCash);
      onClose();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
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

  return (
    <div className={`pos-overlay ${open ? "open" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="pay-dialog-overlay">
      <div className={`pos-dialog pos-dialog-pay`} data-testid="pay-dialog">
        <div className="pos-drag-handle" />

        {/* HEADER */}
        <div className="pos-dlg-header">
          <span className="pos-dlg-tag">Pago</span>
          <span className="pos-dlg-title" data-testid="pay-dialog-title">
            {table.tableName}
            {splitLabel && <span className="text-sm font-normal ml-2 opacity-60">({splitLabel})</span>}
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold" style={{ color: "hsl(142 76% 36%)" }} data-testid="pay-dialog-total">
              ₡{total.toLocaleString()}
            </span>
            <button className="pos-dlg-close" onClick={onClose} data-testid="button-close-pay-dialog">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* STEP NAV (mobile only) */}
        <div className="pos-step-nav" data-testid="pay-step-nav">
          {["Orden", "Método", "Efectivo"].map((label, i) => {
            const n = i + 1;
            const cls = n === step ? "active" : n < step ? "done" : "";
            return (
              <button
                key={n}
                className={`pos-step-tab ${cls}`}
                onClick={() => setStep(n)}
                data-testid={`pay-step-tab-${n}`}
              >
                <span className="pos-step-num">{n < step ? "✓" : n}</span>
                {label}
              </button>
            );
          })}
        </div>

        {/* PANELS */}
        <div className={`pos-step-panels slide-${step}`} data-testid="pay-panels">

          {/* PANEL 1: Order Summary */}
          <div className="pos-step-panel">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Orden</span>
              <span className="pos-col-h-title">Resumen</span>
            </div>

            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{orderNum}</div>
                <div className="text-2xl font-extrabold">{table.tableName}</div>
              </div>
              <span className="font-mono text-xl font-semibold" style={{ color: "hsl(142 76% 36%)" }} data-testid="pay-panel1-total">
                ₡{total.toLocaleString()}
              </span>
            </div>

            <div className="flex flex-col gap-1.5" data-testid="pay-items-list">
              {items.map((item) => (
                <div key={item.id} className="pos-item-row">
                  <span className="pos-item-qty">×{item.qty}</span>
                  <div>
                    <div className="pos-item-name">{item.productNameSnapshot}</div>
                    {item.customerNameSnapshot && <div className="pos-item-sub">{item.customerNameSnapshot}</div>}
                    {item.modifiers && item.modifiers.length > 0 && (
                      <div className="pos-item-sub">
                        {item.modifiers.map(m => m.nameSnapshot).join(", ")}
                      </div>
                    )}
                  </div>
                  <span className="pos-item-price">₡{(getItemUnitPrice(item) * item.qty).toLocaleString()}</span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="pos-totals-box">
              <div className="pos-totals-row">
                <span className="pos-totals-label">Subtotal</span>
                <span className="pos-totals-value">₡{items.reduce((s, i) => s + getItemUnitPrice(i) * i.qty, 0).toLocaleString()}</span>
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
                  <span className="pos-totals-value" style={{ color: "hsl(142 76% 36%)" }}>-₡{Number(table.totalDiscounts).toLocaleString()}</span>
                </div>
              )}
              <div className="pos-sep" />
              <div className="pos-totals-row pos-totals-grand">
                <span className="pos-totals-label">Total</span>
                <span className="pos-totals-value">₡{total.toLocaleString()}</span>
              </div>
            </div>

            {/* Mobile: Continue button */}
            <div className="pos-mobile-only" style={{ marginTop: "auto" }}>
              <Button className="w-full" onClick={() => setStep(2)} data-testid="pay-mobile-continue-1">
                Continuar <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>

          {/* PANEL 2: Method & Client */}
          <div className="pos-step-panel">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Pago</span>
              <span className="pos-col-h-title">Método & Cliente</span>
            </div>

            {canEditCustomer && (
              <>
                <div className="flex flex-col gap-1">
                  <span className="pos-sect-lbl">Cliente (opcional)</span>
                  <Input
                    placeholder="Nombre"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    data-testid="pay-input-client-name"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="pos-sect-lbl">Email (opcional)</span>
                  <Input
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
              <Button
                variant="outline"
                className="w-full"
                onClick={() => sendTicketMutation.mutate()}
                disabled={!clientEmail || sendTicketMutation.isPending}
                data-testid="pay-button-send-ticket"
              >
                {sendTicketMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Enviar Ticket por Email
              </Button>
            )}

            <div className="pos-sep" />

            <span className="pos-sect-lbl">Método de pago</span>
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
                    {getMethodIcon(type)}
                    <span className="text-xs">{pm.paymentName}</span>
                  </button>
                );
              })}
            </div>

            {/* Card/SINPE instant pay */}
            {method && method !== "CASH" && (
              <div className="flex flex-col gap-3">
                <div className="pos-pay-summary">
                  <div className="pos-pay-summary-label">Total a cobrar</div>
                  <div className="pos-pay-summary-amount" data-testid="pay-instant-amount">₡{total.toLocaleString()}</div>
                </div>
                <div className="pos-desktop-only">
                  <Button
                    className="w-full"
                    onClick={handleProcess}
                    disabled={processing}
                    data-testid="pay-process-card-desktop"
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    PROCESAR PAGO — ₡{total.toLocaleString()}
                  </Button>
                </div>
                <div className="pos-mobile-only">
                  <Button
                    className="w-full"
                    onClick={handleProcess}
                    disabled={processing}
                    data-testid="pay-process-card-mobile"
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    PROCESAR PAGO — ₡{total.toLocaleString()}
                  </Button>
                </div>
              </div>
            )}

            {/* Cash hint (desktop) */}
            {method === "CASH" && (
              <>
                <div className="pos-desktop-only">
                  <div className="pos-info-box">
                    <Banknote className="w-4 h-4 flex-shrink-0" />
                    <span>Selecciona denominación en el panel de efectivo</span>
                  </div>
                </div>
                <div className="pos-mobile-only">
                  <Button className="w-full" onClick={() => setStep(3)} data-testid="pay-mobile-go-cash">
                    VER EFECTIVO <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </>
            )}

            {/* Mobile: back */}
            <div className="pos-mobile-only" style={{ marginTop: "auto" }}>
              <Button variant="outline" onClick={() => setStep(1)} data-testid="pay-mobile-back-1">
                <ChevronLeft className="w-4 h-4 mr-1" /> Atrás
              </Button>
            </div>
          </div>

          {/* PANEL 3: Cash / Denominations */}
          <div className={`pos-step-panel ${method === "CASH" ? "pos-cash-panel-active" : "pos-cash-panel-inactive"}`}>
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Efectivo</span>
              <span className="pos-col-h-title">Denominaciones</span>
            </div>

            <span className="pos-sect-lbl">Monto recibido</span>
            <div className="pos-denom-grid">
              {DENOMINATIONS.map((d) => (
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

            <div className="flex flex-col gap-1">
              <span className="pos-sect-lbl">Otro monto</span>
              <Input
                type="number"
                placeholder="₡ Monto exacto"
                value={customInput}
                onChange={(e) => setCustom(e.target.value)}
                className="font-mono"
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
                <span className={`pos-change-value ${change >= 0 && received > 0 ? "pos-change-positive" : "pos-change-zero"}`} data-testid="pay-change-display">
                  ₡{(change >= 0 ? change : 0).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Desktop pay button */}
            <div className="pos-desktop-only">
              <Button
                className="w-full"
                onClick={handleProcess}
                disabled={!canPay || processing}
                data-testid="pay-cash-btn-desktop"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                COBRAR — ₡{total.toLocaleString()}
              </Button>
            </div>

            {/* Mobile pay button */}
            <div className="pos-mobile-only" style={{ marginTop: "auto" }}>
              <Button
                className="w-full"
                onClick={handleProcess}
                disabled={!canPay || processing}
                data-testid="pay-cash-btn-mobile"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                COBRAR — ₡{total.toLocaleString()}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setStep(2)} data-testid="pay-mobile-back-2">
                <ChevronLeft className="w-4 h-4 mr-1" /> Atrás
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
