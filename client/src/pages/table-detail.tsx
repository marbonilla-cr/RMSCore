import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRoute, useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { wsManager } from "@/lib/ws";
import { formatCurrency, timeAgo } from "@/lib/utils";
import {
  ArrowLeft, Plus, Send, Check, Trash2, Loader2,
  ShoppingBag, AlertCircle, ChefHat, Minus, Search, X,
  ClipboardList, Ban, ChevronDown, ChevronRight, Clock,
  Receipt, Split, ArrowRight, FileText,
} from "lucide-react";
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

type ViewMode = "order" | "menu" | "split";

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
  const [managerPin, setManagerPin] = useState("");
  const [managerPinError, setManagerPinError] = useState("");
  const [showVoidedSection, setShowVoidedSection] = useState(false);
  const [modifierDialogProduct, setModifierDialogProduct] = useState<Product | null>(null);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroupWithOptions[]>([]);
  const [selectedModifiers, setSelectedModifiers] = useState<Record<number, number[]>>({});
  const [loadingModifiers, setLoadingModifiers] = useState(false);
  const [pendingClickEvent, setPendingClickEvent] = useState<HTMLElement | null>(null);
  const [splitSelectedItems, setSplitSelectedItems] = useState<Set<number>>(new Set());
  const [expandedSubmissionId, setExpandedSubmissionId] = useState<number | null>(null);
  const [editingSubmissionId, setEditingSubmissionId] = useState<number | null>(null);
  const [editedPayloadItems, setEditedPayloadItems] = useState<any[]>([]);
  const [qrMenuPickerOpen, setQrMenuPickerOpen] = useState(false);
  const [qrMenuSearch, setQrMenuSearch] = useState("");
  const [splitAccounts, setSplitAccounts] = useState<SplitAccount[]>([]);
  const [activeSplitId, setActiveSplitId] = useState<number | null>(null);
  const [splitLoading, setSplitLoading] = useState(false);
  const bottomBarRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const isManager = user?.role === "MANAGER";
  const [subaccountFilter, setSubaccountFilter] = useState<string>("all");
  const [expandedSubaccounts, setExpandedSubaccounts] = useState<Set<string>>(new Set());
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedTopCode, setSelectedTopCode] = useState<string | null>(null);
  const [showAllSubcats, setShowAllSubcats] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const [noteDialogItem, setNoteDialogItem] = useState<CartItem | null>(null);
  const [noteText, setNoteText] = useState("");
  const [rondaSheetOpen, setRondaSheetOpen] = useState(false);
  const [guestCountDialogOpen, setGuestCountDialogOpen] = useState(false);
  const [guestCountInput, setGuestCountInput] = useState("2");
  const guestCountCheckedRef = useRef(false);

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
    refetchInterval: 10000,
  });

  const prevOrderIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!currentView?.activeOrder) {
      prevOrderIdRef.current = null;
      guestCountCheckedRef.current = false;
      return;
    }
    if (currentView.activeOrder.id !== prevOrderIdRef.current) {
      prevOrderIdRef.current = currentView.activeOrder.id;
      guestCountCheckedRef.current = false;
    }
    if (guestCountCheckedRef.current) return;
    guestCountCheckedRef.current = true;
    if (currentView.activeOrder.guestCount == null) {
      setGuestCountDialogOpen(true);
    }
  }, [currentView]);

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
      queryClient.refetchQueries({ queryKey: ["/api/tables", tableId, "current"] });
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
      setRondaSheetOpen(false);
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

  const rejectSubmissionMutation = useMutation({
    mutationFn: async (submissionId: number) => {
      return apiRequest("DELETE", `/api/waiter/qr-submissions/${submissionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      toast({ title: "Pedido QR rechazado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const acceptEditedSubmissionMutation = useMutation({
    mutationFn: async ({ submissionId, items }: { submissionId: number; items: any[] }) => {
      const res = await apiRequest(
        "POST",
        `/api/waiter/qr-submissions/${submissionId}/accept-v2`,
        { editedItems: items }
      );
      return res.json();
    },
    onSuccess: (data: any) => {
      setEditingSubmissionId(null);
      setEditedPayloadItems([]);
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
    mutationFn: async ({ orderId, itemId, reason, qtyToVoid: qty, managerPin: pin }: { orderId: number; itemId: number; reason: string; qtyToVoid: number; managerPin?: string }) => {
      const body: any = { reason, qtyToVoid: qty };
      if (pin) body.managerPin = pin;
      return apiRequest("POST", `/api/waiter/orders/${orderId}/items/${itemId}/void`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setVoidDialogItem(null);
      setVoidReason("");
      setVoidQty(1);
      setManagerPin("");
      setManagerPinError("");
      toast({ title: "Ítem anulado" });
    },
    onError: (err: any) => {
      if (err.message?.includes("gerente") || err.message?.includes("PIN") || err.message?.includes("autorización") || err.message?.includes("permiso") || err.message?.includes("intentos")) {
        setManagerPinError(err.message);
        setManagerPin("");
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
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
      background:var(--green);opacity:0.85;
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

  const topCategories = categories.filter(c => c.categoryCode.startsWith("TOP-") && c.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const hasTopSystem = topCategories.length > 0;

  const subcategoriesForTop = hasTopSystem && selectedTopCode
    ? categories.filter(c => c.parentCategoryCode === selectedTopCode && c.active && !c.categoryCode.startsWith("TOP-")).sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  const productsByCategory = filteredProducts.reduce((acc: Record<number | string, Product[]>, p) => {
    const catId = p.categoryId ?? "sin-categoria";
    if (!acc[catId]) acc[catId] = [];
    acc[catId].push(p);
    return acc;
  }, {});

  const sortedCategoryIds = hasTopSystem
    ? subcategoriesForTop.map(sc => String(sc.id))
    : Object.keys(productsByCategory).sort((a, b) => {
        if (a === "sin-categoria") return 1;
        if (b === "sin-categoria") return -1;
        const catA = categories.find((c) => c.id === Number(a));
        const catB = categories.find((c) => c.id === Number(b));
        return (catA?.sortOrder ?? 999) - (catB?.sortOrder ?? 999);
      });

  useEffect(() => {
    if (hasTopSystem && topCategories.length > 0 && !selectedTopCode) {
      setSelectedTopCode(topCategories[0].categoryCode);
    }
  }, [hasTopSystem, topCategories.length]);

  useEffect(() => {
    if (hasTopSystem && subcategoriesForTop.length > 0) {
      setSelectedCategoryId(String(subcategoriesForTop[0].id));
      setShowAllSubcats(false);
    } else if (hasTopSystem) {
      setSelectedCategoryId(null);
    }
  }, [selectedTopCode]);

  useEffect(() => {
    if (!hasTopSystem && sortedCategoryIds.length > 0 && !selectedCategoryId) {
      setSelectedCategoryId(sortedCategoryIds[0]);
    }
  }, [sortedCategoryIds, hasTopSystem]);

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

  const getStatusClass = (status: string) => {
    switch (status) {
      case "PENDING": return "badge-muted";
      case "SENT": return "badge-blue";
      case "PREPARING": return "badge-amber";
      case "READY": return "badge-green";
      default: return "badge-muted";
    }
  };
  const getStatusText = (status: string) => {
    switch (status) {
      case "PENDING": return "Pendiente";
      case "SENT": return "Cocina";
      case "PREPARING": return "Preparando";
      case "READY": return "Listo";
      default: return status;
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
      <div className="td-screen">
        <style>{tdStyles}</style>
        <div className="td-header">
          <button className="back-btn" onClick={() => navigate("/tables")} data-testid="button-back">
            <ArrowLeft size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div className="td-skeleton" style={{ width: 140, height: 24, marginBottom: 6 }} />
            <div className="td-skeleton" style={{ width: 100, height: 14 }} />
          </div>
        </div>
        <div style={{ padding: 18 }}>
          <div className="td-skeleton" style={{ height: 100, marginBottom: 12 }} />
          <div className="td-skeleton" style={{ height: 60, marginBottom: 12 }} />
          <div className="td-skeleton" style={{ height: 44 }} />
        </div>
      </div>
    );
  }

  const orderStatusColor = activeOrder?.status === "PAID" ? "var(--text3)"
    : activeOrder?.status === "READY" ? "var(--green)"
    : activeOrder?.status === "IN_KITCHEN" ? "var(--blue)"
    : activeOrder?.status === "PREPARING" ? "var(--amber)"
    : "var(--green)";

  const orderStatusLabel = activeOrder?.status === "PAID" ? "Pagada"
    : activeOrder?.status === "READY" ? "Lista"
    : activeOrder?.status === "IN_KITCHEN" ? "En Cocina"
    : activeOrder?.status === "PREPARING" ? "Preparando"
    : activeOrder ? "Abierta" : "Sin orden";

  const elapsedTime = activeOrder?.createdAt ? timeAgo(activeOrder.createdAt) : "";

  return (
    <div className="td-screen">
      <style>{tdStyles}</style>

      {guestCountDialogOpen && activeOrder && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} data-testid="dialog-guest-count">
          <div style={{ background: "var(--s1)", border: "1px solid var(--border-ds)", borderRadius: "var(--r-lg)", width: "min(90vw, 340px)", overflow: "hidden" }}>
            <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-ds)", fontFamily: "var(--f-disp)", fontSize: 16, fontWeight: 700 }}>
              {tableData?.tableName || `Mesa ${tableId}`}
            </div>
            <div style={{ padding: "18px" }}>
              <div style={{ fontFamily: "var(--f-body)", fontSize: 14, color: "var(--text2)", marginBottom: 14 }}>
                Cuantas personas hay en la mesa?
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 18 }}>
                <button
                  style={{ width: 40, height: 40, borderRadius: "var(--r-sm)", border: "1px solid var(--border2)", background: "var(--s2)", color: "var(--text)", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => { const v = Math.max(1, parseInt(guestCountInput) - 1); setGuestCountInput(String(v)); }}
                  data-testid="button-guest-minus"
                >
                  <Minus size={16} />
                </button>
                <input
                  type="number"
                  min="1"
                  value={guestCountInput}
                  onChange={(e) => setGuestCountInput(e.target.value)}
                  style={{ width: 60, textAlign: "center", fontFamily: "var(--f-disp)", fontSize: 28, fontWeight: 700, background: "none", border: "none", color: "var(--text)", outline: "none" }}
                  data-testid="input-guest-count"
                />
                <button
                  style={{ width: 40, height: 40, borderRadius: "var(--r-sm)", border: "1px solid var(--border2)", background: "var(--s2)", color: "var(--text)", fontSize: 20, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                  onClick={() => { const v = parseInt(guestCountInput) + 1; setGuestCountInput(String(isNaN(v) ? 2 : v)); }}
                  data-testid="button-guest-plus"
                >
                  <Plus size={16} />
                </button>
              </div>
              <button
                style={{ width: "100%", padding: "12px", background: "var(--green)", color: "#050f08", border: "none", borderRadius: "var(--r-sm)", fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                onClick={async () => {
                  const count = parseInt(guestCountInput);
                  if (isNaN(count) || count < 1) return;
                  try {
                    await apiRequest("PATCH", `/api/orders/${activeOrder.id}/guest-count`, { guestCount: count });
                    queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
                  } catch {}
                  setGuestCountDialogOpen(false);
                }}
                data-testid="button-guest-confirm"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="td-header">
        <button className="back-btn" onClick={() => navigate("/tables")} data-testid="button-back">
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="header-title" data-testid="text-table-name">
            {tableData?.tableName || `Mesa ${tableId}`}
          </h1>
          <p className="header-sub">
            {activeOrder ? `Orden #${activeOrder.id}` : "Sin orden abierta"}
            {elapsedTime && <> &middot; {elapsedTime}</>}
            {activeOrder && (
              <> &middot; <span style={{ color: orderStatusColor }}>{orderStatusLabel}</span></>
            )}
          </p>
        </div>
      </div>

      <div className="view-tabs">
        <button
          className={`view-tab ${viewMode === "order" ? "active-order" : ""}`}
          onClick={() => setViewMode("order")}
          data-testid="button-view-order"
        >
          <ClipboardList size={15} />
          Orden
          {orderItems.filter((i: any) => i.status !== "VOIDED").length > 0 && (
            <span className="tab-badge">{orderItems.filter((i: any) => i.status !== "VOIDED").length}</span>
          )}
        </button>
        <button
          className={`view-tab ${viewMode === "menu" ? "active-menu" : ""}`}
          onClick={() => setViewMode("menu")}
          data-testid="button-view-menu"
        >
          <Plus size={15} />
          Menu
        </button>
        {activeOrder && activeItems.length > 0 && (
          <button
            className={`view-tab ${viewMode === "split" ? "active-order" : ""}`}
            onClick={enterSplitMode}
            data-testid="button-view-split"
          >
            <Split size={15} />
            Dividir
          </button>
        )}
      </div>

      <div className="td-content" style={{ paddingBottom: cart.length > 0 && viewMode !== "split" ? 80 : 16 }}>
        {viewMode === "split" ? (
          <div className="td-section">
            <h2 className="td-section-title">
              <Split size={18} /> Dividir Cuenta
            </h2>

            <div className="split-tabs">
              {splitAccounts.map((sa) => (
                <button
                  key={sa.id}
                  className={`split-tab ${activeSplitId === sa.id ? "active" : ""}`}
                  onClick={() => setActiveSplitId(sa.id)}
                  data-testid={`button-split-tab-${sa.id}`}
                >
                  {sa.label} ({sa.items.length})
                </button>
              ))}
              <button
                className="split-tab"
                onClick={createSplitAccount}
                disabled={splitLoading}
                data-testid="button-create-split"
              >
                <Plus size={14} /> Nueva
              </button>
            </div>

            <div className="card-ds" style={{ marginBottom: 12 }}>
              <div className="card-ds-header">
                <span className="td-label">Items sin asignar ({unassignedItems.length})</span>
              </div>
              <div>
                {unassignedItems.length === 0 ? (
                  <p className="td-empty-text">Todos los items asignados</p>
                ) : (
                  unassignedItems.map((item: any) => {
                    const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                    const unitPrice = Number(item.productPriceSnapshot) + modDelta;
                    return (
                      <div
                        key={item.id}
                        className={`split-item ${splitSelectedItems.has(item.id) ? "selected" : ""}`}
                        onClick={() => toggleSplitItem(item.id)}
                        data-testid={`split-item-${item.id}`}
                      >
                        <Checkbox checked={splitSelectedItems.has(item.id)} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className="oi-name">{item.qty}x {item.productNameSnapshot}</span>
                          {item.customerNameSnapshot && (
                            <span className="oi-customer">{item.customerNameSnapshot}</span>
                          )}
                          {item.modifiers && item.modifiers.length > 0 && (
                            <span className="oi-mods">
                              {item.modifiers.map((m: any) => m.nameSnapshot).join(", ")}
                            </span>
                          )}
                        </div>
                        <span className="oi-price">{formatCurrency(unitPrice * item.qty)}</span>
                      </div>
                    );
                  })
                )}
                {splitSelectedItems.size > 0 && activeSplitId && (
                  <button
                    className="btn-primary"
                    style={{ width: "100%", marginTop: 8 }}
                    onClick={moveItemsToSplit}
                    disabled={splitLoading}
                    data-testid="button-move-to-split"
                  >
                    {splitLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                    Mover {splitSelectedItems.size} items a {splitAccounts.find(s => s.id === activeSplitId)?.label}
                  </button>
                )}
                {splitSelectedItems.size > 0 && !activeSplitId && (
                  <p className="td-empty-text" style={{ marginTop: 8 }}>Seleccione o cree una subcuenta primero</p>
                )}
              </div>
            </div>

            {splitAccounts.map((sa) => {
              const splitItems = sa.items.map(si => activeItems.find((i: any) => i.id === si.orderItemId)).filter(Boolean);
              const splitTotal = splitItems.reduce((sum: number, item: any) => {
                const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                return sum + (Number(item.productPriceSnapshot) + modDelta) * item.qty;
              }, 0);
              return (
                <div key={sa.id} className={`card-ds ${activeSplitId === sa.id ? "card-active" : ""}`} style={{ marginBottom: 8 }} data-testid={`split-account-${sa.id}`}>
                  <div className="card-ds-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span className="oi-name" style={{ fontWeight: 600 }}>{sa.label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="oi-price">{formatCurrency(splitTotal)}</span>
                      <button className="btn-icon-sm" onClick={() => removeSplitAccount(sa.id)} data-testid={`button-remove-split-${sa.id}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {splitItems.length === 0 ? (
                    <p className="td-empty-text">Sin items</p>
                  ) : (
                    splitItems.map((item: any) => {
                      const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                      const unitPrice = Number(item.productPriceSnapshot) + modDelta;
                      return (
                        <div key={item.id} className="order-item" data-testid={`split-assigned-item-${item.id}`}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span className="oi-name">{item.qty}x {item.productNameSnapshot}</span>
                            {item.customerNameSnapshot && (
                              <span className="oi-customer">{item.customerNameSnapshot}</span>
                            )}
                          </div>
                          <span className="oi-price">{formatCurrency(unitPrice * item.qty)}</span>
                          <button
                            className="btn-icon-sm"
                            onClick={() => returnItemToUnassigned(item.id, sa.id)}
                            disabled={splitLoading}
                            data-testid={`button-return-item-${item.id}`}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}

            <div style={{ display: "flex", gap: 8, marginTop: 16, paddingBottom: 16 }}>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setViewMode("order")} data-testid="button-cancel-split">
                Cancelar
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={executeSplit}
                disabled={splitLoading || splitAccounts.filter(s => s.items.length > 0).length === 0}
                data-testid="button-execute-split"
              >
                {splitLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Confirmar Division
              </button>
            </div>
          </div>
        ) : viewMode === "order" ? (
          <div className="td-section">
            {pendingSubmissions.length > 0 && (
              <div className="qr-banner">
                <AlertCircle size={22} className="qr-banner-icon" style={{ color: "var(--amber)" }} />
                <div className="qr-banner-text">
                  <p className="qr-banner-title" data-testid="text-pending-qr-title">
                    {pendingSubmissions.length} pedido{pendingSubmissions.length > 1 ? "s" : ""} QR pendiente{pendingSubmissions.length > 1 ? "s" : ""}
                  </p>
                </div>
                {pendingSubmissions.length > 1 && (
                  <button
                    className="qr-banner-btn"
                    onClick={() => acceptAllMutation.mutate(pendingSubmissions.map((s: any) => s.id))}
                    disabled={acceptAllMutation.isPending}
                    data-testid="button-accept-all-qr"
                  >
                    {acceptAllMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : "Aceptar todas"}
                  </button>
                )}
              </div>
            )}

            {pendingSubmissions.length > 0 && pendingSubmissions.map((sub: any) => {
              const rawPayload = sub.payloadSnapshot || sub.payload_snapshot;
              const payloadItems = rawPayload?.items || (Array.isArray(rawPayload) ? rawPayload : []);
              const firstItem = payloadItems[0] || null;
              const customerName = firstItem?.customerName || "Cliente";
              const createdAt = sub.createdAt ? new Date(sub.createdAt) : new Date();
              const timeStr = createdAt.toLocaleTimeString("es-CR", { hour: "numeric", minute: "2-digit", hour12: true });
              const isExpanded = expandedSubmissionId === sub.id;
              const isEditing = editingSubmissionId === sub.id;

              const displayItems = isEditing ? editedPayloadItems : payloadItems;
              const itemCount = displayItems.length;

              const qrMenuSearchLower = qrMenuSearch.toLowerCase();
              const qrFilteredProducts = qrMenuPickerOpen && isEditing ? products.filter(
                (p) => p.active && (p.availablePortions === null || p.availablePortions > 0) &&
                  (qrMenuSearchLower.length === 0 ||
                    p.name.toLowerCase().includes(qrMenuSearchLower) ||
                    p.productCode.toLowerCase().includes(qrMenuSearchLower))
              ) : [];

              return (
                <div key={sub.id} className="card-ds" style={{ marginBottom: 8 }} data-testid={`pending-submission-${sub.id}`}>

                  <div
                    className="qr-submission-header"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedSubmissionId(null);
                        setEditingSubmissionId(null);
                        setEditedPayloadItems([]);
                        setQrMenuPickerOpen(false);
                        setQrMenuSearch("");
                      } else {
                        if (editingSubmissionId && editingSubmissionId !== sub.id) {
                          setQrMenuPickerOpen(false);
                          setQrMenuSearch("");
                        }
                        setExpandedSubmissionId(sub.id);
                        setEditingSubmissionId(sub.id);
                        setEditedPayloadItems(payloadItems.map((i: any) => ({ ...i })));
                      }
                    }}
                    data-testid={`button-toggle-qr-${sub.id}`}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="oi-mods">{timeStr}</span>
                        <span className="oi-name">{customerName}</span>
                        <span className="badge-ds badge-muted">
                          {itemCount} {itemCount === 1 ? "item" : "items"}
                        </span>
                        {isEditing && (
                          <span className="badge-ds badge-amber">EDITANDO</span>
                        )}
                        {isEditing && (
                          <button
                            className="badge-ds badge-blue"
                            style={{ cursor: "pointer", border: "none" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setQrMenuPickerOpen(!qrMenuPickerOpen);
                              setQrMenuSearch("");
                            }}
                            data-testid={`button-qr-add-menu-${sub.id}`}
                          >
                            <Plus size={12} /> Menu
                          </button>
                        )}
                      </div>
                    </div>
                    <ChevronRight
                      size={18}
                      style={{
                        color: "var(--text3)",
                        transition: "transform var(--t-fast)",
                        transform: isExpanded ? "rotate(90deg)" : "none",
                        flexShrink: 0,
                      }}
                    />
                  </div>

                  {isExpanded && isEditing && (
                    <div style={{ marginTop: 10 }}>

                      {qrMenuPickerOpen && (
                        <div style={{ marginBottom: 12, border: "1px solid var(--border-ds)", borderRadius: "var(--r-sm)", padding: 8 }} data-testid={`qr-menu-picker-${sub.id}`}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <Search size={14} style={{ color: "var(--text3)", flexShrink: 0 }} />
                            <input
                              type="text"
                              placeholder="Buscar producto..."
                              value={qrMenuSearch}
                              onChange={(e) => setQrMenuSearch(e.target.value)}
                              className="td-search-input"
                              style={{ flex: 1, fontSize: 13, padding: "6px 8px" }}
                              autoFocus
                              data-testid={`input-qr-menu-search-${sub.id}`}
                            />
                            <button
                              className="btn-icon-sm"
                              onClick={() => { setQrMenuPickerOpen(false); setQrMenuSearch(""); }}
                              data-testid={`button-qr-menu-close-${sub.id}`}
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <div style={{ maxHeight: 200, overflowY: "auto" }}>
                            {qrFilteredProducts.slice(0, 30).map((product) => (
                              <div
                                key={product.id}
                                className="order-item hover-elevate"
                                style={{ cursor: "pointer", padding: "8px 4px" }}
                                onClick={() => {
                                  const existingIdx = editedPayloadItems.findIndex(
                                    (ei: any) => ei.productId === product.id
                                  );
                                  if (existingIdx >= 0) {
                                    const next = [...editedPayloadItems];
                                    next[existingIdx] = { ...next[existingIdx], qty: next[existingIdx].qty + 1 };
                                    setEditedPayloadItems(next);
                                  } else {
                                    setEditedPayloadItems([
                                      ...editedPayloadItems,
                                      {
                                        productId: product.id,
                                        productName: product.name,
                                        qty: 1,
                                        modifiers: [],
                                        notes: "",
                                      },
                                    ]);
                                  }
                                  toast({ title: `${product.name} agregado` });
                                }}
                                data-testid={`button-qr-menu-product-${product.id}`}
                              >
                                <span className="oi-name" style={{ flex: 1 }}>{product.name}</span>
                                <span className="oi-price">{formatCurrency(product.price)}</span>
                              </div>
                            ))}
                            {qrFilteredProducts.length === 0 && (
                              <p className="oi-mods" style={{ textAlign: "center", padding: 8 }}>
                                Sin resultados
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {displayItems.map((item: any, idx: number) => (
                        <div key={idx} className="order-item" data-testid={`qr-item-${sub.id}-${idx}`}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                            <button
                              className="qty-btn"
                              onClick={() => {
                                const next = [...editedPayloadItems];
                                if (next[idx].qty <= 1) {
                                  next.splice(idx, 1);
                                } else {
                                  next[idx] = { ...next[idx], qty: next[idx].qty - 1 };
                                }
                                setEditedPayloadItems(next);
                              }}
                              data-testid={`button-qr-item-minus-${idx}`}
                            >
                              <Minus size={14} />
                            </button>
                            <span className="qty-val">{item.qty}</span>
                            <button
                              className="qty-btn"
                              onClick={() => {
                                const next = [...editedPayloadItems];
                                next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
                                setEditedPayloadItems(next);
                              }}
                              data-testid={`button-qr-item-plus-${idx}`}
                            >
                              <Plus size={14} />
                            </button>
                            <span className="oi-name" style={{ flex: 1 }}>
                              {item.productName || `Producto #${item.productId}`}
                            </span>
                            <button
                              className="btn-icon-sm"
                              style={{ color: "var(--red)" }}
                              onClick={() => {
                                setEditedPayloadItems(editedPayloadItems.filter((_, i) => i !== idx));
                              }}
                              data-testid={`button-qr-item-remove-${idx}`}
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}

                      {editedPayloadItems.length === 0 && (
                        <p className="oi-mods" style={{ textAlign: "center", padding: "8px 0", color: "var(--red)" }}>
                          Sin ítems — rechaza el pedido en su lugar
                        </p>
                      )}

                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button
                          className="btn-danger"
                          onClick={() => rejectSubmissionMutation.mutate(sub.id)}
                          disabled={rejectSubmissionMutation.isPending}
                          data-testid={`button-reject-qr-${sub.id}`}
                          style={{ minWidth: 44 }}
                          title="Rechazar pedido"
                        >
                          {rejectSubmissionMutation.isPending ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <Trash2 size={15} />
                          )}
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ flex: 1 }}
                          onClick={() => {
                            setEditingSubmissionId(null);
                            setEditedPayloadItems([]);
                            setExpandedSubmissionId(null);
                            setQrMenuPickerOpen(false);
                            setQrMenuSearch("");
                          }}
                          data-testid={`button-cancel-edit-qr-${sub.id}`}
                        >
                          Cancelar
                        </button>
                        <button
                          className="btn-primary"
                          style={{ flex: 1 }}
                          disabled={
                            editedPayloadItems.length === 0 ||
                            acceptEditedSubmissionMutation.isPending
                          }
                          onClick={() =>
                            acceptEditedSubmissionMutation.mutate({
                              submissionId: sub.id,
                              items: editedPayloadItems,
                            })
                          }
                          data-testid={`button-confirm-edit-qr-${sub.id}`}
                        >
                          {acceptEditedSubmissionMutation.isPending ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <Send size={16} />
                          )}
                          ENVIAR A COCINA
                        </button>
                      </div>

                    </div>
                  )}
                </div>
              );
            })}

            {Object.keys(groupedItems).length > 0 && (
              <div className="card-ds" style={{ marginBottom: 12 }}>
                {Object.entries(groupedItems)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([round, items]) => (
                    <div key={round} className="round-section">
                      <div className="round-header">
                        <span className="round-pill">
                          Ronda {round} {(items as any[])[0]?.origin === "QR" ? "(QR)" : ""}
                        </span>
                        <div className="round-line" />
                        {(items as any[])[0]?.createdAt && (
                          <span className="round-time">{timeAgo((items as any[])[0].createdAt)}</span>
                        )}
                      </div>
                      {(items as any[]).map((item: any) => {
                        const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                        const unitPrice = Number(item.productPriceSnapshot) + modDelta;
                        return (
                          <div key={item.id} className="order-item" data-testid={`order-item-${item.id}`}>
                            <div className="oi-qty">{item.qty}</div>
                            <div className="oi-info">
                              <div className="oi-name">{item.productNameSnapshot}</div>
                              {item.modifiers && item.modifiers.length > 0 && (
                                <div className="oi-mods">
                                  {item.modifiers.map((m: any) => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +${formatCurrency(m.priceDeltaSnapshot)}` : "")).join(", ")}
                                </div>
                              )}
                              {item.notes && !(item.modifiers && item.modifiers.length > 0) && <div className="oi-mods">{item.notes}</div>}
                            </div>
                            <div className="oi-right">
                              <div className="oi-price">{formatCurrency(unitPrice * item.qty)}</div>
                              <span className={`oi-status ${item.status === "SENT" ? "kitchen" : item.status === "READY" ? "ready" : item.status === "PREPARING" ? "preparing" : ""}`}>
                                {getStatusText(item.status)}
                              </span>
                            </div>
                            {activeOrder?.status !== "PAID" && (
                              <button
                                className="btn-icon-sm"
                                style={{ color: "var(--red)" }}
                                onClick={() => { setVoidDialogItem(item); setVoidReason(""); setVoidQty(item.qty); setManagerPin(""); setManagerPinError(""); }}
                                data-testid={`button-void-item-${item.id}`}
                              >
                                <Ban size={14} />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                {activeOrder?.totalAmount && (
                  <div className="order-totals">
                    <div className="ot-sep" />
                    <div className="ot-row ot-total">
                      <span className="label">Total</span>
                      <span className="val">{formatCurrency(activeOrder.totalAmount)}</span>
                    </div>
                    <button
                      className="btn-secondary"
                      style={{ width: "100%", marginTop: 10 }}
                      onClick={() => {
                        apiRequest("POST", "/api/pos/print-precuenta", { orderId: activeOrder.id })
                          .then(r => r.json())
                          .then(data => toast({ title: "Pre-cuenta impresa", description: `Enviado a ${data.printer}` }))
                          .catch(() => {
                            const cfg = businessCfg || {};
                            const allItems = orderItems.filter((i: any) => i.status !== "VOIDED");
                            const grouped = new Map<string, { name: string; qty: number; price: number; total: number }>();
                            for (const item of allItems) {
                              const modDelta = (item.modifiers || []).reduce((s: number, m: any) => s + Number(m.priceDeltaSnapshot) * (m.qty || 1), 0);
                              const modLabel = (item.modifiers && item.modifiers.length > 0) ? ` (${item.modifiers.map((m: any) => m.nameSnapshot + (Number(m.priceDeltaSnapshot) > 0 ? ` +${formatCurrency(m.priceDeltaSnapshot)}` : "")).join(", ")})` : "";
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
                          });
                      }}
                      data-testid="button-pre-cuenta"
                    >
                      <Receipt size={16} /> Pre-cuenta
                    </button>
                  </div>
                )}
              </div>
            )}

            {orderBySubaccount && orderBySubaccount.groups && orderBySubaccount.groups.length > 0 && (
              <div className="card-ds" style={{ marginBottom: 12 }}>
                <div className="card-ds-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="td-section-title" style={{ margin: 0 }}>
                    <Split size={16} /> Por subcuenta
                  </span>
                  <select
                    className="td-select"
                    value={subaccountFilter}
                    onChange={(e) => setSubaccountFilter(e.target.value)}
                    data-testid="select-subaccount-filter"
                  >
                    <option value="all">Todas</option>
                    {orderBySubaccount.groups.map((g: any) => (
                      <option key={g.subaccount?.id || 'none'} value={g.subaccount?.code || 'none'}>
                        {g.subaccount?.label || g.subaccount?.code || 'Sin subcuenta'}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
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
                        <div key={subKey} className="subaccount-group" data-testid={`subaccount-group-${subKey}`}>
                          <button
                            type="button"
                            className="subaccount-toggle"
                            onClick={toggleExpanded}
                            data-testid={`button-toggle-subaccount-${subKey}`}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span className="oi-name" style={{ fontWeight: 700 }}>{group.subaccount?.label || `Mesa ${subCode}`}</span>
                              <span className="oi-mods">{itemCount} items</span>
                            </div>
                            <span className="oi-price">{formatCurrency(subtotal)}</span>
                          </button>
                          {isExpanded && (
                            <div style={{ padding: "0 12px 12px" }}>
                              {items.map((item: any) => (
                                <div key={item.id} className="order-item" data-testid={`subaccount-item-${item.id}`}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div className="oi-name">
                                      {item.customerNameSnapshot ? `${item.customerNameSnapshot} pidio. ` : ""}{item.productNameSnapshot}
                                    </div>
                                    {item.modifiers && item.modifiers.length > 0 && (
                                      <div className="oi-mods">
                                        + {item.modifiers.map((m: any) => m.nameSnapshot).join(", ")}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                    <span className="oi-mods">Qty: {item.qty}</span>
                                    <span className={`oi-status ${getStatusClass(item.status).replace("badge-", "")}`}>
                                      {getStatusText(item.status)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {voidedItemsList.length > 0 && (
              <div className="card-ds" style={{ marginBottom: 12, borderStyle: "dashed" }}>
                <button
                  className="subaccount-toggle"
                  onClick={() => setShowVoidedSection(!showVoidedSection)}
                  data-testid="button-toggle-voided"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {showVoidedSection ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="oi-name" style={{ color: "var(--text3)" }}>
                      Anulaciones ({voidedItemsList.length})
                    </span>
                  </div>
                </button>
                {showVoidedSection && (
                  <div style={{ padding: "0 12px 12px" }}>
                    {voidedItemsList.map((vi: any) => (
                      <div key={vi.id} className="order-item" style={{ flexDirection: "column", gap: 4 }} data-testid={`voided-item-${vi.id}`}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, width: "100%" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <span className="oi-name" style={{ textDecoration: "line-through", color: "var(--text3)" }}>
                              {vi.qtyVoided}x {vi.productNameSnapshot}
                            </span>
                            {vi.notes && <span className="oi-mods" style={{ fontStyle: "italic" }}>{vi.notes}</span>}
                            {vi.voidReason && <span className="oi-mods">Motivo: {vi.voidReason}</span>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                            <span className="oi-price" style={{ textDecoration: "line-through", color: "var(--text3)" }}>
                              {formatCurrency(Number(vi.unitPriceSnapshot) * vi.qtyVoided)}
                            </span>
                            <span className="badge-ds badge-muted">Anulado</span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <Clock size={12} style={{ color: "var(--text3)" }} />
                          <span className="oi-mods">{vi.voidedByName}</span>
                          <span className="oi-mods">{vi.voidedAt ? new Date(vi.voidedAt).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                        </div>
                        {isManager && (
                          <button
                            className="btn-danger"
                            style={{ marginTop: 4, padding: "6px 12px", fontSize: 12 }}
                            onClick={() => {
                              if (confirm("Eliminar definitivamente este item? Esta accion no se puede deshacer.")) {
                                hardDeleteMutation.mutate({ orderId: vi.orderId, itemId: vi.orderItemId });
                              }
                            }}
                            data-testid={`button-hard-delete-${vi.id}`}
                          >
                            <Trash2 size={12} /> Eliminar definitivo
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {Object.keys(groupedItems).length === 0 && pendingSubmissions.length === 0 && voidedItemsList.length === 0 && (
              <div className="td-empty">
                <ShoppingBag size={48} style={{ opacity: 0.2, color: "var(--text3)" }} />
                <p className="oi-name" style={{ marginTop: 12 }}>No hay items en la orden</p>
                <button className="btn-secondary" style={{ marginTop: 16 }} onClick={() => setViewMode("menu")} data-testid="button-start-adding">
                  <Plus size={18} /> Agregar Items
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div className="menu-sticky-header">
              {hasTopSystem && !isSearching && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div className="top-cats">
                      {topCategories.map((top) => {
                        const isActive = selectedTopCode === top.categoryCode;
                        const colorClass = top.categoryCode === "TOP-COMIDAS" ? "active-emerald"
                          : top.categoryCode === "TOP-BEBIDAS" ? "active-blue"
                          : top.categoryCode === "TOP-POSTRES" ? "active-rose"
                          : "active-emerald";
                        return (
                          <button
                            key={top.categoryCode}
                            className={`top-cat ${isActive ? colorClass : ""}`}
                            onClick={() => setSelectedTopCode(top.categoryCode)}
                            data-testid={`button-top-${top.categoryCode}`}
                          >
                            {top.name}
                          </button>
                        );
                      })}
                    </div>
                    <button className="btn-icon-sm" onClick={() => { setSearchSheetOpen(true); setSearchTerm(""); setDebouncedSearch(""); }} data-testid="button-open-search">
                      <Search size={16} />
                    </button>
                  </div>
                  {sortedCategoryIds.length > 0 && (
                    <div className="sub-cats">
                      {sortedCategoryIds.map((catId) => {
                        const cat = categories.find(c => c.id === Number(catId));
                        const catName = cat?.name || "Categoria";
                        const isActive = selectedCategoryId === catId;
                        const count = (productsByCategory[catId] || []).length;
                        return (
                          <button
                            key={catId}
                            className={`sub-cat ${isActive ? "active" : ""}`}
                            onClick={() => setSelectedCategoryId(catId)}
                            data-testid={`chip-category-${catId}`}
                          >
                            {catName}{count > 0 ? ` (${count})` : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!hasTopSystem && !isSearching && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <button className="btn-icon-sm" onClick={() => { setSearchSheetOpen(true); setSearchTerm(""); setDebouncedSearch(""); }} data-testid="button-open-search-flat">
                    <Search size={16} />
                  </button>
                </div>
              )}

              {!hasTopSystem && !isSearching && sortedCategoryIds.length > 0 && (
                <div className="sub-cats">
                  {sortedCategoryIds.map((catId) => {
                    const cat = categories.find(c => c.id === Number(catId));
                    const catName = catId === "sin-categoria" ? "Sin Categoria" : cat?.name || "Categoria";
                    const isActive = selectedCategoryId === catId;
                    return (
                      <button
                        key={catId}
                        className={`sub-cat ${isActive ? "active" : ""}`}
                        onClick={() => setSelectedCategoryId(catId)}
                        data-testid={`chip-category-${catId}`}
                      >
                        {catName}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="menu-products-area">
              {(() => {
                const displayProducts = isSearching ? filteredProducts : (selectedCategoryId ? (productsByCategory[selectedCategoryId] || []) : []);
                return (
                  <>
                    <div className="products-grid">
                      {displayProducts.map((p) => {
                        const inCartQty = cart.filter(c => c.productId === p.id).reduce((s, c) => s + c.qty, 0);
                        const isUnavailable = p.availablePortions !== null && p.availablePortions <= 0;
                        return (
                          <div
                            key={p.id}
                            className={`product-card ${isUnavailable ? "unavailable" : ""}`}
                            onClick={(e) => !isUnavailable && addToCart(p, e)}
                            data-testid={`menu-item-${p.id}`}
                          >
                            <div className="pc-name">{p.name}</div>
                            <div className="pc-price">{formatCurrency(p.price)}</div>
                            {isUnavailable && (
                              <span className="pc-agotado">Agotado</span>
                            )}
                            {p.availablePortions !== null && p.availablePortions > 0 && (
                              <span className="pc-portions">{p.availablePortions}</span>
                            )}
                            {inCartQty > 0 && (
                              <span className="pc-in-cart">{inCartQty}</span>
                            )}
                            {!isUnavailable && (
                              <span className="pc-add"><Plus size={16} /></span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {displayProducts.length === 0 && (
                      <div className="td-empty">
                        <Search size={40} style={{ opacity: 0.2, color: "var(--text3)" }} />
                        <p className="oi-name" style={{ marginTop: 12 }}>
                          {isSearching ? `Sin resultados para "${debouncedSearch}"` : "Seleccione una categoria"}
                        </p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {searchSheetOpen && (
              <div className="td-overlay" onClick={() => setSearchSheetOpen(false)} data-testid="overlay-search">
                <div className="td-bottom-sheet" onClick={(e) => e.stopPropagation()}>
                  <div className="sheet-drag-handle" />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div className="search-bar" style={{ flex: 1 }}>
                      <Search size={14} className="search-icon" />
                      <input
                        placeholder="Buscar items..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        data-testid="input-search-menu"
                        autoFocus
                      />
                    </div>
                    <button className="btn-icon-sm" onClick={() => { setSearchSheetOpen(false); setSearchTerm(""); setDebouncedSearch(""); }} data-testid="button-close-search">
                      <X size={16} />
                    </button>
                  </div>
                  <div style={{ flex: 1, overflowY: "auto" }}>
                    {debouncedSearch.length > 0 && (
                      <div className="products-grid">
                        {filteredProducts.filter(p => p.name.toLowerCase().includes(debouncedSearch.toLowerCase()) || p.productCode.toLowerCase().includes(debouncedSearch.toLowerCase())).map((p) => {
                          const inCartQty = cart.filter(c => c.productId === p.id).reduce((s, c) => s + c.qty, 0);
                          return (
                            <div
                              key={p.id}
                              className={`product-card ${p.availablePortions !== null && p.availablePortions <= 0 ? "unavailable" : ""}`}
                              onClick={(e) => { addToCart(p, e); setSearchSheetOpen(false); setSearchTerm(""); setDebouncedSearch(""); }}
                              data-testid={`search-item-${p.id}`}
                            >
                              <div className="pc-name">{p.name}</div>
                              <div className="pc-price">{formatCurrency(p.price)}</div>
                              {inCartQty > 0 && <span className="pc-in-cart">{inCartQty}</span>}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {debouncedSearch.length > 0 && filteredProducts.filter(p => p.name.toLowerCase().includes(debouncedSearch.toLowerCase())).length === 0 && (
                      <p className="td-empty-text" style={{ padding: "32px 0" }}>Sin resultados</p>
                    )}
                    {debouncedSearch.length === 0 && (
                      <p className="td-empty-text" style={{ padding: "32px 0" }}>Escriba para buscar</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {cart.length > 0 && !rondaSheetOpen && (
        <div
          ref={bottomBarRef}
          className="cart-fab-bar"
          data-testid="bottom-order-bar"
        >
          <button className="cart-fab" onClick={() => setRondaSheetOpen(true)} data-testid="button-open-ronda">
            <ShoppingBag size={16} />
            <span
              ref={badgeRef}
              style={{ transition: "transform 0.2s", transform: badgePop ? "scale(1.2)" : "scale(1)" }}
              data-testid="badge-cart-count"
            >
              Ronda ({cartCount})
            </span>
            <span className="cart-fab-total">{formatCurrency(cartTotal)}</span>
          </button>
          <button
            className="cart-send-btn"
            onClick={() => sendRoundMutation.mutate()}
            disabled={sendRoundMutation.isPending}
            data-testid="button-send-round"
          >
            {sendRoundMutation.isPending ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
          </button>
        </div>
      )}

      {rondaSheetOpen && (
        <div className="td-overlay" data-testid="ronda-sheet">
          <div className="td-overlay-bg" onClick={() => setRondaSheetOpen(false)} />
          <div className="td-bottom-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-drag-handle" />
            <div style={{ padding: "0 16px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <h3 className="td-section-title" style={{ margin: 0 }}>Nueva Ronda ({cartCount} items)</h3>
              <span className="oi-price" style={{ fontSize: 16 }}>{formatCurrency(cartTotal)}</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 8px" }}>
              {cart.map((item) => (
                <div key={item.cartKey} className="cart-sheet-item" data-testid={`cart-item-${item.cartKey}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="oi-name">{item.name}</span>
                      <span className="oi-mods">{formatCurrency(item.price)}</span>
                    </div>
                    {(item.modifiers.length > 0 || item.notes) && (
                      <div className="oi-mods" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.modifiers.length > 0 && `Mods: ${item.modifiers.map(m => m.name).join(", ")}`}
                        {item.modifiers.length > 0 && item.notes && " | "}
                        {item.notes && `Nota: ${item.notes}`}
                      </div>
                    )}
                  </div>
                  <div className="cart-qty-controls">
                    <button className="qty-btn" onClick={() => updateCartQty(item.cartKey, item.qty - 1)} data-testid={`button-qty-minus-${item.cartKey}`}>
                      <Minus size={12} />
                    </button>
                    <span className="qty-val">{item.qty}</span>
                    <button className="qty-btn" onClick={() => updateCartQty(item.cartKey, item.qty + 1)} data-testid={`button-qty-plus-${item.cartKey}`}>
                      <Plus size={12} />
                    </button>
                    <button className="qty-btn" onClick={() => { setNoteDialogItem(item); setNoteText(item.notes); }} data-testid={`button-note-${item.cartKey}`}>
                      <FileText size={12} style={{ color: item.notes ? "var(--green)" : undefined }} />
                    </button>
                    <button className="qty-btn" onClick={() => removeFromCart(item.cartKey)} data-testid={`button-remove-${item.cartKey}`}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="sheet-actions">
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => { setRondaSheetOpen(false); setViewMode("menu"); }} data-testid="button-add-more-from-sheet">
                <Plus size={16} /> Agregar Mas
              </button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => { sendRoundMutation.mutate(); setRondaSheetOpen(false); }} disabled={sendRoundMutation.isPending} data-testid="button-send-round-sheet">
                {sendRoundMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                Enviar a Cocina
              </button>
            </div>
          </div>
        </div>
      )}

      {modifierDialogProduct && (
        <div className="td-overlay" data-testid="modifier-dialog-overlay" onClick={() => { setModifierDialogProduct(null); setModifierGroups([]); setSelectedModifiers({}); setPendingClickEvent(null); }}>
          <div className="td-bottom-sheet td-dialog-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-drag-handle" />
            <div style={{ padding: "0 16px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span className="td-section-title" style={{ margin: 0 }}>{modifierDialogProduct.name}</span>
              <span className="oi-price">{formatCurrency(modifierDialogProduct.price)}</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 8px" }}>
              {modifierGroups.map((group) => (
                <div key={group.id} style={{ marginBottom: 16 }} data-testid={`modifier-group-${group.id}`}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <span className="oi-name" style={{ fontWeight: 600 }}>{group.name}</span>
                    {group.required && <span className="badge-ds badge-amber">Requerido</span>}
                    {group.multiSelect && <span className="oi-mods">(varias opciones)</span>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {group.options.map((opt) => {
                      const isSelected = (selectedModifiers[group.id] || []).includes(opt.id);
                      return (
                        <div
                          key={opt.id}
                          className={`modifier-option ${isSelected ? "selected" : ""}`}
                          onClick={() => toggleModifierOption(group.id, opt.id, group.multiSelect)}
                          data-testid={`modifier-option-${opt.id}`}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {group.multiSelect ? (
                              <Checkbox checked={isSelected} className="pointer-events-none" />
                            ) : (
                              <div className={`radio-dot ${isSelected ? "selected" : ""}`}>
                                {isSelected && <div className="radio-dot-inner" />}
                              </div>
                            )}
                            <span className="oi-name">{opt.name}</span>
                          </div>
                          {Number(opt.priceDelta) > 0 && (
                            <span className="oi-mods">+{formatCurrency(opt.priceDelta)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="sheet-actions">
              <button
                className="btn-secondary"
                style={{ flex: 1 }}
                onClick={() => { setModifierDialogProduct(null); setModifierGroups([]); setSelectedModifiers({}); setPendingClickEvent(null); }}
                data-testid="button-cancel-modifiers"
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                style={{ flex: 1 }}
                onClick={confirmModifierSelection}
                data-testid="button-confirm-modifiers"
              >
                <Plus size={16} /> Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {voidDialogItem && (() => {
        const requiresManagerPin = !!voidDialogItem.sentToKitchenAt;
        const handlePinDigit = (digit: string) => {
          if (managerPin.length >= 4) return;
          setManagerPin(prev => prev + digit);
          setManagerPinError("");
        };
        const handlePinDelete = () => {
          setManagerPin(prev => prev.slice(0, -1));
          setManagerPinError("");
        };
        const handlePinClear = () => {
          setManagerPin("");
          setManagerPinError("");
        };
        const canSubmitVoid = requiresManagerPin
          ? managerPin.length === 4 && voidReason.trim().length > 0
          : true;

        return (
          <div className="td-overlay" data-testid="void-dialog-overlay">
            <div className="td-dialog-center" onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: 16 }}>
                <h3 className="td-section-title" style={{ margin: "0 0 12px" }}>
                  {requiresManagerPin ? "Autorización del Gerente" : "Ajustar / Anular Item"}
                </h3>
                <p className="oi-name" style={{ fontWeight: 700, marginBottom: 12 }}>{voidDialogItem.productNameSnapshot}</p>
                {requiresManagerPin && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, padding: "6px 10px", borderRadius: 6, background: "var(--amber-bg, rgba(245,158,11,0.1))", border: "1px solid var(--amber-border, rgba(245,158,11,0.3))" }}>
                    <AlertCircle size={14} style={{ color: "var(--amber, #f59e0b)", flexShrink: 0 }} />
                    <span className="oi-mods" style={{ color: "var(--amber, #f59e0b)" }}>
                      Item enviado a cocina. Se requiere PIN de gerente.
                    </span>
                  </div>
                )}
                <div className="void-qty-row">
                  <span className="oi-mods">Cantidad a anular</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button
                      className="qty-btn"
                      onClick={() => setVoidQty(q => Math.max(1, q - 1))}
                      disabled={voidQty <= 1}
                      data-testid="button-void-qty-minus"
                    >
                      <Minus size={14} />
                    </button>
                    <span className="qty-val" style={{ fontSize: 18, width: 32 }} data-testid="text-void-qty">{voidQty}</span>
                    <button
                      className="qty-btn"
                      onClick={() => setVoidQty(q => Math.min(voidDialogItem.qty, q + 1))}
                      disabled={voidQty >= voidDialogItem.qty}
                      data-testid="button-void-qty-plus"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <span className="oi-mods">
                    {voidQty < voidDialogItem.qty
                      ? `Quedan: ${voidDialogItem.qty - voidQty} unidad${(voidDialogItem.qty - voidQty) !== 1 ? "es" : ""}`
                      : "Anulacion total"}
                  </span>
                  <span className="oi-price">{formatCurrency(Number(voidDialogItem.productPriceSnapshot) * voidQty)}</span>
                </div>
                <textarea
                  className="field-input"
                  placeholder={requiresManagerPin ? "Motivo de anulación (requerido)" : "Motivo de anulacion (opcional)"}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  rows={2}
                  style={{ width: "100%", marginBottom: 12, resize: "none" }}
                  data-testid="input-void-reason"
                />
                {requiresManagerPin && (
                  <div style={{ marginBottom: 12 }}>
                    <span className="oi-mods" style={{ display: "block", marginBottom: 8, fontWeight: 600 }}>PIN del Gerente</span>
                    <div style={{ display: "flex", justifyContent: "center", gap: 10, marginBottom: 12 }}>
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            border: "2px solid var(--border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 20,
                            fontWeight: 700,
                            background: managerPin.length > i ? "var(--foreground)" : "transparent",
                            transition: "background 0.15s",
                          }}
                          data-testid={`pin-dot-${i}`}
                        >
                          {managerPin.length > i && (
                            <span style={{ color: "var(--background)", fontSize: 14 }}>*</span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, maxWidth: 220, margin: "0 auto" }}>
                      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                        <button
                          key={digit}
                          className="btn-secondary"
                          style={{ padding: "10px 0", fontSize: 18, fontWeight: 600 }}
                          onClick={() => handlePinDigit(digit)}
                          disabled={managerPin.length >= 4}
                          data-testid={`button-pin-${digit}`}
                        >
                          {digit}
                        </button>
                      ))}
                      <button
                        className="btn-secondary"
                        style={{ padding: "10px 0", fontSize: 12 }}
                        onClick={handlePinClear}
                        data-testid="button-pin-clear"
                      >
                        <X size={16} />
                      </button>
                      <button
                        className="btn-secondary"
                        style={{ padding: "10px 0", fontSize: 18, fontWeight: 600 }}
                        onClick={() => handlePinDigit("0")}
                        disabled={managerPin.length >= 4}
                        data-testid="button-pin-0"
                      >
                        0
                      </button>
                      <button
                        className="btn-secondary"
                        style={{ padding: "10px 0", fontSize: 12 }}
                        onClick={handlePinDelete}
                        data-testid="button-pin-delete"
                      >
                        <ArrowLeft size={16} />
                      </button>
                    </div>
                    {managerPinError && (
                      <div style={{ marginTop: 8, padding: "6px 10px", borderRadius: 6, background: "var(--red-bg, rgba(239,68,68,0.1))", border: "1px solid var(--red-border, rgba(239,68,68,0.3))", display: "flex", alignItems: "center", gap: 6 }}>
                        <AlertCircle size={14} style={{ color: "var(--red)", flexShrink: 0 }} />
                        <span className="oi-mods" style={{ color: "var(--red)" }} data-testid="text-pin-error">{managerPinError}</span>
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1 }}
                    onClick={() => { setVoidDialogItem(null); setVoidReason(""); setVoidQty(1); setManagerPin(""); setManagerPinError(""); }}
                    data-testid="button-cancel-void"
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn-danger"
                    style={{ flex: 1 }}
                    disabled={voidItemMutation.isPending || !canSubmitVoid}
                    onClick={() => {
                      if (requiresManagerPin && !voidReason.trim()) {
                        setManagerPinError("El motivo es requerido para anular items enviados a cocina");
                        return;
                      }
                      if (activeOrder) {
                        voidItemMutation.mutate({
                          orderId: activeOrder.id,
                          itemId: voidDialogItem.id,
                          reason: voidReason,
                          qtyToVoid: voidQty,
                          managerPin: requiresManagerPin ? managerPin : undefined,
                        });
                      }
                    }}
                    data-testid="button-confirm-void"
                  >
                    {voidItemMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                    {requiresManagerPin ? "Autorizar Anulación" : (voidQty < voidDialogItem.qty ? `Anular ${voidQty}` : "Anular todo")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {noteDialogItem && (
        <div className="td-overlay" data-testid="note-dialog-overlay" onClick={() => { setNoteDialogItem(null); setNoteText(""); }}>
          <div className="td-bottom-sheet td-dialog-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-drag-handle" />
            <div style={{ padding: "0 16px" }}>
              <h3 className="td-section-title" style={{ margin: "0 0 12px" }}>Nota para {noteDialogItem.name}</h3>
              <textarea
                className="field-input"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value.slice(0, 200))}
                placeholder="Escribe una nota..."
                rows={3}
                style={{ width: "100%", resize: "none", marginBottom: 4 }}
                data-testid="input-note-text"
              />
              <p className="oi-mods" style={{ textAlign: "right", marginBottom: 12 }}>{noteText.length}/200</p>
              <div style={{ display: "flex", gap: 8, paddingBottom: 16 }}>
                {noteDialogItem.notes && (
                  <button className="btn-danger" style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => {
                    setCart(cart.map(c => c.cartKey === noteDialogItem.cartKey ? { ...c, notes: "" } : c));
                    setNoteDialogItem(null);
                    setNoteText("");
                    toast({ title: "Nota eliminada" });
                  }} data-testid="button-delete-note">
                    <Trash2 size={12} /> Borrar
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button className="btn-secondary" onClick={() => { setNoteDialogItem(null); setNoteText(""); }} data-testid="button-cancel-note">
                  Cancelar
                </button>
                <button className="btn-primary" onClick={() => {
                  setCart(cart.map(c => c.cartKey === noteDialogItem.cartKey ? { ...c, notes: noteText } : c));
                  setNoteDialogItem(null);
                  setNoteText("");
                  toast({ title: "Nota guardada" });
                }} data-testid="button-save-note">
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const tdStyles = `
  .td-screen {
    min-height: 100dvh;
    background: var(--s0);
    display: flex;
    flex-direction: column;
    font-family: var(--f-body);
    color: var(--text);
    overscroll-behavior: contain;
  }

  .td-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 18px;
    background: var(--s0);
    border-bottom: 1px solid var(--border-ds);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .td-content {
    flex: 1;
    overflow-y: auto;
  }

  .td-section {
    padding: 12px 18px;
  }

  .td-section-title {
    font-family: var(--f-disp);
    font-size: 18px;
    font-weight: 800;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .td-label {
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--text3);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .td-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 0;
    text-align: center;
  }

  .td-empty-text {
    font-family: var(--f-mono);
    font-size: 12px;
    color: var(--text3);
    text-align: center;
    padding: 8px 0;
  }

  .td-skeleton {
    background: var(--s2);
    border-radius: var(--r-sm);
    animation: skeleton-pulse 1.5s infinite;
  }
  @keyframes skeleton-pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
  }

  .td-select {
    background: var(--s2);
    border: 1px solid var(--border-ds);
    border-radius: var(--r-sm);
    padding: 6px 10px;
    color: var(--text2);
    font-family: var(--f-mono);
    font-size: 11px;
    outline: none;
  }

  .td-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .td-overlay-bg {
    position: absolute;
    inset: 0;
    background: rgba(0,0,0,0.5);
  }

  .td-bottom-sheet {
    position: relative;
    background: var(--s0);
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--border-ds);
    z-index: 1;
  }
  .td-dialog-sheet {
    max-height: 80vh;
  }

  .td-dialog-center {
    position: relative;
    background: var(--s1);
    border: 1.5px solid var(--border-ds);
    border-radius: var(--r-md);
    width: 90%;
    max-width: 380px;
    margin: auto;
    z-index: 1;
  }

  .sheet-drag-handle {
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--s3);
    margin: 8px auto;
  }

  .sheet-actions {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    padding-bottom: max(12px, env(safe-area-inset-bottom, 12px));
    border-top: 1px solid var(--border-ds);
  }

  /* ── HEADER ── */
  .back-btn {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: var(--s2);
    border: 1px solid var(--border-ds);
    color: var(--text);
    cursor: pointer;
    transition: all var(--t-fast);
    flex-shrink: 0;
  }
  .back-btn:active { background: var(--s3); }

  .header-title {
    font-family: var(--f-disp);
    font-size: 20px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .header-sub {
    font-family: var(--f-mono);
    font-size: 11px;
    color: var(--text2);
    margin-top: 2px;
  }

  /* ── VIEW TABS ── */
  .view-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-ds);
    background: var(--s0);
    position: sticky;
    top: 55px;
    z-index: 19;
  }
  .view-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 0;
    font-family: var(--f-body);
    font-size: 14px;
    font-weight: 500;
    color: var(--text3);
    cursor: pointer;
    border: none;
    background: none;
    border-bottom: 2px solid transparent;
    transition: all var(--t-fast);
  }
  .view-tab.active-order { color: var(--text); border-bottom-color: var(--green); }
  .view-tab.active-menu  { color: var(--text); border-bottom-color: var(--blue); }
  .tab-badge {
    background: var(--green-d);
    color: var(--green);
    font-family: var(--f-mono);
    font-size: 10px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 20px;
  }

  /* ── CARDS ── */
  .card-ds {
    background: var(--s1);
    border: 1.5px solid var(--border-ds);
    border-radius: var(--r-md);
    padding: 14px;
    transition: all var(--t-fast);
  }
  .card-ds.card-active {
    border-color: var(--green-m);
  }
  .card-ds-header {
    margin-bottom: 10px;
  }

  /* ── BADGES ── */
  .badge-ds {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 20px;
    font-family: var(--f-mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .badge-green  { background: var(--green-d); color: var(--green); border: 1px solid var(--green-m); }
  .badge-blue   { background: var(--blue-d);  color: var(--blue); }
  .badge-amber  { background: var(--amber-d); color: var(--amber); }
  .badge-red    { background: var(--red-d);   color: var(--red); }
  .badge-muted  { background: var(--s2); color: var(--text3); }

  /* ── BUTTONS ── */
  .btn-primary {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 12px 24px;
    background: var(--green); color: #050f08;
    font-family: var(--f-disp); font-size: 15px; font-weight: 800;
    letter-spacing: 0.05em; text-transform: uppercase;
    border: none; border-radius: var(--r-sm); cursor: pointer;
    transition: all var(--t-fast); min-height: 48px;
  }
  .btn-primary:active:not(:disabled) { transform: scale(0.97); }
  .btn-primary:disabled { background: var(--s3); color: var(--text3); cursor: not-allowed; }

  .btn-secondary {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 20px;
    background: var(--s2); color: var(--text2);
    font-family: var(--f-body); font-size: 14px; font-weight: 500;
    border: 1px solid var(--border-ds); border-radius: var(--r-sm); cursor: pointer;
    transition: all var(--t-fast); min-height: 44px;
  }
  .btn-secondary:active:not(:disabled) { background: var(--s3); }

  .btn-danger {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 20px;
    background: var(--red-d); color: var(--red);
    font-family: var(--f-body); font-size: 14px; font-weight: 500;
    border: 1px solid rgba(239,68,68,0.2); border-radius: var(--r-sm); cursor: pointer;
    transition: all var(--t-fast); min-height: 44px;
  }

  .btn-icon-sm {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    background: var(--s2); color: var(--text2);
    border: 1px solid var(--border-ds); border-radius: var(--r-xs);
    cursor: pointer; transition: all var(--t-fast);
  }
  .btn-icon-sm:active { background: var(--s3); }

  /* ── QR BANNER ── */
  .qr-banner {
    display: flex; align-items: center; gap: 12px;
    background: var(--amber-d);
    border: 1px solid rgba(243,156,18,0.25);
    border-radius: var(--r-md);
    padding: 12px 16px;
    margin-bottom: 12px;
  }
  .qr-banner-text { flex: 1; }
  .qr-banner-title {
    font-family: var(--f-disp); font-size: 14px; font-weight: 700; color: var(--amber);
  }
  .qr-banner-btn {
    padding: 8px 16px; border-radius: var(--r-sm);
    background: var(--amber); color: #1a0f00;
    font-family: var(--f-disp); font-size: 13px; font-weight: 700;
    border: none; cursor: pointer; white-space: nowrap;
    display: inline-flex; align-items: center; gap: 6px;
  }

  .qr-submission-header {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    cursor: pointer;
    padding: 4px 0;
  }

  /* ── ROUND SECTIONS ── */
  .round-section { padding: 0; margin-bottom: 4px; }
  .round-header {
    display: flex; align-items: center; gap: 8px;
    padding: 14px 0 8px;
  }
  .round-pill {
    background: var(--s2);
    border: 1px solid var(--border-ds);
    border-radius: 20px;
    padding: 4px 12px;
    font-family: var(--f-disp);
    font-size: 12px;
    font-weight: 700;
    color: var(--text2);
    white-space: nowrap;
  }
  .round-line { flex: 1; height: 1px; background: var(--border-ds); }
  .round-time {
    font-family: var(--f-mono); font-size: 10px; color: var(--text3);
  }

  /* ── ORDER ITEMS ── */
  .order-item {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 0;
    border-bottom: 1px solid var(--border-ds);
  }
  .order-item:last-child { border-bottom: none; }
  .oi-qty {
    width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    background: var(--s2); border: 1px solid var(--border-ds);
    border-radius: var(--r-xs);
    font-family: var(--f-mono); font-size: 12px; font-weight: 600;
    color: var(--text); flex-shrink: 0;
  }
  .oi-info { flex: 1; min-width: 0; }
  .oi-name {
    font-family: var(--f-body); font-size: 14px;
    font-weight: 500; color: var(--text);
    display: block;
  }
  .oi-mods {
    font-family: var(--f-mono); font-size: 11px;
    color: var(--text3); margin-top: 2px;
    display: block;
  }
  .oi-customer {
    font-family: var(--f-mono); font-size: 10px;
    color: var(--text3); margin-top: 2px;
    display: block;
  }
  .oi-right { text-align: right; flex-shrink: 0; }
  .oi-price {
    font-family: var(--f-mono); font-size: 13px;
    font-weight: 600; color: var(--text);
  }
  .oi-status {
    font-family: var(--f-mono); font-size: 9px;
    letter-spacing: 0.08em; text-transform: uppercase;
    margin-top: 3px; padding: 2px 6px; border-radius: 4px;
    display: inline-block;
  }
  .oi-status.kitchen { background: var(--blue-d); color: var(--blue); }
  .oi-status.ready   { background: var(--green-d); color: var(--green); }
  .oi-status.preparing { background: var(--amber-d); color: var(--amber); }

  /* ── ORDER TOTALS ── */
  .order-totals {
    padding: 12px 0 0;
    border-top: 1px solid var(--border-ds);
    margin-top: 8px;
  }
  .ot-row {
    display: flex; justify-content: space-between; padding: 4px 0;
  }
  .ot-row .label {
    font-family: var(--f-mono); font-size: 12px; color: var(--text3);
  }
  .ot-row .val {
    font-family: var(--f-mono); font-size: 12px; color: var(--text2);
  }
  .ot-sep { height: 1px; background: var(--border-ds); margin: 6px 0; }
  .ot-total .label {
    font-family: var(--f-disp); font-size: 16px;
    font-weight: 800; color: var(--text);
  }
  .ot-total .val {
    font-family: var(--f-mono); font-size: 18px;
    font-weight: 600; color: var(--green);
  }

  /* ── SPLIT MODE ── */
  .split-tabs {
    display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;
  }
  .split-tab {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 14px;
    background: var(--s2); color: var(--text2);
    border: 1px solid var(--border-ds); border-radius: var(--r-sm);
    font-family: var(--f-body); font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all var(--t-fast);
  }
  .split-tab.active {
    background: var(--green-d); color: var(--green);
    border-color: var(--green-m);
  }
  .split-tab:disabled { opacity: 0.5; cursor: not-allowed; }

  .split-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px;
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all var(--t-fast);
    margin-bottom: 4px;
  }
  .split-item:hover { background: var(--s2); }
  .split-item.selected {
    background: var(--green-d);
    border: 1px solid var(--green-m);
    border-radius: var(--r-sm);
  }

  .subaccount-group {
    border: 1px solid var(--border-ds);
    border-radius: var(--r-sm);
    margin-bottom: 8px;
  }
  .subaccount-toggle {
    width: 100%;
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px;
    background: none; border: none;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .subaccount-toggle:active { background: var(--s2); }

  /* ── MENU VIEW ── */
  .menu-sticky-header {
    position: sticky; top: 0; z-index: 9;
    background: var(--s0);
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-ds);
  }
  .menu-products-area {
    padding: 12px 14px 16px;
    flex: 1;
    overflow-y: auto;
  }

  .top-cats {
    display: flex; gap: 6px; flex: 1;
  }
  .top-cat {
    flex: 1;
    display: flex; align-items: center; justify-content: center;
    height: 44px;
    border-radius: var(--r-sm);
    border: 1.5px solid var(--border-ds);
    background: var(--s2);
    color: var(--text3);
    font-family: var(--f-disp); font-size: 14px; font-weight: 700;
    cursor: pointer; transition: all var(--t-fast);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    padding: 0 8px;
  }
  .top-cat.active-emerald {
    background: rgba(16,185,129,0.12);
    border-color: rgba(16,185,129,0.35);
    color: #10b981;
  }
  .top-cat.active-blue {
    background: var(--blue-d);
    border-color: rgba(59,130,246,0.35);
    color: var(--blue);
  }
  .top-cat.active-rose {
    background: var(--red-d);
    border-color: rgba(239,68,68,0.35);
    color: var(--red);
  }

  .sub-cats {
    display: flex; gap: 6px; flex-wrap: wrap;
  }
  .sub-cat {
    padding: 6px 14px;
    border-radius: 20px;
    border: 1px solid var(--border-ds);
    background: transparent;
    color: var(--text3);
    font-family: var(--f-mono); font-size: 11px;
    cursor: pointer; transition: all var(--t-fast);
    white-space: nowrap;
  }
  .sub-cat.active {
    border-color: var(--border2);
    background: var(--s3);
    color: var(--text2);
  }

  /* ── PRODUCTS GRID ── */
  .products-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .product-card {
    background: var(--s1);
    border: 1.5px solid var(--border-ds);
    border-radius: var(--r-md);
    padding: 12px;
    cursor: pointer;
    transition: all var(--t-fast);
    position: relative;
    min-height: 90px;
    display: flex;
    flex-direction: column;
  }
  .product-card:active:not(.unavailable) {
    transform: scale(0.96);
    border-color: var(--border2);
  }
  .product-card.unavailable { opacity: 0.45; cursor: not-allowed; }
  .pc-name {
    font-family: var(--f-body); font-size: 13px;
    font-weight: 500; color: var(--text);
    line-height: 1.3;
  }
  .pc-price {
    font-family: var(--f-mono); font-size: 13px;
    font-weight: 600; color: var(--green);
    margin-top: 4px;
  }
  .pc-add {
    position: absolute; bottom: 10px; right: 10px;
    width: 28px; height: 28px;
    border-radius: 7px;
    background: var(--green); color: #050f08;
    display: flex; align-items: center; justify-content: center;
  }
  .pc-in-cart {
    position: absolute; top: 8px; right: 8px;
    background: var(--green); color: #050f08;
    font-family: var(--f-mono); font-size: 10px; font-weight: 700;
    padding: 2px 7px; border-radius: 20px;
  }
  .pc-agotado {
    position: absolute; top: 8px; right: 8px;
    background: var(--red-d); color: var(--red);
    border: 1px solid rgba(239,68,68,0.3);
    font-family: var(--f-mono); font-size: 9px; font-weight: 600;
    padding: 2px 7px; border-radius: 20px;
    letter-spacing: 0.06em; text-transform: uppercase;
  }
  .pc-portions {
    position: absolute; top: 8px; right: 8px;
    background: var(--s2); color: var(--text3);
    font-family: var(--f-mono); font-size: 10px; font-weight: 600;
    padding: 2px 7px; border-radius: 20px;
  }

  /* ── CART FAB ── */
  .cart-fab-bar {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 20;
    background: var(--s0);
    border-top: 1px solid var(--border-ds);
    padding: 10px 18px;
    padding-bottom: max(10px, env(safe-area-inset-bottom, 10px));
    display: flex; gap: 8px; align-items: center;
  }
  .cart-fab {
    flex: 1;
    display: flex; align-items: center; gap: 8px;
    background: var(--green); color: #050f08;
    border-radius: var(--r-sm); padding: 12px 16px;
    font-family: var(--f-disp); font-size: 15px; font-weight: 800;
    border: none; cursor: pointer;
    transition: all var(--t-fast);
  }
  .cart-fab:active { transform: scale(0.97); }
  .cart-fab-total {
    margin-left: auto;
    font-family: var(--f-mono); font-weight: 700;
  }
  .cart-send-btn {
    width: 48px; height: 48px;
    display: flex; align-items: center; justify-content: center;
    background: var(--green); color: #050f08;
    border: none; border-radius: var(--r-sm);
    cursor: pointer; flex-shrink: 0;
    transition: all var(--t-fast);
  }
  .cart-send-btn:active { transform: scale(0.95); }
  .cart-send-btn:disabled { background: var(--s3); color: var(--text3); cursor: not-allowed; }

  /* ── CART SHEET ITEMS ── */
  .cart-sheet-item {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-ds);
    min-height: 50px;
  }
  .cart-sheet-item:last-child { border-bottom: none; }

  .cart-qty-controls {
    display: flex; align-items: center; gap: 2px; flex-shrink: 0;
  }
  .qty-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: var(--s2); color: var(--text2);
    border: 1px solid var(--border-ds); border-radius: var(--r-xs);
    cursor: pointer; transition: all var(--t-fast);
  }
  .qty-btn:active { background: var(--s3); }
  .qty-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .qty-val {
    width: 24px; text-align: center;
    font-family: var(--f-mono); font-size: 13px; font-weight: 700;
    color: var(--text);
  }

  /* ── MODIFIER OPTIONS ── */
  .modifier-option {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px;
    border: 1px solid var(--border-ds);
    border-radius: var(--r-sm);
    cursor: pointer;
    transition: all var(--t-fast);
    min-height: 44px;
  }
  .modifier-option:hover { background: var(--s2); }
  .modifier-option.selected {
    background: var(--green-d);
    border-color: var(--green-m);
  }

  .radio-dot {
    width: 16px; height: 16px;
    border-radius: 50%;
    border: 2px solid var(--text3);
    display: flex; align-items: center; justify-content: center;
  }
  .radio-dot.selected { border-color: var(--green); }
  .radio-dot-inner {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--green);
  }

  /* ── VOID DIALOG ── */
  .void-qty-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px;
    background: var(--s2);
    border-radius: var(--r-sm);
    margin-bottom: 12px;
  }

  /* ── FIELD INPUT ── */
  .field-input {
    background: var(--s2);
    border: 1px solid var(--border-ds);
    border-radius: var(--r-sm);
    padding: 10px 14px;
    color: var(--text);
    font-family: var(--f-body);
    font-size: 14px;
    outline: none;
    transition: border-color var(--t-fast);
  }
  .field-input:focus { border-color: var(--border2); }
  .field-input::placeholder { color: var(--text3); }

  /* ── SEARCH BAR ── */
  .search-bar {
    display: flex; align-items: center; gap: 8px;
    background: var(--s2); border: 1px solid var(--border-ds);
    border-radius: var(--r-sm); padding: 0 14px;
    flex: 1;
  }
  .search-bar input {
    flex: 1; background: none; border: none;
    color: var(--text); font-family: var(--f-body); font-size: 14px;
    padding: 10px 0; outline: none;
  }
  .search-bar input::placeholder { color: var(--text3); }
  .search-icon { color: var(--text3); flex-shrink: 0; }
`;
