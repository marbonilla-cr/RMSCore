import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { wsManager } from "@/lib/ws";
import {
  ArrowLeft, Plus, Send, Check, Trash2, Loader2,
  ShoppingBag, AlertCircle, ChefHat, Minus, Search, X,
  ClipboardList, Ban, ChevronDown, ChevronRight, Clock, Eye,
  Settings2, Receipt, Split, ArrowRight,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Product, Category } from "@shared/schema";
import { printReceipt } from "@/lib/print-receipt";

interface ModifierOption {
  id: number;
  groupId: number;
  name: string;
  priceDelta: string;
  active: boolean;
  sortOrder: number;
}

interface ModifierGroupWithOptions {
  id: number;
  name: string;
  required: boolean;
  multiSelect: boolean;
  minSelections: number;
  maxSelections: number | null;
  options: ModifierOption[];
}

interface CartModifier {
  optionId: number;
  name: string;
  priceDelta: string;
  qty: number;
}

interface CartItem {
  productId: number;
  name: string;
  price: string;
  qty: number;
  notes: string;
  modifiers: CartModifier[];
  cartKey: string;
}

interface TableCurrentView {
  table: any;
  activeOrder: any;
  orderItems: any[];
  pendingQrSubmissions: any[];
  voidedItems?: any[];
}

type ViewMode = "order" | "menu" | "cart" | "split";

interface SplitAccount {
  id: number;
  orderId: number;
  label: string;
  items: { id: number; splitId: number; orderItemId: number }[];
}

export default function TableDetailPage() {
  const [, params] = useRoute("/tables/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const tableId = params?.id ? parseInt(params.id) : 0;

  const [viewMode, setViewMode] = useState<ViewMode>("order");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);
  const [badgePop, setBadgePop] = useState(false);
  const [voidDialogItem, setVoidDialogItem] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidQty, setVoidQty] = useState(1);
  const [showVoidedSection, setShowVoidedSection] = useState(false);
  const [modifierDialogProduct, setModifierDialogProduct] = useState<Product | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroupWithOptions[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<Record<number, number[]>>({});
  const [loadingModifiers, setLoadingModifiers] = useState(false);
  const [pendingClickEvent, setPendingClickEvent] = useState<HTMLElement | null>(null);
  const [splitSelectedItems, setSplitSelectedItems] = useState<Set<number>>(new Set());
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<number | null>(null);
  const [splitAccounts, setSplitAccounts] = useState<SplitAccount[]>([]);
  const [activeSplitId, setActiveSplitId] = useState<number | null>(null);
  const [splitLoading, setSplitLoading] = useState(false);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const isManager = user?.role === "MANAGER";
  const [subaccountFilter, setSubaccountFilter] = useState<string>("all");
  const [expandedSubaccounts, setExpandedSubaccounts] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!tableId) return;
    try {
      const saved = localStorage.getItem(`cart_table_${tableId}`);
      if (saved) {
        const parsed = JSON.parse(saved) as CartItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setCart(parsed);
        }
      }
    } catch {}
  }, [tableId]);

  useEffect(() => {
    if (!tableId) return;
    if (cart.length > 0) {
      localStorage.setItem(`cart_table_${tableId}`, JSON.stringify(cart));
    } else {
      localStorage.removeItem(`cart_table_${tableId}`);
    }
  }, [cart, tableId]);

  const { data: currentView, isLoading: isLoadingCurrent } = useQuery<TableCurrentView>({
    queryKey: ["/api/tables", tableId, "current"],
    enabled: !!tableId,
    refetchInterval: 5000,
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/waiter/menu"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/waiter/categories"],
  });

  const { data: businessCfg } = useQuery<any>({
    queryKey: ["/api/business-config"],
  });

  useEffect(() => {
    wsManager.connect();
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
    };
    const unsubs = [
      wsManager.on("order_updated", (p: any) => {
        if (!p.tableId || p.tableId === tableId) invalidate();
      }),
      wsManager.on("qr_submission_created", (p: any) => {
        if (p.tableId === tableId) {
          invalidate();
          toast({ title: "Nuevo pedido QR", description: p.tableName ? `Pedido recibido en ${p.tableName}` : "Un cliente ha enviado un pedido desde QR" });
        }
      }),
      wsManager.on("kitchen_item_status_changed", invalidate),
      wsManager.on("payment_completed", (p: any) => {
        invalidate();
      }),
      wsManager.on("payment_voided", (p: any) => {
        invalidate();
      }),
      wsManager.on("table_status_changed", (p: any) => {
        if (!p.tableId || p.tableId === tableId) invalidate();
      }),
      wsManager.on("qr_submission", (p: any) => {
        if (p.tableId === tableId) {
          invalidate();
          try { new Audio("/notification.mp3").play().catch(() => {}); } catch {}
          toast({ title: "Nueva orden QR", description: `Mesa ${currentView?.table?.tableName || tableId}` });
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [tableId, toast]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const sendRoundMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/waiter/tables/${tableId}/send-round`, { items: cart });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      localStorage.removeItem(`cart_table_${tableId}`);
      setCart([]);
      setViewMode("order");
      toast({ title: "Ronda enviada a cocina" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const acceptSubmissionMutation = useMutation({
    mutationFn: async (submissionId: number) => {
      const res = await apiRequest("POST", `/api/waiter/qr-submissions/${submissionId}/accept-v2`);
      return res.json();
    },
    onSuccess: (data: any) => {
      setExpandedSubmissionId(null);
      if (data.activeOrder) {
        queryClient.setQueryData(["/api/tables", tableId, "current"], {
          table: data.table || currentView?.table,
          activeOrder: data.activeOrder,
          orderItems: data.orderItems || [],
          pendingQrSubmissions: data.pendingQrSubmissions || [],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      toast({ title: "Pedido QR aceptado y enviado a cocina" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const acceptAllMutation = useMutation({
    mutationFn: async (submissionIds: number[]) => {
      for (const id of submissionIds) {
        await apiRequest("POST", `/api/waiter/qr-submissions/${id}/accept-v2`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      toast({ title: "Todos los pedidos QR aceptados y enviados a cocina" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const voidItemMutation = useMutation({
    mutationFn: async ({ orderId, itemId, reason, qtyToVoid: qty }: { orderId: number; itemId: number; reason: string; qtyToVoid: number }) => {
      return apiRequest("POST", `/api/waiter/orders/${orderId}/items/${itemId}/void`, { reason, qtyToVoid: qty });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setVoidDialogItem(null);
      setVoidReason("");
      setVoidQty(1);
      toast({ title: "Ítem anulado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const hardDeleteMutation = useMutation({
    mutationFn: async ({ orderId, itemId }: { orderId: number; itemId: number }) => {
      return apiRequest("DELETE", `/api/waiter/orders/${orderId}/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      toast({ title: "Ítem eliminado definitivamente" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const triggerFlyAnimation = useCallback((sourceEl: HTMLElement) => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    setBadgePop(true);
    setTimeout(() => setBadgePop(false), 350);

    if (prefersReduced || !badgeRef.current) return;

    const sourceRect = sourceEl.getBoundingClientRect();
    const targetRect = badgeRef.current.getBoundingClientRect();

    const ghost = document.createElement("div");
    ghost.style.cssText = `
      position:fixed;z-index:9999;pointer-events:none;
      width:40px;height:40px;border-radius:50%;
      background:hsl(var(--primary));opacity:0.85;
      left:${sourceRect.left + sourceRect.width / 2 - 20}px;
      top:${sourceRect.top + sourceRect.height / 2 - 20}px;
    `;
    document.body.appendChild(ghost);

    const dx = (targetRect.left + targetRect.width / 2 - 20) - (sourceRect.left + sourceRect.width / 2 - 20);
    const dy = (targetRect.top + targetRect.height / 2 - 20) - (sourceRect.top + sourceRect.height / 2 - 20);

    ghost.animate([
      { transform: "translate(0, 0) scale(1)", opacity: 0.85 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.2 },
    ], { duration: 300, easing: "ease-in", fill: "forwards" });

    setTimeout(() => ghost.remove(), 320);
  }, []);

  const makeCartKey = (productId: number, modifiers: CartModifier[]) => {
    const modStr = modifiers.map(m => m.optionId).sort().join(",");
    return `${productId}:${modStr}`;
  };

  const addToCart = async (product: Product, e?: React.MouseEvent) => {
    const clickEl = e?.currentTarget as HTMLElement | undefined;
    setLoadingModifiers(true);
    try {
      const res = await fetch(`/api/products/${product.id}/modifiers`);
      const groups: ModifierGroupWithOptions[] = await res.json();
      if (groups.length > 0) {
        setModifierDialogProduct(product);
        setModifierGroups(groups);
        setSelectedModifiers({});
        setPendingClickEvent(clickEl || null);
        setLoadingModifiers(false);
        return;
      }
    } catch {
    }
    setLoadingModifiers(false);

    const key = makeCartKey(product.id, []);
    const existing = cart.find((c) => c.cartKey === key);
    if (existing) {
      setCart(cart.map((c) => (c.cartKey === key ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, qty: 1, notes: "", modifiers: [], cartKey: key }]);
    }
    if (clickEl) {
      triggerFlyAnimation(clickEl);
    }
  };

  const confirmModifierSelection = () => {
    if (!modifierDialogProduct) return;
    const product = modifierDialogProduct;
    for (const group of modifierGroups) {
      const selected = selectedModifiers[group.id] || [];
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
    const mods: CartModifier[] = [];
    for (const group of modifierGroups) {
      const selected = selectedModifiers[group.id] || [];
      for (const optId of selected) {
        const opt = group.options.find(o => o.id === optId);
        if (opt) {
          mods.push({ optionId: opt.id, name: opt.name, priceDelta: opt.priceDelta, qty: 1 });
        }
      }
    }
    const key = makeCartKey(product.id, mods);
    const existing = cart.find((c) => c.cartKey === key);
    if (existing) {
      setCart(cart.map((c) => (c.cartKey === key ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, qty: 1, notes: "", modifiers: mods, cartKey: key }]);
    }
    if (pendingClickEvent) {
      triggerFlyAnimation(pendingClickEvent);
    }
    setModifierDialogProduct(null);
    setModifierGroups([]);
    setSelectedModifiers({});
    setPendingClickEvent(null);
  };

  const toggleModifierOption = (groupId: number, optionId: number, multiSelect: boolean) => {
    setSelectedModifiers(prev => {
      const current = prev[groupId] || [];
      if (multiSelect) {
        if (current.includes(optionId)) {
          return { ...prev, [groupId]: current.filter(id => id !== optionId) };
        }
        return { ...prev, [groupId]: [...current, optionId] };
      } else {
        return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
      }
    });
  };

  const removeFromCart = (cartKey: string) => {
    setCart(cart.filter((c) => c.cartKey !== cartKey));
  };

  const updateCartQty = (cartKey: string, qty: number) => {
    if (qty <= 0) return removeFromCart(cartKey);
    setCart(cart.map((c) => (c.cartKey === cartKey ? { ...c, qty } : c)));
  };

  const searchLower = debouncedSearch.toLowerCase();
  const isSearching = searchLower.length > 0;

  const filteredProducts = products.filter(
    (p) =>
      p.active &&
      (p.availablePortions === null || p.availablePortions > 0) &&
      (!isSearching ||
        p.name.toLowerCase().includes(searchLower) ||
        p.productCode.toLowerCase().includes(searchLower) ||
        (p.description && p.description.toLowerCase().includes(searchLower)))
  );

  const productsByCategory = filteredProducts.reduce((acc: Record<number | string, Product[]>, p) => {
    const catId = p.categoryId ?? "sin-categoria";
    if (!acc[catId]) acc[catId] = [];
    acc[catId].push(p);
    return acc;
  }, {});

  const sortedCategoryIds = Object.keys(productsByCategory).sort((a, b) => {
    if (a === "sin-categoria") return 1;
    if (b === "sin-categoria") return -1;
    const catA = categories.find((c) => c.id === Number(a));
    const catB = categories.find((c) => c.id === Number(b));
    return (catA?.sortOrder ?? 999) - (catB?.sortOrder ?? 999);
  });

  const orderItems = currentView?.orderItems || [];
  const pendingSubmissions = currentView?.pendingQrSubmissions || [];
  const activeOrder = currentView?.activeOrder;
  const tableData = currentView?.table;
  const voidedItemsList = currentView?.voidedItems || [];

  const { data: orderBySubaccount } = useQuery<any>({
    queryKey: ["/api/waiter/orders", activeOrder?.id, "by-subaccount"],
    enabled: !!activeOrder?.id,
  });

  const groupedItems = orderItems
    .filter((item: any) => item.status !== "VOIDED" && (item.status !== "PENDING" || !item.qrSubmissionId))
    .reduce((acc: Record<number, any[]>, item: any) => {
      const round = item.roundNumber || 1;
      if (!acc[round]) acc[round] = [];
      acc[round].push(item);
      return acc;
    }, {});

  const getItemTotal = (item: CartItem) => {
    const modTotal = item.modifiers.reduce((s, m) => s + Number(m.priceDelta) * m.qty, 0);
    return (Number(item.price) + modTotal) * item.qty;
  };
  const cartTotal = cart.reduce((s, c) => s + getItemTotal(c), 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const lastChips = cart.slice(-5);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING": return <Badge variant="secondary">Pendiente</Badge>;
      case "SENT": return <Badge>En Cocina</Badge>;
      case "PREPARING": return <Badge className="bg-blue-600 dark:bg-blue-700 text-white">Preparando</Badge>;
      case "READY": return <Badge className="bg-green-600 dark:bg-green-700 text-white">Listo</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const loadSplits = async () => {
    if (!activeOrder) return;
    setSplitLoading(true);
    try {
      const res = await fetch(`/api/pos/orders/${activeOrder.id}/splits`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setSplitAccounts(data);
      }
    } catch {} finally {
      setSplitLoading(false);
    }
  };

  const enterSplitMode = () => {
    setViewMode("split");
    setSplitSelectedItems(new Set());
    setActiveSplitId(null);
    loadSplits();
  };

  const createSplitAccount = async () => {
    if (!activeOrder) return;
    setSplitLoading(true);
    try {
      const label = `Subcuenta ${splitAccounts.length + 1}`;
      const res = await apiRequest("POST", `/api/pos/orders/${activeOrder.id}/splits`, { label, orderItemIds: [] });
      const newSplit = await res.json();
      setSplitAccounts([...splitAccounts, newSplit]);
      setActiveSplitId(newSplit.id);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSplitLoading(false);
    }
  };

  const toggleSplitItem = (itemId: number) => {
    const next = new Set(splitSelectedItems);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setSplitSelectedItems(next);
  };

  const moveItemsToSplit = async () => {
    if (!activeSplitId || splitSelectedItems.size === 0) return;
    setSplitLoading(true);
    try {
      await apiRequest("POST", "/api/pos/split-items/move-bulk", {
        orderItemIds: Array.from(splitSelectedItems),
        fromSplitId: null,
        toSplitId: activeSplitId,
      });
      await loadSplits();
      setSplitSelectedItems(new Set());
      toast({ title: "Items movidos a subcuenta" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSplitLoading(false);
    }
  };

  const executeSplit = async () => {
    if (!activeOrder) return;
    const nonEmpty = splitAccounts.filter(s => s.items.length > 0);
    if (nonEmpty.length === 0) {
      toast({ title: "No hay subcuentas con items", variant: "destructive" });
      return;
    }
    setSplitLoading(true);
    try {
      await apiRequest("POST", "/api/pos/split-order", { orderId: activeOrder.id });
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      toast({ title: "Cuenta dividida exitosamente" });
      setViewMode("order");
      setSplitAccounts([]);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSplitLoading(false);
    }
  };

  const returnItemToUnassigned = async (orderItemId: number, fromSplitId: number) => {
    setSplitLoading(true);
    try {
      await apiRequest("POST", "/api/pos/split-items/move-bulk", {
        orderItemIds: [orderItemId],
        fromSplitId,
        toSplitId: null,
      });
      await loadSplits();
      toast({ title: "Item devuelto" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSplitLoading(false);
    }
  };

  const removeSplitAccount = async (splitId: number) => {
    setSplitLoading(true);
    try {
      await apiRequest("DELETE", `/api/pos/splits/${splitId}`);
      setSplitAccounts(splitAccounts.filter(s => s.id !== splitId));
      if (activeSplitId === splitId) setActiveSplitId(null);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSplitLoading(false);
    }
  };

  const assignedItemIds = splitAccounts.flatMap(s => s.items.map(si => si.orderItemId));
  const activeItems = orderItems.filter((i: any) => i.status !== "VOIDED");
  const unassignedItems = activeItems.filter((i: any) => !assignedItemIds.includes(i.id));

  if (isLoadingCurrent) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Button size="icon" variant="ghost" onClick={() => navigate("/tables")} data-testid="button-back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <Skeleton className="h-7 w-36 mb-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-28 w-full mb-3" />
        <Skeleton className="h-20 w-full mb-3" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "100dvh", overscrollBehavior: "contain" }}>
      <div className="sticky top-0 z-[9] bg-background border-b px-3 py-2 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={() => navigate("/tables")} data-testid="button-back">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-tight truncate" data-testid="text-table-name">
            {tableData?.tableName || `Mesa ${tableId}`}
          </h1>
          <p className="text-xs text-muted-foreground">
            {activeOrder ? `Orden #${activeOrder.id}` : "Sin orden abierta"}
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={viewMode === "order" ? "default" : "ghost"}
            onClick={() => setViewMode("order")}
            data-testid="button-view-order"
          >
            <ClipboardList className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Orden</span>
          </Button>
          <Button
            size="sm"
            variant={viewMode === "menu" ? "default" : "ghost"}
            onClick={() => setViewMode("menu")}
            data-testid="button-view-menu"
          >
            <Plus className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Menu</span>
          </Button>
          {activeOrder && activeItems.length > 0 && (
            <Button
              size="sm"
              variant={viewMode === "split" ? "default" : "ghost"}
              onClick={enterSplitMode}
              data-testid="button-view-split"
            >
              <Split className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Dividir</span>
            </Button>
          )}
          {cart.length > 0 && (
            <Button
              size="sm"
              variant={viewMode === "cart" ? "default" : "ghost"}
              onClick={() => setViewMode("cart")}
              data-testid="button-view-cart"
              className="relative"
            >
              <ShoppingBag className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Pedido</span>
              <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full w-5 h-5 flex items-center justify-center">{cartCount}</span>
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: cart.length > 0 && viewMode !== "cart" && viewMode !== "split" ? "140px" : "16px" }}>
        {viewMode === "split" ? (
          <div className="p-3 max-w-lg mx-auto">
            <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
              <Split className="w-5 h-5" /> Dividir Cuenta
            </h2>

            <div className="flex gap-2 mb-3 flex-wrap">
              {splitAccounts.map((sa) => (
                <Button
                  key={sa.id}
                  size="sm"
                  variant={activeSplitId === sa.id ? "default" : "outline"}
                  onClick={() => setActiveSplitId(sa.id)}
                  data-testid={`button-split-tab-${sa.id}`}
                >
                  {sa.label} ({sa.items.length})
                </Button>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={createSplitAccount}
                disabled={splitLoading}
                data-testid="button-create-split"
              >
                <Plus className="w-4 h-4 mr-1" /> Nueva
              </Button>
            </div>

            <Card className="mb-3">
              <CardHeader className="pb-2">
                <h3 className="font-semibold text-sm text-muted-foreground">Items sin asignar ({unassignedItems.length})</h3>
              </CardHeader>
              <CardContent className="space-y-1">
                {unassignedItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">Todos los items asignados</p>
                ) : (
                  unassignedItems.map((item: any) => {
                    const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                    const unitPrice = Number(item.productPriceSnapshot) + modDelta;
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors ${splitSelectedItems.has(item.id) ? "bg-primary/10 ring-1 ring-primary" : "hover-elevate"}`}
                        onClick={() => toggleSplitItem(item.id)}
                        data-testid={`split-item-${item.id}`}
                      >
                        <Checkbox checked={splitSelectedItems.has(item.id)} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{item.qty}x {item.productNameSnapshot}</p>
                          {item.modifiers && item.modifiers.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {item.modifiers.map((m: any) => m.nameSnapshot).join(", ")}
                            </p>
                          )}
                        </div>
                        <span className="text-sm font-medium">₡{(unitPrice * item.qty).toLocaleString()}</span>
                      </div>
                    );
                  })
                )}
                {splitSelectedItems.size > 0 && activeSplitId && (
                  <Button
                    className="w-full mt-2"
                    onClick={moveItemsToSplit}
                    disabled={splitLoading}
                    data-testid="button-move-to-split"
                  >
                    {splitLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ArrowRight className="w-4 h-4 mr-1" />}
                    Mover {splitSelectedItems.size} items a {splitAccounts.find(s => s.id === activeSplitId)?.label}
                  </Button>
                )}
                {splitSelectedItems.size > 0 && !activeSplitId && (
                  <p className="text-xs text-muted-foreground text-center mt-2">Seleccione o cree una subcuenta primero</p>
                )}
              </CardContent>
            </Card>

            {splitAccounts.map((sa) => {
              const splitItems = sa.items.map(si => activeItems.find((i: any) => i.id === si.orderItemId)).filter(Boolean);
              const splitTotal = splitItems.reduce((sum: number, item: any) => {
                const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                return sum + (Number(item.productPriceSnapshot) + modDelta) * item.qty;
              }, 0);
              return (
                <Card key={sa.id} className={`mb-2 ${activeSplitId === sa.id ? "ring-1 ring-primary" : ""}`} data-testid={`split-account-${sa.id}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm">{sa.label}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">₡{splitTotal.toLocaleString()}</span>
                        <Button size="icon" variant="ghost" onClick={() => removeSplitAccount(sa.id)} data-testid={`button-remove-split-${sa.id}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {splitItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-1">Sin items</p>
                    ) : (
                      splitItems.map((item: any) => {
                        const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                        const unitPrice = Number(item.productPriceSnapshot) + modDelta;
                        return (
                          <div key={item.id} className="flex items-center justify-between py-1 text-sm gap-1" data-testid={`split-assigned-item-${item.id}`}>
                            <span className="flex-1 min-w-0 truncate">{item.qty}x {item.productNameSnapshot}</span>
                            <span className="flex-shrink-0">₡{(unitPrice * item.qty).toLocaleString()}</span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="flex-shrink-0"
                              onClick={() => returnItemToUnassigned(item.id, sa.id)}
                              disabled={splitLoading}
                              data-testid={`button-return-item-${item.id}`}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        );
                      })
                    )}
                  </CardContent>
                </Card>
              );
            })}

            <div className="flex gap-2 mt-4 pb-4">
              <Button variant="outline" className="flex-1" onClick={() => setViewMode("order")} data-testid="button-cancel-split">
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={executeSplit}
                disabled={splitLoading || splitAccounts.filter(s => s.items.length > 0).length === 0}
                data-testid="button-execute-split"
              >
                {splitLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
                Confirmar División
              </Button>
            </div>
          </div>
        ) : viewMode === "cart" ? (
          <div className="p-3 max-w-lg mx-auto">
            <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
              <ShoppingBag className="w-5 h-5" /> Nueva Ronda ({cartCount} items)
            </h2>
            <div className="space-y-2">
              {cart.map((item) => (
                <Card key={item.cartKey} data-testid={`cart-item-${item.cartKey}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">₡{Number(item.price).toLocaleString()} c/u</p>
                        {item.modifiers.length > 0 && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <Settings2 className="w-3 h-3 inline mr-1" />
                            {item.modifiers.map(m => m.name + (Number(m.priceDelta) > 0 ? ` +₡${Number(m.priceDelta).toLocaleString()}` : "")).join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="icon" variant="outline" onClick={() => updateCartQty(item.cartKey, item.qty - 1)} data-testid={`button-qty-minus-${item.cartKey}`}>
                          <Minus className="w-4 h-4" />
                        </Button>
                        <span className="w-8 text-center text-base font-bold">{item.qty}</span>
                        <Button size="icon" variant="outline" onClick={() => updateCartQty(item.cartKey, item.qty + 1)} data-testid={`button-qty-plus-${item.cartKey}`}>
                          <Plus className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => removeFromCart(item.cartKey)} data-testid={`button-remove-${item.cartKey}`}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <Input
                      placeholder="Notas..."
                      value={item.notes}
                      onChange={(e) =>
                        setCart(cart.map((c) => (c.cartKey === item.cartKey ? { ...c, notes: e.target.value } : c)))
                      }
                      className="mt-2 text-sm min-h-[40px]"
                      data-testid={`input-notes-${item.cartKey}`}
                    />
                    <p className="text-right text-sm font-semibold mt-1">₡{getItemTotal(item).toLocaleString()}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="flex items-center justify-between pt-4 pb-2 font-bold text-lg">
              <span>Total</span>
              <span>₡{cartTotal.toLocaleString()}</span>
            </div>
            <div className="flex gap-2 pb-4">
              <Button
                variant="ghost"
                className="min-h-[48px]"
                onClick={() => {
                  setCart([]);
                  localStorage.removeItem(`cart_table_${tableId}`);
                  setViewMode("menu");
                }}
                data-testid="button-clear-cart"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                className="flex-1 min-h-[48px] text-base"
                onClick={() => setViewMode("menu")}
                data-testid="button-back-to-menu"
              >
                <Plus className="w-5 h-5 mr-2" /> Agregar Más
              </Button>
              <Button
                className="flex-1 min-h-[48px] text-base"
                onClick={() => sendRoundMutation.mutate()}
                disabled={sendRoundMutation.isPending}
                data-testid="button-send-round-cart"
              >
                {sendRoundMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Send className="w-5 h-5 mr-2" />}
                Enviar a Cocina
              </Button>
            </div>
          </div>
        ) : viewMode === "order" ? (
          <div className="p-3 max-w-lg mx-auto space-y-3">
            {pendingSubmissions.length > 0 && (
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-orange-500" />
                    <h2 className="font-bold text-base" data-testid="text-pending-qr-title">Solicitudes QR pendientes</h2>
                  </div>
                  <Badge variant="secondary">{pendingSubmissions.length}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  {pendingSubmissions.map((sub: any) => {
                    const rawPayload = sub.payloadSnapshot || sub.payload_snapshot;
                    const payloadItems = rawPayload?.items || (Array.isArray(rawPayload) ? rawPayload : []);
                    const firstItem = payloadItems[0] || null;
                    const customerName = firstItem?.customerName || "Cliente";
                    const createdAt = sub.createdAt ? new Date(sub.createdAt) : new Date();
                    const timeStr = createdAt.toLocaleTimeString("es-CR", { hour: "numeric", minute: "2-digit", hour12: true });
                    const isExpanded = expandedSubmissionId === sub.id;
                    
                    return (
                      <div key={sub.id} className="border rounded-md p-3" data-testid={`pending-submission-${sub.id}`}>
                        <div
                          className="flex items-start justify-between gap-2 cursor-pointer"
                          onClick={() => setExpandedSubmissionId(isExpanded ? null : sub.id)}
                          data-testid={`button-toggle-qr-${sub.id}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm text-muted-foreground">{timeStr}</span>
                              <span className="font-medium">{customerName}</span>
                              <Badge variant="secondary">{payloadItems.length} {payloadItems.length === 1 ? "item" : "items"}</Badge>
                            </div>
                          </div>
                          <ChevronRight className={`w-5 h-5 text-muted-foreground transition-transform shrink-0 ${isExpanded ? "rotate-90" : ""}`} />
                        </div>
                        {isExpanded && (
                          <div className="mt-3 space-y-3">
                            <div className="space-y-1 pl-1">
                              {payloadItems.map((item: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between text-sm py-1 border-b last:border-b-0">
                                  <span>{item.qty}x {item.productName || `Producto #${item.productId}`}</span>
                                </div>
                              ))}
                            </div>
                            <Button
                              className="w-full"
                              onClick={() => acceptSubmissionMutation.mutate(sub.id)}
                              disabled={acceptSubmissionMutation.isPending}
                              data-testid={`button-accept-qr-${sub.id}`}
                            >
                              {acceptSubmissionMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                              Enviar a cocina
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {pendingSubmissions.length > 1 && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => acceptAllMutation.mutate(pendingSubmissions.map((s: any) => s.id))}
                      disabled={acceptAllMutation.isPending}
                      data-testid="button-accept-all-qr"
                    >
                      {acceptAllMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                      Aceptar todas
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {Object.keys(groupedItems).length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <h2 className="font-bold flex items-center gap-2 text-base">
                    <ChefHat className="w-5 h-5" /> Items de la Orden
                  </h2>
                </CardHeader>
                <CardContent>
                  {Object.entries(groupedItems)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([round, items]) => (
                      <div key={round} className="mb-4 last:mb-0">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          Ronda {round} {(items as any[])[0]?.origin === "QR" ? "(QR)" : ""}
                        </p>
                        {(items as any[]).map((item: any) => (
                          <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0 gap-2" data-testid={`order-item-${item.id}`}>
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-medium">{item.qty}x {item.productNameSnapshot}</p>
                              {item.modifiers && item.modifiers.length > 0 && (
                                <p className="text-xs text-muted-foreground">
                                  {item.modifiers.map((m: any) => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")}
                                </p>
                              )}
                              {item.notes && !(item.modifiers && item.modifiers.length > 0) && <p className="text-sm text-muted-foreground">{item.notes}</p>}
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-sm">₡{Number((Number(item.productPriceSnapshot) + (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0)) * item.qty).toLocaleString()}</span>
                              {getStatusBadge(item.status)}
                              {activeOrder?.status !== "PAID" && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive"
                                  onClick={() => { setVoidDialogItem(item); setVoidReason(""); setVoidQty(item.qty); }}
                                  data-testid={`button-void-item-${item.id}`}
                                >
                                  <Ban className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  {activeOrder?.totalAmount && (
                    <div className="pt-3 border-t mt-3 space-y-2">
                      <div className="flex items-center justify-between font-bold text-base">
                        <span>Total</span>
                        <span>₡{Number(activeOrder.totalAmount).toLocaleString()}</span>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          const cfg = businessCfg || {};
                          const allItems = orderItems.filter((i: any) => i.status !== "VOIDED");
                          const grouped = new Map<string, { name: string; qty: number; price: number; total: number }>();
                          for (const item of allItems) {
                            const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                            const modLabel = (item.modifiers && item.modifiers.length > 0) ? ` (${item.modifiers.map((m: any) => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +₡${Number(m.priceDeltaSnapshot).toLocaleString()}` : "")).join(", ")})` : "";
                            const unitPrice = Number(item.productPriceSnapshot) + modDelta;
                            const modSig = (item.modifiers || []).map((m: any) => `${m.nameSnapshot}:${m.priceDeltaSnapshot}`).sort().join("|");
                            const key = `${item.productNameSnapshot}::${item.productPriceSnapshot}::${modSig}`;
                            const existing = grouped.get(key);
                            if (existing) {
                              existing.qty += item.qty;
                              existing.total += unitPrice * item.qty;
                            } else {
                              grouped.set(key, { name: item.productNameSnapshot + modLabel, qty: item.qty, price: unitPrice, total: unitPrice * item.qty });
                            }
                          }
                          const receiptItems = Array.from(grouped.values());
                          const orderNum = activeOrder.globalNumber ? `G-${activeOrder.globalNumber}` : (activeOrder.dailyNumber ? `D-${activeOrder.dailyNumber}` : `#${activeOrder.id}`);
                          printReceipt({
                            businessName: cfg.businessName || "",
                            legalName: cfg.legalName || "",
                            taxId: cfg.taxId || "",
                            address: cfg.address || "",
                            phone: cfg.phone || "",
                            email: cfg.email || "",
                            legalNote: cfg.legalNote || "",
                            orderNumber: orderNum,
                            tableName: currentView?.table?.tableName || "",
                            items: receiptItems,
                            totalAmount: Number(activeOrder.totalAmount),
                            totalDiscounts: Number(activeOrder.totalDiscounts || 0),
                            totalTaxes: Number(activeOrder.totalTaxes || 0),
                            taxBreakdown: activeOrder.taxBreakdown || [],
                            paymentMethod: "PRE-CUENTA",
                            date: new Date().toLocaleString("es-CR"),
                          });
                        }}
                        data-testid="button-pre-cuenta"
                      >
                        <Receipt className="w-4 h-4 mr-1" /> Pre-cuenta
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {orderBySubaccount && orderBySubaccount.groups && orderBySubaccount.groups.length > 0 && (
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
                  <h2 className="font-bold flex items-center gap-2 text-base">
                    <Split className="w-5 h-5" /> Orden actual por subcuenta
                  </h2>
                  <select
                    className="text-sm border rounded-md px-2 py-1 bg-background"
                    value={subaccountFilter}
                    onChange={(e) => setSubaccountFilter(e.target.value)}
                    data-testid="select-subaccount-filter"
                  >
                    <option value="all">Todas las subcuentas</option>
                    {orderBySubaccount.groups.map((g: any) => (
                      <option key={g.subaccount?.id || 'none'} value={g.subaccount?.code || 'none'}>
                        Mesa {g.subaccount?.code || 'Sin subcuenta'}
                      </option>
                    ))}
                  </select>
                </CardHeader>
                <CardContent className="space-y-2">
                  {orderBySubaccount.groups
                    .filter((g: any) => subaccountFilter === "all" || (g.subaccount?.code || 'none') === subaccountFilter)
                    .map((group: any) => {
                      const subCode = group.subaccount?.code || "Sin subcuenta";
                      const subKey = subCode;
                      const isExpanded = expandedSubaccounts.has(subKey);
                      const toggleExpanded = () => {
                        setExpandedSubaccounts(prev => {
                          const next = new Set(prev);
                          if (next.has(subKey)) next.delete(subKey);
                          else next.add(subKey);
                          return next;
                        });
                      };
                      const items = group.items || [];
                      const itemCount = items.length;
                      const subtotal = items.reduce((s: number, i: any) => {
                        const modDelta = (i.modifiers || []).reduce((ms: number, m: any) => ms + Number(m.priceDeltaSnapshot || 0), 0);
                        return s + (Number(i.productPriceSnapshot) + modDelta) * i.qty;
                      }, 0);

                      return (
                        <div key={subKey} className="border rounded-md" data-testid={`subaccount-group-${subKey}`}>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between p-3 text-left hover-elevate rounded-md"
                            onClick={toggleExpanded}
                            data-testid={`button-toggle-subaccount-${subKey}`}
                          >
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              <span className="font-bold">Mesa {subCode}</span>
                              <span className="text-sm text-muted-foreground">{itemCount} items</span>
                            </div>
                            <span className="font-medium">₡{subtotal.toLocaleString()}</span>
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2">
                              {items.map((item: any) => (
                                <div key={item.id} className="flex items-center justify-between py-1 text-sm border-b last:border-0" data-testid={`subaccount-item-${item.id}`}>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium">
                                      {item.customerNameSnapshot ? `${item.customerNameSnapshot} pidio. ` : ""}{item.productNameSnapshot}
                                    </p>
                                    {item.modifiers && item.modifiers.length > 0 && (
                                      <p className="text-xs text-muted-foreground">
                                        + {item.modifiers.map((m: any) => m.nameSnapshot).join(", ")}
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <span className="text-muted-foreground">Qty: {item.qty}</span>
                                    {getStatusBadge(item.status)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </CardContent>
              </Card>
            )}

            {voidedItemsList.length > 0 && (
              <Card className="border-dashed">
                <CardHeader className="pb-2">
                  <button
                    className="flex items-center gap-2 w-full text-left"
                    onClick={() => setShowVoidedSection(!showVoidedSection)}
                    data-testid="button-toggle-voided"
                  >
                    {showVoidedSection ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <h2 className="font-bold text-base text-muted-foreground">
                      Anulaciones ({voidedItemsList.length})
                    </h2>
                  </button>
                </CardHeader>
                {showVoidedSection && (
                  <CardContent>
                    {voidedItemsList.map((vi: any) => (
                      <div key={vi.id} className="py-2 border-b last:border-0" data-testid={`voided-item-${vi.id}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-base line-through text-muted-foreground">{vi.qtyVoided}x {vi.productNameSnapshot}</p>
                            {vi.notes && <p className="text-xs text-muted-foreground italic">{vi.notes}</p>}
                            {vi.voidReason && <p className="text-xs text-muted-foreground">Motivo: {vi.voidReason}</p>}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-sm text-muted-foreground line-through">
                              ₡{Number(Number(vi.unitPriceSnapshot) * vi.qtyVoided).toLocaleString()}
                            </span>
                            <Badge variant="secondary">Anulado</Badge>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" />
                          <span>{vi.voidedByName}</span>
                          <span>{vi.voidedAt ? new Date(vi.voidedAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                        </div>
                        {isManager && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive mt-1"
                            onClick={() => {
                              if (confirm("Eliminar definitivamente este ítem? Esta acción no se puede deshacer.")) {
                                hardDeleteMutation.mutate({ orderId: vi.orderId, itemId: vi.orderItemId });
                              }
                            }}
                            data-testid={`button-hard-delete-${vi.id}`}
                          >
                            <Trash2 className="w-3 h-3 mr-1" /> Eliminar definitivo
                          </Button>
                        )}
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )}

            {Object.keys(groupedItems).length === 0 && pendingSubmissions.length === 0 && voidedItemsList.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-base">No hay items en la orden</p>
                <Button variant="outline" className="mt-4 min-h-[44px] text-base" onClick={() => setViewMode("menu")} data-testid="button-start-adding">
                  <Plus className="w-5 h-5 mr-2" /> Agregar Items
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col max-w-lg mx-auto h-full">
            <div className="sticky top-0 z-[9] bg-background px-3 pt-2 pb-2 border-b" style={{ paddingTop: "max(8px, env(safe-area-inset-top, 8px))" }}>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar ítems..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-9 min-h-[44px] text-base"
                  data-testid="input-search-menu"
                  aria-label="Buscar ítems en el menú"
                />
                {searchTerm && (
                  <button
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => { setSearchTerm(""); setDebouncedSearch(""); }}
                    data-testid="button-clear-search"
                    aria-label="Limpiar búsqueda"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="px-3 pb-4">
              <div className="space-y-1 mt-2">
                {sortedCategoryIds.map((catId) => {
                  const catName = catId === "sin-categoria"
                    ? "Sin Categoría"
                    : categories.find((c) => c.id === Number(catId))?.name || "Categoría";
                  const items = productsByCategory[catId];
                  const isExpanded = isSearching || expandedCategoryId === catId;

                  const toggleCategory = () => {
                    if (isSearching) return;
                    setExpandedCategoryId(expandedCategoryId === catId ? null : catId);
                  };

                  return (
                    <div key={catId} data-testid={`category-group-${catId}`}>
                      <button
                        className="w-full flex items-center justify-between gap-2 px-3 py-3 rounded-md hover-elevate min-h-[48px] text-left"
                        onClick={toggleCategory}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Colapsar" : "Expandir"} categoría ${catName}`}
                        data-testid={`button-toggle-category-${catId}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                            : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                          <span className="font-semibold text-base truncate" data-testid={`text-category-${catId}`}>{catName}</span>
                        </div>
                        <Badge variant="secondary">{items.length}</Badge>
                      </button>

                      {isExpanded && (
                        <div className="space-y-1.5 pb-2 pt-1">
                          {items.map((p) => {
                            const inCartQty = cart.filter(c => c.productId === p.id).reduce((s, c) => s + c.qty, 0);
                            return (
                              <div
                                key={p.id}
                                className="flex items-center justify-between p-3 rounded-md border hover-elevate cursor-pointer active:scale-[0.98] transition-transform duration-100 min-h-[56px]"
                                onClick={(e) => addToCart(p, e)}
                                data-testid={`menu-item-${p.id}`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-base leading-tight">{p.name}</p>
                                  {p.description && <p className="text-sm text-muted-foreground truncate">{p.description}</p>}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span className="font-semibold text-base">₡{Number(p.price).toLocaleString()}</span>
                                  {p.availablePortions !== null && (
                                    <Badge variant="secondary">{p.availablePortions}</Badge>
                                  )}
                                  {inCartQty > 0 && (
                                    <Badge className="bg-primary text-primary-foreground min-w-[24px] text-center">{inCartQty}</Badge>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {sortedCategoryIds.length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-base">Sin resultados para "{debouncedSearch}"</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {cart.length > 0 && viewMode !== "cart" && (
        <div
          ref={bottomBarRef}
          className="fixed bottom-0 left-0 right-0 z-[9] bg-card border-t"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          data-testid="bottom-order-bar"
        >
          <div className="max-w-lg mx-auto px-3 py-2 space-y-2">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
              {lastChips.map((item) => (
                <span
                  key={item.cartKey}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-sm whitespace-nowrap flex-shrink-0"
                  data-testid={`chip-item-${item.cartKey}`}
                >
                  {item.name.length > 12 ? item.name.slice(0, 12) + "…" : item.name}
                  {item.modifiers.length > 0 && <Settings2 className="w-3 h-3" />}
                  <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-xs">{item.qty}</Badge>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span
                ref={badgeRef}
                className={`inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary text-primary-foreground font-bold text-base transition-transform duration-200 ${badgePop ? "scale-[1.2]" : "scale-100"}`}
                data-testid="badge-cart-count"
              >
                {cartCount}
              </span>
              <span className="font-bold text-lg flex-1">
                ₡{cartTotal.toLocaleString()}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => { setCart([]); localStorage.removeItem(`cart_table_${tableId}`); }}
                data-testid="button-clear-cart"
              >
                <Trash2 className="w-5 h-5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setViewMode("cart")}
                data-testid="button-view-order-detail"
              >
                <Eye className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                onClick={() => sendRoundMutation.mutate()}
                disabled={sendRoundMutation.isPending}
                data-testid="button-send-round"
              >
                {sendRoundMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </Button>
            </div>
          </div>
        </div>
      )}

      {modifierDialogProduct && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/50" data-testid="modifier-dialog-overlay" onClick={() => { setModifierDialogProduct(null); setModifierGroups([]); setSelectedModifiers({}); setPendingClickEvent(null); }}>
          <Card className="w-full sm:w-[90%] sm:max-w-md mx-0 sm:mx-4 rounded-t-xl sm:rounded-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="pb-2 flex-shrink-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-bold text-base">{modifierDialogProduct.name}</h3>
                <span className="text-sm text-muted-foreground">₡{Number(modifierDialogProduct.price).toLocaleString()}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 overflow-y-auto flex-1">
              {modifierGroups.map((group) => (
                <div key={group.id} data-testid={`modifier-group-${group.id}`}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-semibold text-sm">{group.name}</span>
                    {group.required && <Badge variant="secondary">Requerido</Badge>}
                    {group.multiSelect && <span className="text-xs text-muted-foreground">(varias opciones)</span>}
                  </div>
                  <div className="space-y-1">
                    {group.options.map((opt) => {
                      const isSelected = (selectedModifiers[group.id] || []).includes(opt.id);
                      return (
                        <div
                          key={opt.id}
                          className={`flex items-center justify-between p-3 rounded-md border cursor-pointer min-h-[44px] transition-colors ${isSelected ? "bg-primary/10 border-primary" : "hover-elevate"}`}
                          onClick={() => toggleModifierOption(group.id, opt.id, group.multiSelect)}
                          data-testid={`modifier-option-${opt.id}`}
                        >
                          <div className="flex items-center gap-2">
                            {group.multiSelect ? (
                              <Checkbox checked={isSelected} className="pointer-events-none" />
                            ) : (
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-primary" : "border-muted-foreground"}`}>
                                {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                              </div>
                            )}
                            <span className="text-sm">{opt.name}</span>
                          </div>
                          {Number(opt.priceDelta) > 0 && (
                            <span className="text-sm text-muted-foreground">+₡{Number(opt.priceDelta).toLocaleString()}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-2 pb-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setModifierDialogProduct(null); setModifierGroups([]); setSelectedModifiers({}); setPendingClickEvent(null); }}
                  data-testid="button-cancel-modifiers"
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={confirmModifierSelection}
                  data-testid="button-confirm-modifiers"
                >
                  <Plus className="w-4 h-4 mr-1" /> Agregar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {voidDialogItem && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50" data-testid="void-dialog-overlay">
          <Card className="w-[90%] max-w-sm mx-4">
            <CardHeader className="pb-2">
              <h3 className="font-bold text-base">Ajustar / Anular Ítem</h3>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm font-medium">
                <strong>{voidDialogItem.productNameSnapshot}</strong>
              </p>
              <div className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/50">
                <span className="text-sm text-muted-foreground">Cantidad a anular</span>
                <div className="flex items-center gap-3">
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setVoidQty(q => Math.max(1, q - 1))}
                    disabled={voidQty <= 1}
                    data-testid="button-void-qty-minus"
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <span className="text-lg font-bold w-8 text-center" data-testid="text-void-qty">{voidQty}</span>
                  <Button
                    size="icon"
                    variant="outline"
                    onClick={() => setVoidQty(q => Math.min(voidDialogItem.qty, q + 1))}
                    disabled={voidQty >= voidDialogItem.qty}
                    data-testid="button-void-qty-plus"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {voidQty < voidDialogItem.qty
                    ? `Quedan: ${voidDialogItem.qty - voidQty} unidad${(voidDialogItem.qty - voidQty) !== 1 ? "es" : ""}`
                    : "Anulación total"}
                </span>
                <span className="font-medium">
                  ₡{Number(Number(voidDialogItem.productPriceSnapshot) * voidQty).toLocaleString()}
                </span>
              </div>
              <Textarea
                placeholder="Motivo de anulación (opcional)"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="text-base"
                rows={2}
                data-testid="input-void-reason"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setVoidDialogItem(null); setVoidReason(""); setVoidQty(1); }}
                  data-testid="button-cancel-void"
                >
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  disabled={voidItemMutation.isPending}
                  onClick={() => {
                    if (activeOrder) {
                      voidItemMutation.mutate({ orderId: activeOrder.id, itemId: voidDialogItem.id, reason: voidReason, qtyToVoid: voidQty });
                    }
                  }}
                  data-testid="button-confirm-void"
                >
                  {voidItemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Ban className="w-4 h-4 mr-1" />}
                  {voidQty < voidDialogItem.qty ? `Anular ${voidQty}` : "Anular todo"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
