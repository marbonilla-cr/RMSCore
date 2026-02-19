import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const dropAreaRef = useRef<HTMLDivElement>(null);
  const subCardsRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(1);
  const [activeSub, setActiveSub] = useState<number | null>(null);

  const orderId = table?.orderId;

  const { data: splits = [] } = useQuery<SplitAccountData[]>({
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
      const label = `Sub #${idx + 1}`;
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

      [dropAreaRef.current, subCardsRef.current].forEach(el => {
        if (el) {
          el.classList.remove("pos-vibrating");
          void el.offsetWidth;
          el.classList.add("pos-vibrating");
        }
      });

      setTimeout(() => {
        [dropAreaRef.current, subCardsRef.current].forEach(el => {
          if (el) el.classList.remove("pos-vibrating");
        });
        if (dialogRef.current) {
          dialogRef.current.classList.add("pos-flash-green");
        }

        queryClient.invalidateQueries({ queryKey: ["/api/pos/tables"] });
        queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });

        const childIds = data.childOrderIds || [];

        setTimeout(() => {
          onSeparated(childIds);
          onClose();
          toast({ title: "Cuenta separada en tiquetes independientes" });
        }, 750);
      }, 420);
    },
    onError: (err: any) => {
      toast({ title: "Error al separar", description: err.message, variant: "destructive" });
    },
  });

  if (!open || !table) return null;

  const activeSplit = splits.find(s => s.id === activeSub);
  const activeSplitTotal = activeSplit ? getSplitTotal(activeSplit) : 0;
  const remainingTotal = unassignedItems.reduce((s, i) => s + getItemUnitPrice(i) * i.qty, 0);
  const hasSplitsWithItems = splits.some(s => s.items.length > 0);
  const allItems = table.items.filter(i => i.status !== "VOIDED" && i.status !== "PAID");

  return (
    <div
      className={`pos-overlay ${open ? "open" : ""}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="split-dialog-overlay"
    >
      <div className="pos-dialog pos-dialog-split" ref={dialogRef} data-testid="split-dialog">
        <div className="pos-drag-handle" />

        {/* HEADER */}
        <div className="pos-dlg-header">
          <span className="pos-dlg-tag">División</span>
          <span className="pos-dlg-title" data-testid="split-dialog-title">{table.tableName}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="pos-chip pos-chip-blue" data-testid="split-remaining-chip">
              {unassignedItems.length} sin asignar
            </span>
            <button className="pos-dlg-close" onClick={onClose} data-testid="button-close-split-dialog">✕</button>
          </div>
        </div>

        {/* STEP TABS (mobile) */}
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
        <div className={`pos-step-panels slide-${step}`} data-testid="split-panels">

          {/* ── PANEL 1: Main Items ── */}
          <div className="pos-step-panel">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Principal</span>
              <span className="pos-col-h-title">Items disponibles</span>
            </div>

            <div className="pos-sect-lbl">Toca → para mover a subcuenta activa</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="split-main-items">
              {allItems.map((item) => {
                const isMoved = assignedItemIds.includes(item.id);
                return (
                  <div
                    key={item.id}
                    className={`pos-split-item ${isMoved ? "moved" : ""}`}
                    data-testid={`split-item-${item.id}`}
                  >
                    <div className="pos-si-check">{isMoved ? "✓" : ""}</div>
                    <div className="pos-si-info">
                      <div className="pos-si-name">{item.productNameSnapshot}</div>
                      {item.customerNameSnapshot && <div className="pos-si-sub">{item.customerNameSnapshot}</div>}
                      <div className="pos-si-qty">×{item.qty}</div>
                    </div>
                    <span className="pos-si-price">₡{(getItemUnitPrice(item) * item.qty).toLocaleString()}</span>
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

            <div className="pos-mobile-only">
              <button className="pos-primary-btn" onClick={() => setStep(2)} data-testid="split-mobile-continue-1">
                VER SUBCUENTA →
              </button>
            </div>
            <div className="pos-desktop-only">
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--c-text3)" }}>
                {unassignedItems.length} items sin asignar
              </div>
            </div>
          </div>

          {/* ── PANEL 2: Active Subcuenta ── */}
          <div className="pos-step-panel" id="split-panel-active">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Subcuenta</span>
              <span className="pos-col-h-title" data-testid="split-active-title">{activeSplit?.label || "—"}</span>
              <button
                className="pos-add-sub-btn"
                onClick={() => createSplitMutation.mutate()}
                disabled={createSplitMutation.isPending}
                data-testid="split-add-sub-desktop"
              >
                + Nueva
              </button>
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
                  {s.label}{s.items.length ? ` (${s.items.length})` : ""}
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

            {/* Mobile: + Nueva Subcuenta btn */}
            <div className="pos-mobile-only">
              <button
                className="pos-secondary-btn"
                onClick={() => createSplitMutation.mutate()}
                disabled={createSplitMutation.isPending}
                style={{ fontSize: 13, padding: 10 }}
              >
                + Nueva Subcuenta
              </button>
            </div>

            {/* Drop area */}
            <div
              className={`pos-sub-drop ${activeSplit && activeSplit.items.length > 0 ? "has-items" : ""}`}
              ref={dropAreaRef}
              data-testid="split-drop-area"
            >
              {!activeSplit || activeSplit.items.length === 0 ? (
                <div className="pos-sub-empty-msg">Sin items asignados. Usa → desde la lista.</div>
              ) : (
                activeSplit.items.map(si => {
                  const oi = table.items.find(i => i.id === si.orderItemId);
                  if (!oi) return null;
                  return (
                    <div key={si.id} className="pos-sub-item-card" data-testid={`split-sub-item-${si.orderItemId}`}>
                      <div className="pos-sic-name">×{oi.qty} {oi.productNameSnapshot}</div>
                      <div className="pos-sic-price">₡{(getItemUnitPrice(oi) * oi.qty).toLocaleString()}</div>
                      <button
                        className="pos-sic-back"
                        onClick={() => moveItemMutation.mutate({ orderItemId: oi.id, fromSplitId: activeSplit.id, toSplitId: null })}
                        disabled={moveItemMutation.isPending}
                        title="Devolver"
                        data-testid={`split-return-item-${oi.id}`}
                      >
                        ←
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop: subtotal + separate */}
            <div className="pos-desktop-only" style={{ gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="pos-sect-lbl">Subtotal</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 16, color: "var(--c-green)" }} data-testid="split-sub-total">
                  ₡{activeSplitTotal.toLocaleString()}
                </span>
              </div>
              <button
                className={`pos-separate-btn ${hasSplitsWithItems ? "ready" : ""}`}
                onClick={() => splitOrderMutation.mutate()}
                disabled={!hasSplitsWithItems || splitOrderMutation.isPending}
                data-testid="split-separate-desktop"
              >
                {splitOrderMutation.isPending ? "Procesando..." : "SEPARAR TIQUETES"}
              </button>
            </div>

            {/* Mobile: subtotal + separate + nav */}
            <div className="pos-mobile-only" style={{ marginTop: "auto", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px" }}>
                <span className="pos-sect-lbl">Subtotal subcuenta</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 15, color: "var(--c-green)" }}>
                  ₡{activeSplitTotal.toLocaleString()}
                </span>
              </div>
              <button
                className={`pos-separate-btn ${hasSplitsWithItems ? "ready" : ""}`}
                onClick={() => splitOrderMutation.mutate()}
                disabled={!hasSplitsWithItems || splitOrderMutation.isPending}
                data-testid="split-separate-mobile"
              >
                {splitOrderMutation.isPending ? "Procesando..." : "SEPARAR TIQUETES"}
              </button>
              <button className="pos-secondary-btn" onClick={() => setStep(3)} data-testid="split-mobile-to-summary">
                VER RESUMEN →
              </button>
            </div>
          </div>

          {/* ── PANEL 3: Summary ── */}
          <div className="pos-step-panel" id="split-panel-summary">
            <div className="pos-col-header">
              <span className="pos-col-h-tag">Resumen</span>
              <span className="pos-col-h-title">Todas las subcuentas</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }} ref={subCardsRef} data-testid="split-sub-cards">
              {splits.map(s => {
                const sTotal = getSplitTotal(s);
                const hasItems = s.items.length > 0;
                return (
                  <div key={s.id} className={`pos-sub-card ${hasItems ? "filled" : ""}`} data-testid={`split-summary-card-${s.id}`}>
                    <div className="pos-sc-head">
                      <div className="pos-sc-name">{s.label}</div>
                      <div className="pos-sc-total">{hasItems ? `₡${sTotal.toLocaleString()}` : "—"}</div>
                    </div>
                    <div className="pos-sc-meta">{s.items.length} item{s.items.length !== 1 ? "s" : ""}</div>
                    <button
                      className="pos-sc-pay-btn"
                      disabled={!hasItems}
                      onClick={() => onPaySplit(s.id, s.label, sTotal)}
                      data-testid={`split-pay-sub-${s.id}`}
                    >
                      {hasItems ? "PAGAR ESTA CUENTA →" : "Sin items asignados"}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Desktop: remaining + pay all */}
            <div className="pos-desktop-only" style={{ gap: 8, marginTop: "auto" }}>
              <div className="pos-info-box">
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--c-text3)" }}>Pendiente cuenta principal</div>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, color: "var(--c-text)" }} data-testid="split-remaining-total">
                    ₡{remainingTotal.toLocaleString()}
                  </div>
                </div>
              </div>
              <button className="pos-primary-btn" onClick={onPayAll} data-testid="split-pay-all-desktop">
                PAGAR TODO — ₡{Number(table.totalAmount).toLocaleString()}
              </button>
            </div>

            {/* Mobile: remaining + pay all */}
            <div className="pos-mobile-only" style={{ marginTop: "auto", gap: 8 }}>
              <div className="pos-info-box">
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--c-text3)" }}>Pendiente principal</div>
                  <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, color: "var(--c-text)" }}>
                    ₡{remainingTotal.toLocaleString()}
                  </div>
                </div>
              </div>
              <button className="pos-primary-btn" onClick={onPayAll} data-testid="split-pay-all-mobile">
                PAGAR TODO →
              </button>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
