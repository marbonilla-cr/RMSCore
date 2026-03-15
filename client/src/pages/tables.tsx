import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Search, Settings, Loader2, User, UtensilsCrossed, Clock, DollarSign, CalendarDays, Bell, ArrowRightLeft, AlertTriangle, X, Zap, Plus } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { wsManager } from "@/lib/ws";
import { useWsConnected } from "@/hooks/use-ws-connected";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { ReservationsSheet } from "@/components/reservations/ReservationsSheet";

interface TableView {
  id: number;
  tableCode: string;
  tableName: string;
  active: boolean;
  hasOpenOrder: boolean;
  orderId: number | null;
  orderStatus: string | null;
  dailyNumber: number | null;
  responsibleWaiterName: string | null;
  openedAt: string | null;
  pendingQrCount: number;
  itemCount: number;
  totalAmount: string | null;
  lastSentToKitchenAt: string | null;
  hasActiveReservation: boolean;
  subaccountNames: string[];
  isQuickSale?: boolean;
  upcomingReservation: {
    id: number;
    guestName: string;
    partySize: number;
    reservedDate: string;
    reservedTime: string;
    status: string;
    minutesUntil: number;
  } | null;
}

function formatElapsed(dateStr: string | null) {
  if (!dateStr) return "--";
  return timeAgo(dateStr);
}

type ColumnKey = "waiter" | "items" | "amount" | "time";

const COLUMN_OPTIONS: { key: ColumnKey; label: string }[] = [
  { key: "waiter", label: "Salonero" },
  { key: "items", label: "Items" },
  { key: "amount", label: "Monto" },
  { key: "time", label: "Tiempo" },
];

function getTableStatusClass(t: TableView): string {
  if (t.pendingQrCount > 0) return "qr";
  if (t.orderStatus === "READY") return "ready";
  if (t.orderStatus === "PREPARING") return "preparing";
  if (t.orderStatus === "IN_KITCHEN") return "kitchen";
  if (t.hasOpenOrder) return "open";
  return "";
}

function getTableBadge(t: TableView): { label: string; cls: string } {
  if (t.pendingQrCount > 0) return { label: "QR Pendiente", cls: "badge-ds badge-amber" };
  if (!t.hasOpenOrder) return { label: "Libre", cls: "badge-ds badge-muted" };
  if (t.orderStatus === "READY") return { label: "Lista", cls: "badge-ds badge-green" };
  if (t.orderStatus === "PREPARING") return { label: "Preparando", cls: "badge-ds badge-amber" };
  if (t.orderStatus === "IN_KITCHEN") return { label: "En Cocina", cls: "badge-ds badge-blue" };
  return { label: "Abierta", cls: "badge-ds badge-green" };
}

function TablesSkeleton() {
  return (
    <div className="tables-grid stagger-children">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="table-card" style={{ opacity: 0.5 }}>
          <div className="skeleton" style={{ height: 20, width: 60, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 16, width: 90, marginBottom: 12 }} />
          <div className="skeleton" style={{ height: 12, width: 100 }} />
          <div className="skeleton" style={{ height: 12, width: 80, marginTop: 4 }} />
        </div>
      ))}
    </div>
  );
}

function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch {}
}

export default function TablesPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [reservationsOpen, setReservationsOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveSource, setMoveSource] = useState<number | null>(null);
  const [moveDest, setMoveDest] = useState<number | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveMode, setMoveMode] = useState<"table" | "subaccount">("table");
  const [subaccounts, setSubaccounts] = useState<any[]>([]);
  const [selectedSubaccount, setSelectedSubaccount] = useState<number | null>(null);
  const [loadingSubaccounts, setLoadingSubaccounts] = useState(false);
  const [qrPopupTables, setQrPopupTables] = useState<{ id: number; name: string; count: number }[]>([]);
  const [qrPopupDismissed, setQrPopupDismissed] = useState(false);
  const [quickSaleDialogOpen, setQuickSaleDialogOpen] = useState(false);
  const [quickSaleName, setQuickSaleName] = useState("");
  const [quickSaleLoading, setQuickSaleLoading] = useState(false);
  const prevQrCountsRef = useRef<Map<number, number>>(new Map());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(() => {
    try {
      const saved = localStorage.getItem("tables_visible_columns");
      if (saved) {
        const parsed = JSON.parse(saved) as ColumnKey[];
        return new Set<ColumnKey>(parsed);
      }
    } catch {}
    return new Set<ColumnKey>(["waiter", "items", "amount", "time"]);
  });

  const wsUp = useWsConnected();
  const { data: tables = [], isLoading } = useQuery<TableView[]>({
    queryKey: ["/api/waiter/tables"],
    refetchInterval: wsUp ? 10000 : 5000,
  });

  useEffect(() => {
    const tablesWithQr = tables.filter(t => t.pendingQrCount > 0);
    const prevCounts = prevQrCountsRef.current;
    const newCounts = new Map<number, number>();
    let hasIncrease = false;

    for (const t of tablesWithQr) {
      newCounts.set(t.id, t.pendingQrCount);
      const prev = prevCounts.get(t.id) || 0;
      if (t.pendingQrCount > prev) {
        hasIncrease = true;
      }
    }

    const isFirstLoad = prevCounts.size === 0 && tablesWithQr.length > 0;

    const newKey = tablesWithQr.map(t => `${t.id}:${t.pendingQrCount}`).sort().join(",");
    const oldKey = qrPopupTables.map(t => `${t.id}:${t.count}`).sort().join(",");

    if (newKey !== oldKey) {
      if (tablesWithQr.length > 0) {
        setQrPopupTables(tablesWithQr.map(t => ({ id: t.id, name: t.tableName, count: t.pendingQrCount })));
      } else {
        setQrPopupTables([]);
      }
    }

    if (hasIncrease || isFirstLoad) {
      setQrPopupDismissed(false);
      if (!isFirstLoad) {
        playAlertSound();
      }
    }

    prevQrCountsRef.current = newCounts;
  }, [tables]);

  useEffect(() => {
    wsManager.connect();
    const invalidate = () => {
      queryClient.refetchQueries({ queryKey: ["/api/waiter/tables"] });
    };
    const unsubs = [
      wsManager.on("table_status_changed", invalidate),
      wsManager.on("qr_submission_created", (p: any) => {
        invalidate();
        playAlertSound();
      }),
      wsManager.on("order_updated", invalidate),
      wsManager.on("payment_completed", invalidate),
      wsManager.on("payment_voided", invalidate),
      wsManager.on("kitchen_item_status_changed", invalidate),
      wsManager.on("reservation_updated", invalidate),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem("tables_visible_columns", JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const activeTables = tables.filter(t => t.active && !t.isQuickSale);
  const filtered = search
    ? activeTables.filter(t => t.tableName.toLowerCase().includes(search.toLowerCase()) || t.tableCode.toLowerCase().includes(search.toLowerCase()))
    : activeTables;
  const isEffectivelyOpen = (t: TableView) =>
    t.hasOpenOrder && (t.itemCount > 0 || Number(t.totalAmount || 0) > 0 || t.pendingQrCount > 0);
  const withOrder = filtered.filter(t => isEffectivelyOpen(t));
  const withoutOrder = filtered.filter(t => !isEffectivelyOpen(t));
  const occupiedCount = activeTables.filter(t => isEffectivelyOpen(t)).length;
  const reservedCount = activeTables.filter(t => t.hasActiveReservation).length;
  const freeForWalkins = activeTables.length - occupiedCount - activeTables.filter(t => !isEffectivelyOpen(t) && t.hasActiveReservation).length;

  const now = new Date();
  const dayName = now.toLocaleDateString("es-CR", { weekday: "long" });
  const timeStr = now.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit", hour12: true });

  const fetchSubaccounts = async (tableId: number) => {
    const table = activeTables.find(t => t.id === tableId);
    if (!table?.orderId) return;
    setLoadingSubaccounts(true);
    try {
      const res = await fetch(`/api/waiter/orders/${table.orderId}/by-subaccount`, { credentials: "include" });
      const data = await res.json();
      setSubaccounts(data.groups || []);
    } catch { setSubaccounts([]); }
    finally { setLoadingSubaccounts(false); }
  };

  const handleSelectSource = (tableId: number) => {
    setMoveSource(tableId);
    setMoveDest(null);
    setSelectedSubaccount(null);
    if (moveMode === "subaccount") fetchSubaccounts(tableId);
  };

  const handleMove = async () => {
    if (moveMode === "subaccount") {
      if (!selectedSubaccount || !moveDest) return;
      setMoveLoading(true);
      try {
        const res = await fetch("/api/tables/move-subaccount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ subaccountId: selectedSubaccount, destTableId: moveDest }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Error al mover subcuenta");
        toast({ title: "Subcuenta movida", description: data.message });
        setMoveDialogOpen(false);
        setMoveSource(null);
        setMoveDest(null);
        setSelectedSubaccount(null);
        queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally { setMoveLoading(false); }
    } else {
      if (!moveSource || !moveDest) return;
      setMoveLoading(true);
      try {
        const res = await fetch("/api/tables/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ sourceTableId: moveSource, destTableId: moveDest }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Error al mover mesa");
        toast({ title: "Mesa movida", description: data.message });
        setMoveDialogOpen(false);
        setMoveSource(null);
        setMoveDest(null);
        queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally { setMoveLoading(false); }
    }
  };

  const handleCreateQuickSale = async () => {
    setQuickSaleLoading(true);
    try {
      const res = await apiRequest("POST", "/api/waiter/quick-sale", { name: quickSaleName.trim() || undefined });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setQuickSaleDialogOpen(false);
      setQuickSaleName("");
      navigate(`/tables/quick/${data.orderId}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setQuickSaleLoading(false);
    }
  };

  const quickSales = tables.filter(t => t.isQuickSale);
  const occupiedTables = activeTables.filter(t => isEffectivelyOpen(t));
  const availableTables = activeTables.filter(t => !isEffectivelyOpen(t));
  const moveDestTables = moveMode === "subaccount"
    ? activeTables.filter(t => t.id !== moveSource)
    : availableTables;

  return (
    <div className="screen-tables page-enter">
      <style>{`
        .screen-tables {
          background: var(--s0);
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          font-family: var(--f-body);
          color: var(--text);
        }

        .tables-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          padding: 0 18px 10px;
        }

        .table-card {
          background: var(--s1);
          border: 1.5px solid var(--border-ds);
          border-radius: var(--r-md);
          padding: 14px;
          cursor: pointer;
          transition: all var(--t-fast);
          position: relative;
          text-decoration: none;
          display: block;
          color: var(--text);
        }
        .table-card:active { background: var(--s2); }
        .table-card.qr { border-color: rgba(243,156,18,0.4); }
        .table-card.kitchen { border-color: rgba(59,130,246,0.3); }
        .table-card.ready { border-color: rgba(46,204,113,0.4); box-shadow: 0 0 16px rgba(46,204,113,0.12); }
        .table-card.preparing { border-color: rgba(243,156,18,0.3); }
        .table-card.open { border-color: rgba(46,204,113,0.2); }
        .table-card.has-reservation-soon { border-color: rgba(243,156,18,0.4); box-shadow: 0 0 12px rgba(243,156,18,0.1); }

        .reservation-badge {
          font-family: var(--f-mono);
          font-size: 10px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: var(--r-xs);
          display: inline-flex;
          align-items: center;
          gap: 4px;
          margin-top: 4px;
          margin-bottom: 2px;
        }
        .reservation-badge.soon {
          background: rgba(243,156,18,0.15);
          color: #b87a00;
          animation: pulse-badge 2s ease-in-out infinite;
        }
        .reservation-badge.later {
          background: var(--s2);
          color: var(--text3);
        }
        .res-tag {
          position: absolute;
          top: 6px;
          right: 6px;
          font-family: var(--f-mono);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.5px;
          padding: 2px 6px;
          border-radius: var(--r-xs);
          background: var(--acc-d, rgba(29,78,216,0.07));
          color: var(--acc, #1d4ed8);
          border: 1px solid var(--acc-m, rgba(29,78,216,0.18));
        }
        @keyframes pulse-badge {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }

        .tc-name {
          font-family: var(--f-disp);
          font-size: 20px;
          font-weight: 800;
          margin-bottom: 6px;
        }
        .tc-order-num {
          font-size: 13px;
          font-weight: 600;
          opacity: 0.55;
        }
        .tc-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 4px 8px;
          margin-top: 8px;
        }
        @media (min-width: 640px) {
          .tc-meta {
            display: flex;
            flex-direction: row;
            flex-wrap: wrap;
            gap: 10px;
          }
        }
        .tc-meta-row {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text3);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .tc-meta-row .val {
          color: var(--text2);
        }
        .tc-amount {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text3);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .tc-amount .val {
          color: var(--green);
          font-weight: 600;
        }

        .tables-free-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          padding: 0 18px 16px;
        }
        .table-card-free {
          background: var(--s1);
          border: 1px solid var(--border-ds);
          border-radius: var(--r-sm);
          padding: 12px;
          text-align: center;
          cursor: pointer;
          transition: all var(--t-fast);
          text-decoration: none;
          display: block;
          color: var(--text);
        }
        .table-card-free:active { background: var(--s2); }
        .tcf-name {
          font-family: var(--f-disp);
          font-size: 16px;
          font-weight: 700;
        }
        .tcf-sub {
          font-family: var(--f-mono);
          font-size: 10px;
          color: var(--text3);
          margin-top: 2px;
        }

        .tables-scroll {
          flex: 1;
          overflow-y: auto;
          padding-bottom: 8px;
        }

        .col-picker-overlay {
          position: fixed;
          inset: 0;
          z-index: 99;
        }
        .col-picker {
          position: absolute;
          top: 52px;
          right: 18px;
          background: var(--s1);
          border: 1px solid var(--border-ds);
          border-radius: var(--r-md);
          padding: 10px;
          z-index: 100;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 140px;
        }
        .col-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: var(--r-xs);
          font-family: var(--f-mono);
          font-size: 12px;
          color: var(--text2);
          cursor: pointer;
          background: none;
          border: none;
          width: 100%;
          text-align: left;
          transition: background var(--t-fast);
        }
        .col-option:active { background: var(--s2); }
        .col-option.active { color: var(--green); }
        .col-check {
          width: 16px; height: 16px;
          border-radius: 4px;
          border: 1.5px solid var(--border2);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          flex-shrink: 0;
        }
        .col-option.active .col-check {
          background: var(--green);
          border-color: var(--green);
          color: #050f08;
        }

        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: var(--text3);
          font-family: var(--f-mono);
          font-size: 13px;
        }

        .host-bar {
          display: flex;
          gap: 6px;
          padding: 0 18px 10px;
          flex-wrap: wrap;
        }
        .host-chip {
          font-family: var(--f-mono);
          font-size: 10px;
          font-weight: 600;
          padding: 4px 10px;
          border-radius: var(--r-xs);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .host-chip.occupied { background: var(--sage-d); color: var(--sage); }
        .host-chip.reserved { background: var(--acc-d); color: var(--acc); }
        .host-chip.walkin { background: var(--s2); color: var(--text2); }
        .host-chip.walkin.good { background: var(--sage-d); color: var(--sage); }
        .host-chip.walkin.tight { background: var(--amber-d); color: var(--amber); }
        .host-chip.walkin.full { background: var(--red-d); color: var(--red); }

        .move-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          z-index: 200;
        }
        .move-dialog {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 201;
          background: var(--s1);
          border: 1px solid var(--border-ds);
          border-radius: var(--r-lg);
          width: min(94vw, 520px);
          max-height: 80dvh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .move-dialog-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 16px 18px;
          border-bottom: 1px solid var(--border-ds);
          font-family: var(--f-disp);
          font-size: 16px;
          font-weight: 700;
        }
        .move-dialog-body {
          display: flex;
          gap: 0;
          flex: 1;
          overflow: hidden;
          min-height: 200px;
        }
        .move-col {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .move-col-title {
          font-family: var(--f-mono);
          font-size: 11px;
          font-weight: 600;
          color: var(--text3);
          padding: 10px 14px 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .move-col-list {
          flex: 1;
          overflow-y: auto;
          padding: 4px 8px 8px;
        }
        .move-arrow-sep {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          flex-shrink: 0;
          border-left: 1px solid var(--border-ds);
          border-right: 1px solid var(--border-ds);
        }
        .move-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: 10px 12px;
          border-radius: var(--r-sm);
          border: 1.5px solid transparent;
          background: none;
          cursor: pointer;
          transition: all var(--t-fast);
          color: var(--text);
          font-family: var(--f-body);
          margin-bottom: 4px;
        }
        .move-item:hover { background: var(--s2); }
        .move-item:active { background: var(--s3, var(--s2)); }
        .move-item.selected {
          border-color: var(--green);
          background: var(--sage-d);
        }
        .move-item.disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .move-item-name {
          font-family: var(--f-disp);
          font-size: 14px;
          font-weight: 700;
        }
        .move-item-detail {
          font-family: var(--f-mono);
          font-size: 10px;
          color: var(--text3);
          margin-top: 2px;
        }
        .move-summary {
          text-align: center;
          padding: 10px 18px;
          font-family: var(--f-disp);
          font-size: 14px;
          font-weight: 700;
          color: var(--green);
          border-top: 1px solid var(--border-ds);
        }
        .move-dialog-footer {
          display: flex;
          gap: 10px;
          padding: 14px 18px;
          border-top: 1px solid var(--border-ds);
        }
        .move-cancel {
          flex: 1;
          padding: 10px;
          border-radius: var(--r-sm);
          border: 1px solid var(--border-ds);
          background: var(--s2);
          color: var(--text2);
          font-family: var(--f-mono);
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .move-confirm {
          flex: 1;
          padding: 10px;
          border-radius: var(--r-sm);
          border: none;
          background: var(--green);
          color: #050f08;
          font-family: var(--f-mono);
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .move-confirm:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .move-empty {
          text-align: center;
          padding: 24px 12px;
          color: var(--text3);
          font-family: var(--f-mono);
          font-size: 12px;
        }
        .move-mode-toggle {
          display: flex;
          gap: 0;
          padding: 8px 18px;
          border-bottom: 1px solid var(--border-ds);
        }
        .move-mode-btn {
          flex: 1;
          padding: 8px;
          border: 1px solid var(--border-ds);
          background: var(--s2);
          color: var(--text3);
          font-family: var(--f-mono);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--t-fast);
        }
        .move-mode-btn:first-child { border-radius: var(--r-sm) 0 0 var(--r-sm); }
        .move-mode-btn:last-child { border-radius: 0 var(--r-sm) var(--r-sm) 0; }
        .move-mode-btn.active {
          background: var(--green);
          color: #050f08;
          border-color: var(--green);
        }
        .move-sub-section {
          border-top: 1px solid var(--border-ds);
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        @keyframes qr-bar-enter {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .qr-notify-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          background: var(--red-d);
          border: 1px solid var(--red-m);
          border-radius: var(--r-sm);
          animation: qr-bar-enter 0.25s ease-out;
          flex-wrap: nowrap;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .qr-notify-bar .qr-bar-icon {
          color: var(--red);
          flex-shrink: 0;
          animation: pulse-badge 1.5s ease-in-out infinite;
        }
        .qr-notify-bar .qr-bar-label {
          font-family: var(--f-disp);
          font-size: 13px;
          font-weight: 700;
          color: var(--red);
          white-space: nowrap;
        }
        .qr-notify-bar .qr-bar-badge {
          background: var(--red);
          color: #fff;
          font-family: var(--f-mono);
          font-size: 11px;
          font-weight: 700;
          min-width: 20px;
          height: 20px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 6px;
          flex-shrink: 0;
        }
        .qr-notify-bar .qr-bar-chips {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          flex: 1;
          min-width: 0;
        }
        .qr-notify-bar .qr-bar-chip {
          background: var(--red);
          color: #fff;
          border: none;
          border-radius: var(--r-sm);
          padding: 4px 10px;
          font-family: var(--f-mono);
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: opacity var(--t-fast);
        }
        .qr-notify-bar .qr-bar-chip:active { opacity: 0.7; }
        .qr-notify-bar .qr-bar-close {
          background: none;
          border: none;
          color: var(--red);
          cursor: pointer;
          padding: 2px;
          margin-left: auto;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          opacity: 0.7;
          transition: opacity var(--t-fast);
        }
        .qr-notify-bar .qr-bar-close:active { opacity: 1; }
      `}</style>

      <div className="screen-header">
        <div style={{ flex: 1 }}>
          <div className="header-title" data-testid="text-page-title">Mesas</div>
          <div className="header-sub" style={{ textTransform: "capitalize" }}>
            {dayName} · {timeStr} · <span style={{ color: "var(--green)" }}>{occupiedCount} activas</span>
          </div>
        </div>
        <button
          className="header-action"
          onClick={() => { setQuickSaleDialogOpen(true); setQuickSaleName(""); }}
          data-testid="button-quick-sale"
          style={{ marginRight: 6 }}
          title="Venta Rápida"
        >
          <Zap size={16} />
        </button>
        <button
          className="header-action"
          onClick={() => { setMoveDialogOpen(true); setMoveSource(null); setMoveDest(null); setMoveMode("table"); setSelectedSubaccount(null); setSubaccounts([]); }}
          data-testid="button-move-table"
          style={{ marginRight: 6 }}
          title="Mover mesa"
        >
          <ArrowRightLeft size={16} />
        </button>
        <button
          className="header-action"
          onClick={() => setReservationsOpen(true)}
          data-testid="button-reservations"
          style={{ marginRight: 6 }}
        >
          <CalendarDays size={16} />
        </button>
        <button
          className="header-action"
          onClick={() => setShowColumnPicker(!showColumnPicker)}
          data-testid="button-column-settings"
        >
          <Settings size={16} />
        </button>
      </div>
      <ReservationsSheet open={reservationsOpen} onOpenChange={setReservationsOpen} />

      {quickSaleDialogOpen && (
        <>
          <div className="move-overlay" onClick={() => setQuickSaleDialogOpen(false)} />
          <div className="move-dialog" data-testid="dialog-quick-sale" style={{ maxWidth: 360 }}>
            <div className="move-dialog-header">
              <Zap size={18} />
              <span>Venta Rápida</span>
              <button onClick={() => setQuickSaleDialogOpen(false)} style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 18 }}>&times;</button>
            </div>
            <div style={{ padding: "16px 18px" }}>
              <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
                Nombre del cliente o referencia (opcional)
              </div>
              <input
                autoFocus
                data-testid="input-quick-sale-name"
                value={quickSaleName}
                onChange={e => setQuickSaleName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleCreateQuickSale(); }}
                placeholder="Ej: Juan, Para llevar, #001..."
                style={{ width: "100%", padding: "10px 12px", borderRadius: "var(--r-sm)", border: "1.5px solid var(--border-ds)", background: "var(--s2)", color: "var(--text)", fontFamily: "var(--f-body)", fontSize: 14 }}
              />
            </div>
            <div className="move-dialog-footer">
              <button className="move-cancel" onClick={() => setQuickSaleDialogOpen(false)}>Cancelar</button>
              <button
                className="move-confirm"
                data-testid="button-confirm-quick-sale"
                onClick={handleCreateQuickSale}
                disabled={quickSaleLoading}
              >
                {quickSaleLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Crear venta
              </button>
            </div>
          </div>
        </>
      )}

      {moveDialogOpen && (
        <>
          <div className="move-overlay" onClick={() => setMoveDialogOpen(false)} />
          <div className="move-dialog" data-testid="dialog-move-table">
            <div className="move-dialog-header">
              <ArrowRightLeft size={18} />
              <span>Mover {moveMode === "subaccount" ? "subcuenta" : "mesa"}</span>
              <button onClick={() => setMoveDialogOpen(false)} data-testid="button-close-move" style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 18 }}>&times;</button>
            </div>
            <div className="move-mode-toggle" data-testid="move-mode-toggle">
              <button
                className={`move-mode-btn${moveMode === "table" ? " active" : ""}`}
                onClick={() => { setMoveMode("table"); setMoveSource(null); setMoveDest(null); setSelectedSubaccount(null); setSubaccounts([]); }}
                data-testid="button-mode-table"
              >Mesa completa</button>
              <button
                className={`move-mode-btn${moveMode === "subaccount" ? " active" : ""}`}
                onClick={() => { setMoveMode("subaccount"); setMoveSource(null); setMoveDest(null); setSelectedSubaccount(null); setSubaccounts([]); }}
                data-testid="button-mode-subaccount"
              >Subcuenta</button>
            </div>
            <div className="move-dialog-body">
              <div className="move-col">
                <div className="move-col-title">Origen (con cuenta)</div>
                <div className="move-col-list">
                  {occupiedTables.length === 0 ? (
                    <div className="move-empty">No hay mesas ocupadas</div>
                  ) : occupiedTables.map(t => (
                    <button
                      key={t.id}
                      className={`move-item${moveSource === t.id ? " selected" : ""}`}
                      onClick={() => handleSelectSource(t.id)}
                      data-testid={`move-source-${t.id}`}
                    >
                      <div className="move-item-name">{t.tableName}</div>
                      <div className="move-item-detail">{t.itemCount} items · {t.responsibleWaiterName || "Sin salonero"}</div>
                    </button>
                  ))}
                </div>
                {moveMode === "subaccount" && moveSource && (
                  <div className="move-sub-section">
                    <div className="move-col-title">Subcuentas</div>
                    <div className="move-col-list" style={{ maxHeight: 140 }}>
                      {loadingSubaccounts ? (
                        <div className="move-empty"><Loader2 size={16} className="spin" /></div>
                      ) : subaccounts.length === 0 ? (
                        <div className="move-empty">Sin subcuentas</div>
                      ) : subaccounts.map((g: any) => (
                        <button
                          key={g.subaccount.id}
                          className={`move-item${selectedSubaccount === g.subaccount.id ? " selected" : ""}`}
                          onClick={() => { setSelectedSubaccount(g.subaccount.id); setMoveDest(null); }}
                          data-testid={`move-sub-${g.subaccount.id}`}
                        >
                          <div className="move-item-name">{g.subaccount.label || g.subaccount.code}</div>
                          <div className="move-item-detail">{g.items?.length || 0} items</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="move-arrow-sep">
                <ArrowRightLeft size={20} style={{ color: (moveMode === "table" ? moveSource : selectedSubaccount) ? "var(--green)" : "var(--text3)" }} />
              </div>
              <div className="move-col">
                <div className="move-col-title">Destino {moveMode === "table" ? "(libre)" : "(cualquier mesa)"}</div>
                <div className="move-col-list">
                  {moveDestTables.length === 0 ? (
                    <div className="move-empty">No hay mesas disponibles</div>
                  ) : moveDestTables.map(t => {
                    const canSelect = moveMode === "table" ? !!moveSource : !!selectedSubaccount;
                    const isOccupied = isEffectivelyOpen(t);
                    return (
                      <button
                        key={t.id}
                        className={`move-item${moveDest === t.id ? " selected" : ""}${!canSelect ? " disabled" : ""}`}
                        onClick={() => canSelect && setMoveDest(t.id)}
                        disabled={!canSelect}
                        data-testid={`move-dest-${t.id}`}
                      >
                        <div className="move-item-name">{t.tableName}</div>
                        <div className="move-item-detail">{isOccupied ? `${t.itemCount} items` : "Libre"}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            {moveDest && (moveMode === "table" ? moveSource : selectedSubaccount) && (
              <div className="move-summary" data-testid="move-summary">
                {moveMode === "subaccount" && selectedSubaccount
                  ? `${subaccounts.find((g: any) => g.subaccount.id === selectedSubaccount)?.subaccount.label || "Subcuenta"} → ${activeTables.find(t => t.id === moveDest)?.tableName}`
                  : `${activeTables.find(t => t.id === moveSource)?.tableName} → ${activeTables.find(t => t.id === moveDest)?.tableName}`
                }
              </div>
            )}
            <div className="move-dialog-footer">
              <button className="move-cancel" onClick={() => setMoveDialogOpen(false)} data-testid="button-cancel-move">Cancelar</button>
              <button
                className="move-confirm"
                disabled={moveMode === "table" ? (!moveSource || !moveDest || moveLoading) : (!selectedSubaccount || !moveDest || moveLoading)}
                onClick={handleMove}
                data-testid="button-confirm-move"
              >
                {moveLoading ? <Loader2 size={14} className="spin" /> : "Confirmar"}
              </button>
            </div>
          </div>
        </>
      )}
      {showColumnPicker && (
        <>
          <div className="col-picker-overlay" onClick={() => setShowColumnPicker(false)} />
          <div className="col-picker" data-testid="column-selector">
            {COLUMN_OPTIONS.map((col) => (
              <button
                key={col.key}
                className={`col-option ${visibleColumns.has(col.key) ? "active" : ""}`}
                onClick={() => toggleColumn(col.key)}
                data-testid={`toggle-column-${col.key}`}
              >
                <span className="col-check">{visibleColumns.has(col.key) ? "\u2713" : ""}</span>
                {col.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="tables-topbar">
        <div className="search-bar">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar mesa..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-tables"
          />
        </div>
        {qrPopupTables.length > 0 && !qrPopupDismissed && (
          <div className="qr-notify-bar" data-testid="qr-notify-bar">
            <AlertTriangle size={16} className="qr-bar-icon" />
            <span className="qr-bar-label">Orden QR</span>
            <span className="qr-bar-badge" data-testid="qr-bar-badge">
              {qrPopupTables.reduce((sum, t) => sum + t.count, 0)}
            </span>
            <div className="qr-bar-chips">
              {qrPopupTables.map(t => (
                <button
                  key={t.id}
                  className="qr-bar-chip"
                  onClick={() => navigate(`/tables/${t.id}`)}
                  data-testid={`qr-bar-chip-${t.id}`}
                >
                  {t.name} · {t.count}
                </button>
              ))}
            </div>
            <button
              className="qr-bar-close"
              onClick={() => setQrPopupDismissed(true)}
              data-testid="qr-bar-close"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {!isLoading && activeTables.length > 0 && (
        <div className="host-bar" data-testid="host-availability-bar">
          <div className="host-chip occupied" data-testid="chip-occupied">{occupiedCount} ocupadas</div>
          {reservedCount > 0 && <div className="host-chip reserved" data-testid="chip-reserved">{reservedCount} RES</div>}
          <div className={`host-chip walkin ${freeForWalkins > 3 ? 'good' : freeForWalkins > 0 ? 'tight' : 'full'}`} data-testid="chip-walkin">
            {freeForWalkins > 0 ? `${freeForWalkins} walk-in` : 'Sin espacio walk-in'}
          </div>
        </div>
      )}
      {isLoading ? (
        <div style={{ padding: "0 18px" }}>
          <TablesSkeleton />
        </div>
      ) : tables.length === 0 ? (
        <div className="empty-state">
          No hay mesas configuradas. Configure mesas en Admin.
        </div>
      ) : (
        <div className="tables-scroll">
          {quickSales.length > 0 && (
            <>
              <div className="section-label text-center">
                <Zap size={14} style={{ display: "inline", marginRight: 4, color: "var(--green)" }} />
                Ventas Rápidas
                <span className="section-count">{quickSales.length}</span>
              </div>
              <div className="tables-grid stagger-children">
                {quickSales.map(qs => {
                  const badge = getTableBadge(qs);
                  const statusCls = getTableStatusClass(qs);
                  return (
                    <Link
                      key={`qs-${qs.orderId}`}
                      href={`/tables/quick/${qs.orderId}`}
                      className={`table-card ${statusCls}`}
                      data-testid={`card-quick-sale-${qs.orderId}`}
                    >
                      <div className="tc-name" data-testid={`text-qs-name-${qs.orderId}`}>
                        {qs.tableName}
                        {qs.dailyNumber && <span className="tc-order-num"> #{qs.dailyNumber}</span>}
                      </div>
                      <div className={badge.cls}>{badge.label}</div>
                      <div className="tc-meta">
                        {visibleColumns.has("waiter") && qs.responsibleWaiterName && (
                          <div className="tc-meta-row"><User size={11} /><span className="val">{qs.responsibleWaiterName}</span></div>
                        )}
                        {visibleColumns.has("items") && (
                          <div className="tc-meta-row"><UtensilsCrossed size={11} /><span className="val">{qs.itemCount} items</span></div>
                        )}
                        {visibleColumns.has("time") && (
                          <div className="tc-meta-row"><Clock size={11} /><span className="val">{formatElapsed(qs.openedAt)}</span></div>
                        )}
                        {visibleColumns.has("amount") && qs.totalAmount && (
                          <div className="tc-amount"><DollarSign size={11} /><span className="val">{formatCurrency(qs.totalAmount)}</span></div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          <div className="section-label text-center">
            Con cuenta abierta
            <span className="section-count">{withOrder.length}</span>
          </div>

          {withOrder.length > 0 ? (
            <div className="tables-grid stagger-children">
              {withOrder.map(table => {
                const badge = getTableBadge(table);
                const statusCls = getTableStatusClass(table);
                const resSoon = table.upcomingReservation && table.upcomingReservation.minutesUntil <= 60;
                const resCardCls = resSoon ? " has-reservation-soon" : "";
                return (
                  <Link key={table.id} href={`/tables/${table.id}`} className={`table-card ${statusCls}${resCardCls}`} data-testid={`card-table-${table.id}`}>
                    {table.hasActiveReservation && <div className="res-tag" data-testid={`tag-res-${table.id}`}>RES</div>}
                    {table.pendingQrCount > 0 && (
                      <div className="qr-alert">{table.pendingQrCount}</div>
                    )}
                    <div className="tc-name" data-testid={`text-table-name-${table.id}`}>
                      {table.tableName}
                      {table.dailyNumber && <span className="tc-order-num"> #{table.dailyNumber}</span>}
                    </div>
                    <div className={badge.cls} data-testid={`badge-status-${table.id}`}>{badge.label}</div>
                    {table.upcomingReservation && (
                      <div className={`reservation-badge ${table.upcomingReservation.minutesUntil <= 60 ? 'soon' : 'later'}`} data-testid={`badge-reservation-${table.id}`}>
                        {table.upcomingReservation.minutesUntil <= 60 ? <Bell size={10} /> : <CalendarDays size={10} />}
                        {table.upcomingReservation.reservedTime.slice(0, 5)} — {table.upcomingReservation.guestName.split(' ')[0]}
                      </div>
                    )}
                    <div className="tc-meta">
                      {visibleColumns.has("waiter") && table.responsibleWaiterName && (
                        <div className="tc-meta-row" data-testid={`text-waiter-${table.id}`}>
                          <User size={11} />
                          <span className="val">{table.responsibleWaiterName}</span>
                        </div>
                      )}
                      {table.subaccountNames && table.subaccountNames.length > 0 && (
                        <div className="tc-meta-row" data-testid={`text-subaccounts-${table.id}`} style={{ fontSize: 12, color: "var(--text-secondary, #888)", fontStyle: "italic" }}>
                          <span className="val">{table.subaccountNames.join(", ")}</span>
                        </div>
                      )}
                      {visibleColumns.has("items") && (
                        <div className="tc-meta-row" data-testid={`text-items-${table.id}`}>
                          <UtensilsCrossed size={11} />
                          <span className="val">{table.itemCount} items</span>
                        </div>
                      )}
                      {visibleColumns.has("time") && (
                        <div className="tc-meta-row" data-testid={`text-time-open-${table.id}`}>
                          <Clock size={11} />
                          <span className="val">{formatElapsed(table.openedAt)}</span>
                        </div>
                      )}
                      {visibleColumns.has("amount") && table.totalAmount && (
                        <div className="tc-amount" data-testid={`text-amount-${table.id}`}>
                          <DollarSign size={11} />
                          <span className="val">{formatCurrency(table.totalAmount)}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">Ninguna mesa con cuenta</div>
          )}

          <div className="section-label text-center">
            Libres
            <span className="section-count">{withoutOrder.length}</span>
          </div>

          {withoutOrder.length > 0 ? (
            <div className="tables-free-grid stagger-children">
              {withoutOrder.map(table => (
                <Link key={table.id} href={`/tables/${table.id}`} className={`table-card-free${table.upcomingReservation && table.upcomingReservation.minutesUntil <= 60 ? ' has-reservation-soon' : ''}`} style={{ position: 'relative' }} data-testid={`card-table-${table.id}`}>
                  {table.hasActiveReservation && <div className="res-tag" data-testid={`tag-res-${table.id}`}>RES</div>}
                  {table.pendingQrCount > 0 && (
                    <div className="qr-alert">{table.pendingQrCount}</div>
                  )}
                  <div className="tcf-name" data-testid={`text-table-name-${table.id}`}>{table.tableName}</div>
                  {table.upcomingReservation ? (
                    <div className={`reservation-badge ${table.upcomingReservation.minutesUntil <= 60 ? 'soon' : 'later'}`} style={{ fontSize: 9, marginTop: 2 }} data-testid={`badge-reservation-${table.id}`}>
                      {table.upcomingReservation.minutesUntil <= 60 ? <Bell size={9} /> : <CalendarDays size={9} />}
                      {table.upcomingReservation.reservedTime.slice(0, 5)}
                    </div>
                  ) : (
                    <div className="tcf-sub">Libre</div>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">Todas las mesas tienen cuenta</div>
          )}
        </div>
      )}
    </div>
  );
}
