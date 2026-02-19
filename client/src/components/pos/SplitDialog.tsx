import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Loader2, X, ArrowRight, ChevronLeft, Plus, ArrowLeft } from "lucide-react";
import "./pos-dialogs.css";

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
  totalAmount: string;
  itemCount: number;
  items: POSItem[];
  globalNumber?: number | null;
  dailyNumber?: number | null;
}

interface SplitAccountData {
  id: number;
  orderId: number;
  label: string;
  items: { id: number; splitId: number; orderItemId: number }[];
}

interface SplitDialogProps {
  open: boolean;
  onClose: () => void;
  table: POSTable | null;
  onPaySplit: (splitId: number, splitLabel: string, splitTotal: number) => void;
  onPayAll: () => void;
  onSeparated: (childOrderIds: number[]) => void;
}

export function SplitDialog({ open, onClose, table, onPaySplit, onPayAll, onSeparated }: SplitDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [activeSub, setActiveSub] = useState<number | null>(null);
  const [vibrating, setVibrating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const orderId = table?.orderId;

  const { data: splits = [], isLoading: splitsLoading } = useQuery<SplitAccountData[]>({
    queryKey: ["/api/pos/orders", orderId, "splits"],
    enabled: !!orderId && open,
  });

  useEffect(() => {
    if (open) {
      setStep(1);
      setActiveSub(null);
    }
  }, [open]);

  useEffect(() => {
    if (splits.length > 0 && activeSub === null) {
      setActiveSub(splits[0].id);
    }
  }, [splits, activeSub]);

  const getItemUnitPrice = (item: POSItem) => {
    const base = Number(item.productPriceSnapshot);
    const modTotal = (item.modifiers || []).reduce((s, m) => s + Number(m.priceDeltaSnapshot) * m.qty, 0);
    return base + modTotal;
  };

  const assignedItemIds = splits.flatMap(s => s.items.map(si => si.orderItemId));

  const unassignedItems = table?.items.filter(
    i => !assignedItemIds.includes(i.id) && i.status !== "PAID" && i.status !== "VOIDED"
  ) || [];

  const getSplitTotal = (split: SplitAccountData) => {
    if (!table) return 0;
    return split.items.reduce((sum, si) => {
      const oi = table.items.find(i => i.id === si.orderItemId);
      return sum + (oi ? getItemUnitPrice(oi) * oi.qty : 0);
    }, 0);
  };

  const createSplitMutation = useMutation({
    mutationFn: async () => {
      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const idx = splits.length;
      const label = `Subcuenta ${letters[idx % letters.length]}`;
      return apiRequest("POST", `/api/pos/orders/${orderId}/splits`, { label, orderItemIds: [] });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", orderId, "splits"] });
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
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", orderId, "splits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const splitOrderMutation = useMutation({
    mutationFn: async () => {
      if (!table) throw new Error("No hay orden seleccionada");
      return apiRequest("POST", "/api/pos/split-order", { orderId: table.orderId });
    },
    onSuccess: async (res: any) => {
      const data = await res.json();
      setVibrating(true);
      setTimeout(() => setVibrating(false), 500);

      queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });

      const childIds = data.childOrderIds || [];
      setTimeout(() => {
        onSeparated(childIds);
        onClose();
      }, 800);

      toast({ title: "Cuenta separada en tiquetes independientes" });
    },
    onError: (err: any) => {
      toast({ title: "Error al separar", description: err.message, variant: "destructive" });
    },
  });

  const deleteSplitMutation = useMutation({
    mutationFn: async (splitId: number) => {
      return apiRequest("DELETE", `/api/pos/splits/${splitId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/orders", orderId, "splits"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!open || !table) return null;

  const activeSplit = splits.find(s => s.id === activeSub);
  const activeSplitTotal = activeSplit ? getSplitTotal(activeSplit) : 0;
  const remainingTotal = unassignedItems.reduce((s, i) => s + getItemUnitPrice(i) * i.qty, 0);
  const hasSplitsWithItems = splits.some(s => s.items.length > 0);

  return (
    <div className={`pos-overlay ${open ? "open" : ""}`} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="split-dialog-overlay">
      <div className={`pos-dialog pos-dialog-split ${vibrating ? "pos-vibrating" : ""}`} data-testid="split-dialog">
        <div className="pos-drag-handle" />

        {/* HEADER */}
        <div className="pos-dlg-header">
          <span className="pos-dlg-tag">División</span>
          <span className="pos-dlg-title" data-testid="split-dialog-title">{table.tableName}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono px-2 py-0.5 rounded-full border" style={{ borderColor: "hsl(217 91% 60% / 0.3)", color: "hsl(217 91% 60%)", background: "hsl(217 91% 60% / 0.1)" }} data-testid="split-remaining-chip">
              {unassignedItems.length} sin asignar
            </span>
            <button className="pos-dlg-close" onClick={onClose} data-testid="button-close-split-dialog">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* STEP NAV (mobile) */}
        <div className="pos-step-nav" data-testid="split-step-nav">
          {["Items", "Subcuenta", "Resumen"].map((label, i) => {
            const n = i + 1;
            const cls = n === step ? "active" : n < step ? "done" : "";
            return (
              <button key={n} className={`pos-step-tab ${cls}`} onClick={() => setStep(n)} data-testid={`split-step-tab-${n}`}>
                <span className="pos-step-num">{n < step ? "✓" : n}</span>
                {label}
              </button>
            );
          })}
        </div>

        {/* PANELS */}
        <div className={`pos-step-panels slide-${step}`} ref={panelRef} data-testid="split-panels">

          {/* PANEL 1: Main Items */}
          <div className="pos-step-panel">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Principal</span>
              <span className="pos-col-h-title">Items disponibles</span>
            </div>

            <span className="pos-sect-lbl">Toca → para mover a subcuenta activa</span>

            <div className="flex flex-col gap-1.5" data-testid="split-main-items">
              {table.items.filter(i => i.status !== "VOIDED" && i.status !== "PAID").map((item) => {
                const isMoved = assignedItemIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={`pos-split-item ${isMoved ? "moved" : ""}`}
                    data-testid={`split-item-${item.id}`}
                  >
                    <div className="pos-si-check">{isMoved ? "✓" : ""}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="text-sm truncate" style={{ color: "hsl(var(--foreground))" }}>{item.productNameSnapshot}</div>
                      {item.customerNameSnapshot && <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{item.customerNameSnapshot}</div>}
                      <div className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>×{item.qty}</div>
                    </div>
                    <span className="font-mono text-xs" style={{ color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                      ₡{(getItemUnitPrice(item) * item.qty).toLocaleString()}
                    </span>
                    <button
                      className="pos-si-move-btn"
                      onClick={() => {
                        if (!isMoved && activeSub) {
                          moveItemMutation.mutate({ orderItemId: item.id, fromSplitId: null, toSplitId: activeSub });
                        }
                      }}
                      disabled={isMoved || !activeSub || moveItemMutation.isPending}
                      data-testid={`split-move-item-${item.id}`}
                    >
                      →
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="pos-desktop-only">
              <div className="text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                {unassignedItems.length} items sin asignar
              </div>
            </div>

            <div className="pos-mobile-only" style={{ marginTop: "auto" }}>
              <Button className="w-full" onClick={() => setStep(2)} data-testid="split-mobile-continue-1">
                VER SUBCUENTA <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>

          {/* PANEL 2: Active Subcuenta */}
          <div className="pos-step-panel">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Subcuenta</span>
              <span className="pos-col-h-title" data-testid="split-active-title">{activeSplit?.label || "—"}</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => createSplitMutation.mutate()}
                disabled={createSplitMutation.isPending}
                data-testid="split-add-sub-desktop"
              >
                <Plus className="w-3 h-3 mr-1" /> Nueva
              </Button>
            </div>

            {/* Sub tabs */}
            <div className="pos-sub-tabs" data-testid="split-sub-tabs">
              {splits.map(s => (
                <button
                  key={s.id}
                  className={`pos-sub-tab ${activeSub === s.id ? "active" : ""}`}
                  onClick={() => setActiveSub(s.id)}
                  data-testid={`split-sub-tab-${s.id}`}
                >
                  {s.label} ({s.items.length})
                </button>
              ))}
              <button
                className="pos-sub-tab add-tab"
                onClick={() => createSplitMutation.mutate()}
                disabled={createSplitMutation.isPending}
                data-testid="split-add-sub-mobile"
              >
                + Nueva
              </button>
            </div>

            {/* Drop area */}
            <div className={`pos-sub-drop ${activeSplit && activeSplit.items.length > 0 ? "has-items" : ""}`} data-testid="split-drop-area">
              {!activeSplit || activeSplit.items.length === 0 ? (
                <div className="text-center py-5 text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Sin items asignados. Usa → desde la lista.
                </div>
              ) : (
                activeSplit.items.map(si => {
                  const oi = table.items.find(i => i.id === si.orderItemId);
                  if (!oi) return null;
                  return (
                    <div key={si.id} className="pos-sub-item-card" data-testid={`split-sub-item-${si.orderItemId}`}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate" style={{ color: "hsl(var(--foreground))" }}>
                          {oi.qty}× {oi.productNameSnapshot}
                        </div>
                        {oi.customerNameSnapshot && (
                          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{oi.customerNameSnapshot}</div>
                        )}
                      </div>
                      <span className="font-mono text-xs" style={{ color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>
                        ₡{(getItemUnitPrice(oi) * oi.qty).toLocaleString()}
                      </span>
                      <button
                        className="pos-sub-item-back"
                        onClick={() => moveItemMutation.mutate({ orderItemId: oi.id, fromSplitId: activeSplit.id, toSplitId: null })}
                        disabled={moveItemMutation.isPending}
                        data-testid={`split-return-item-${oi.id}`}
                      >
                        ←
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Subtotal + Separate */}
            <div className="pos-desktop-only" style={{ gap: 8 }}>
              <div className="flex justify-between items-center">
                <span className="pos-sect-lbl">Subtotal</span>
                <span className="font-mono text-base" style={{ color: "hsl(142 76% 36%)" }} data-testid="split-sub-total">
                  ₡{activeSplitTotal.toLocaleString()}
                </span>
              </div>
              <Button
                variant="outline"
                className={`w-full ${hasSplitsWithItems ? "" : "opacity-50"}`}
                onClick={() => splitOrderMutation.mutate()}
                disabled={!hasSplitsWithItems || splitOrderMutation.isPending}
                data-testid="split-separate-desktop"
              >
                {splitOrderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                SEPARAR TIQUETES
              </Button>
            </div>

            <div className="pos-mobile-only" style={{ marginTop: "auto", gap: 8 }}>
              <div className="flex justify-between items-center px-1">
                <span className="pos-sect-lbl">Subtotal subcuenta</span>
                <span className="font-mono text-sm" style={{ color: "hsl(142 76% 36%)" }}>₡{activeSplitTotal.toLocaleString()}</span>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => splitOrderMutation.mutate()}
                disabled={!hasSplitsWithItems || splitOrderMutation.isPending}
                data-testid="split-separate-mobile"
              >
                {splitOrderMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                SEPARAR TIQUETES
              </Button>
              <Button variant="outline" className="w-full" onClick={() => setStep(3)} data-testid="split-mobile-to-summary">
                VER RESUMEN <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStep(1)} data-testid="split-mobile-back-1">
                <ChevronLeft className="w-4 h-4 mr-1" /> Items
              </Button>
            </div>
          </div>

          {/* PANEL 3: Summary */}
          <div className="pos-step-panel">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Resumen</span>
              <span className="pos-col-h-title">Todas las subcuentas</span>
            </div>

            <div className="flex flex-col gap-2" data-testid="split-sub-cards">
              {splits.map(s => {
                const sTotal = getSplitTotal(s);
                return (
                  <div key={s.id} className={`pos-sub-card ${s.items.length > 0 ? "filled" : ""}`} data-testid={`split-summary-card-${s.id}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-bold">{s.label}</span>
                      <span className="font-mono text-sm font-semibold" style={{ color: "hsl(142 76% 36%)" }}>
                        ₡{sTotal.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-xs mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {s.items.length} item{s.items.length !== 1 ? "s" : ""}
                    </div>
                    {s.items.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => onPaySplit(s.id, s.label, sTotal)}
                        data-testid={`split-pay-sub-${s.id}`}
                      >
                        Pagar esta cuenta
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="pos-desktop-only" style={{ gap: 8, marginTop: "auto" }}>
              <div className="pos-info-box">
                <div className="flex-1">
                  <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Pendiente cuenta principal</div>
                  <div className="font-mono text-sm" style={{ color: "hsl(var(--foreground))" }} data-testid="split-remaining-total">
                    ₡{remainingTotal.toLocaleString()}
                  </div>
                </div>
              </div>
              <Button className="w-full" onClick={onPayAll} data-testid="split-pay-all-desktop">
                PAGAR TODO — ₡{Number(table.totalAmount).toLocaleString()}
              </Button>
            </div>

            <div className="pos-mobile-only" style={{ marginTop: "auto", gap: 8 }}>
              <div className="pos-info-box">
                <div className="flex-1">
                  <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Pendiente principal</div>
                  <div className="font-mono text-sm" style={{ color: "hsl(var(--foreground))" }}>₡{remainingTotal.toLocaleString()}</div>
                </div>
              </div>
              <Button className="w-full" onClick={onPayAll} data-testid="split-pay-all-mobile">
                PAGAR TODO <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setStep(2)} data-testid="split-mobile-back-2">
                <ChevronLeft className="w-4 h-4 mr-1" /> Subcuenta
              </Button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
