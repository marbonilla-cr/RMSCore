import { useState, useCallback, useMemo, useEffect } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  UtensilsCrossed, Plus, Loader2, Check, ChevronLeft, ChevronRight,
  X, Users, User, ArrowRight, Coffee, ChefHat,
  Utensils, Send, CheckCircle2, ShoppingBag, ChevronDown,
} from "lucide-react";

type Step = "welcome" | "subaccount" | "name" | "menu" | "modifiers" | "review" | "sent";

interface QRProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  categoryName: string | null;
  categoryFoodType: string;
  categoryParentCode: string | null;
  availablePortions: number | null;
}

interface QRTopCategory {
  code: string;
  name: string;
}

interface QRMenuResponse {
  products: QRProduct[];
  topCategories: QRTopCategory[];
}

interface QRModifierGroup {
  id: number;
  name: string;
  required: boolean;
  multiSelect: boolean;
  options: { id: number; name: string; priceDelta: string }[];
}

interface Subaccount {
  id: number;
  orderId: number;
  tableId: number;
  slotNumber: number;
  code: string;
  label: string;
  isActive: boolean;
}

interface CartItem {
  productId: number;
  productName: string;
  qty: number;
  customerName: string;
  modifiers?: { modGroupId: number; optionId: number }[];
  categoryName: string;
}

const MAX_SUBACCOUNTS = 6;
const TOTAL_STEPS = 4;

function EasyStepLayout({
  step, totalSteps, title, subtitle, children, stickyButton, onBack,
}: {
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  stickyButton?: React.ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="sticky top-0 z-[9999] bg-background border-b px-4 py-3">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3">
            {onBack && (
              <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-step-back">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground font-medium" data-testid="text-step-progress">
                Paso {step} de {totalSteps}
              </p>
              <h1 className="text-lg font-bold truncate" data-testid="text-step-title">{title}</h1>
            </div>
          </div>
          {subtitle && <p className="text-sm text-muted-foreground mt-1" data-testid="text-step-subtitle">{subtitle}</p>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto">
          {children}
        </div>
      </div>
      {stickyButton && (
        <div className="sticky bottom-0 z-[9999] bg-background border-t px-4 py-3">
          <div className="max-w-md mx-auto">
            {stickyButton}
          </div>
        </div>
      )}
    </div>
  );
}

function ProductCard({
  product, inCart, outOfStock, loading, onSelect,
}: {
  product: QRProduct;
  inCart: number;
  outOfStock: boolean;
  loading: boolean;
  onSelect: () => void;
}) {
  return (
    <Card className={outOfStock ? "opacity-50" : ""} data-testid={`card-product-${product.id}`}>
      <CardContent className="p-3 flex flex-col h-full">
        <p className="font-semibold text-base line-clamp-2">{product.name}</p>
        <p className="font-bold text-base mt-1">{"\u20A1"}{Number(product.price).toLocaleString()}</p>
        {inCart > 0 && (
          <Badge variant="secondary" className="text-xs mt-1 w-fit">{inCart}x</Badge>
        )}
        <div className="mt-auto pt-2">
          <Button
            className="w-full min-h-[48px] text-base"
            variant={outOfStock ? "secondary" : "default"}
            onClick={onSelect}
            disabled={loading || outOfStock}
            data-testid={`button-add-${product.id}`}
          >
            {outOfStock ? "Agotado" : (
              <>
                <Plus className="w-5 h-5 mr-1" />
                Agregar
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function QRClientPage() {
  const [, params] = useRoute("/qr/:tableCode");
  const tableCode = params?.tableCode || "";
  const { toast } = useToast();

  const [step, setStep] = useState<Step>("welcome");
  const [selectedSubaccount, setSelectedSubaccount] = useState<{ id: number; code: string; slotNumber: number } | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [nameError, setNameError] = useState("");

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [selectedFoodType, setSelectedFoodType] = useState<"bebidas" | "comidas" | "extras">("comidas");
  const [selectedQrTopCode, setSelectedQrTopCode] = useState<string | null>(null);
  const [selectedQrSubcat, setSelectedQrSubcat] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [pendingProduct, setPendingProduct] = useState<QRProduct | null>(null);
  const [modGroups, setModGroups] = useState<QRModifierGroup[]>([]);
  const [selectedMods, setSelectedMods] = useState<Record<number, number[]>>({});
  const [loadingMods, setLoadingMods] = useState(false);

  const { data: tableInfo, isLoading: tableLoading, error: tableError } = useQuery<{
    tableId: number;
    tableName: string;
    tableCode: string;
    maxSubaccounts: number;
  }>({
    queryKey: ["/api/qr", tableCode, "info"],
    enabled: !!tableCode,
  });

  const { data: menuData } = useQuery<QRMenuResponse>({
    queryKey: ["/api/qr", tableCode, "menu"],
    queryFn: async () => {
      const res = await fetch(`/api/qr/${tableCode}/menu`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load menu");
      return res.json();
    },
    enabled: !!tableCode && step !== "welcome",
  });
  const menu = menuData?.products || [];
  const qrTopCategories = menuData?.topCategories || [];

  const { data: subaccounts = [], refetch: refetchSubaccounts } = useQuery<Subaccount[]>({
    queryKey: ["/api/qr", tableCode, "subaccounts"],
    enabled: !!tableCode,
  });

  const activeSubaccounts = subaccounts.filter(s => s.isActive);

  const hasQrTopSystem = qrTopCategories.length > 0;

  useEffect(() => {
    if (hasQrTopSystem && qrTopCategories.length > 0 && !selectedQrTopCode) {
      setSelectedQrTopCode(qrTopCategories[0].code);
    }
  }, [hasQrTopSystem, qrTopCategories.length]);

  const subcatsForQrTop = useMemo(() => {
    if (!hasQrTopSystem || !selectedQrTopCode) return [];
    const cats = new Map<string, QRProduct[]>();
    menu.filter(p => p.categoryParentCode === selectedQrTopCode).forEach(p => {
      const c = p.categoryName || "Otros";
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c)!.push(p);
    });
    return Array.from(cats.entries()).map(([name, products]) => ({ name, products }));
  }, [menu, hasQrTopSystem, selectedQrTopCode]);

  useEffect(() => {
    if (subcatsForQrTop.length > 0) {
      setSelectedQrSubcat(subcatsForQrTop[0].name);
    } else {
      setSelectedQrSubcat(null);
    }
  }, [selectedQrTopCode, subcatsForQrTop.length]);

  const filteredProducts = useMemo(() => {
    if (hasQrTopSystem && selectedQrTopCode) {
      if (selectedQrSubcat) {
        return menu.filter(p => p.categoryParentCode === selectedQrTopCode && p.categoryName === selectedQrSubcat);
      }
      return menu.filter(p => p.categoryParentCode === selectedQrTopCode);
    }
    return menu.filter(p => (p.categoryFoodType || "comidas") === selectedFoodType);
  }, [menu, selectedFoodType, hasQrTopSystem, selectedQrTopCode, selectedQrSubcat]);

  const categoriesForFoodType = useMemo(() => {
    if (hasQrTopSystem) return [];
    const cats = new Map<string, QRProduct[]>();
    filteredProducts.forEach(p => {
      const c = p.categoryName || "Otros";
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c)!.push(p);
    });
    return Array.from(cats.entries()).map(([name, products]) => ({ name, products }));
  }, [filteredProducts, hasQrTopSystem]);

  useEffect(() => {
    if (categoriesForFoodType.length > 0) {
      setExpandedCategory(categoriesForFoodType[0].name);
    } else {
      setExpandedCategory(null);
    }
  }, [selectedFoodType, categoriesForFoodType.length]);

  const createSubaccountMutation = useMutation({
    mutationFn: async (slotNum?: number) => {
      const res = await apiRequest("POST", `/api/qr/${tableCode}/subaccounts`, slotNum ? { slotNumber: slotNum } : {});
      return res.json();
    },
    onSuccess: (data: Subaccount) => {
      setSelectedSubaccount({ id: data.id, code: data.code, slotNumber: data.slotNumber });
      queryClient.invalidateQueries({ queryKey: ["/api/qr", tableCode, "subaccounts"] });
      setStep("name");
    },
    onError: (err: Error) => {
      if (err.message.includes("max") || err.message.includes("limit") || err.message.includes("Máximo")) {
        toast({ title: "Límite alcanzado", description: `Ya hay ${MAX_SUBACCOUNTS} cuentas en esta mesa. Usá una existente o pedile al salonero.`, variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Se fue la señal un toque. Probá de nuevo.", variant: "destructive" });
      }
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: { subaccountId: number; items: CartItem[] }) => {
      const items = payload.items.map(it => ({
        productId: it.productId,
        productName: it.productName,
        qty: it.qty,
        customerName: it.customerName,
        modifiers: it.modifiers,
      }));
      return apiRequest("POST", `/api/qr/${tableCode}/submit-v2`, {
        subaccountId: payload.subaccountId,
        items,
      });
    },
    onSuccess: () => setStep("sent"),
    onError: (err: Error) => {
      if (err.message.includes("pending") || err.message.includes("confirmando")) {
        toast({ title: "Esperá un momento", description: "El salonero está confirmando pedidos. Apenas confirme, podés enviar el siguiente.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Se fue la señal un toque. Probá de nuevo.", variant: "destructive" });
      }
    },
  });

  const handleStartOrder = () => {
    setStep("subaccount");
    refetchSubaccounts();
  };

  const handleSubaccountSelect = (sub: Subaccount) => {
    setSelectedSubaccount({ id: sub.id, code: sub.code, slotNumber: sub.slotNumber });
    if (sub.label) {
      setCustomerName(sub.label);
      setStep("menu");
    } else {
      setStep("name");
    }
  };

  const handleNameContinue = () => {
    const trimmed = customerName.trim();
    if (!trimmed) {
      setNameError("Poné tu nombre para que no se nos enrede la cuenta");
      return;
    }
    setNameError("");
    setStep("menu");
  };

  const handleProductClick = useCallback(async (product: QRProduct) => {
    if (product.availablePortions !== null && product.availablePortions <= 0) {
      toast({ title: "Agotado", description: "Eso se nos acabó por hoy. Escogé otra opción.", variant: "destructive" });
      return;
    }
    setLoadingMods(true);
    try {
      const res = await fetch(`/api/products/${product.id}/modifiers`);
      const groups: QRModifierGroup[] = await res.json();
      if (groups.length > 0) {
        setPendingProduct(product);
        setModGroups(groups);
        setSelectedMods({});
        setStep("modifiers");
      } else {
        addItemToCart(product, []);
      }
    } catch {
      addItemToCart(product, []);
    } finally {
      setLoadingMods(false);
    }
  }, [customerName, toast]);

  const addItemToCart = (product: QRProduct, mods: { modGroupId: number; optionId: number }[]) => {
    const name = customerName.trim();
    const item: CartItem = {
      productId: product.id,
      productName: product.name,
      qty: 1,
      customerName: name,
      modifiers: mods.length > 0 ? mods : undefined,
      categoryName: product.categoryName || "Otros",
    };

    setCartItems(prev => {
      const existing = prev.find(it => it.productId === product.id && JSON.stringify(it.modifiers) === JSON.stringify(item.modifiers));
      if (existing) return prev.map(it => it === existing ? { ...it, qty: it.qty + 1 } : it);
      return [...prev, item];
    });
    toast({ title: "Apuntado", description: product.name });
  };

  const confirmModifiers = () => {
    if (!pendingProduct) return;
    for (const group of modGroups) {
      const selected = selectedMods[group.id] || [];
      if (group.required && selected.length === 0) {
        toast({ title: `"${group.name}" es requerido`, variant: "destructive" });
        return;
      }
    }
    const mods: { modGroupId: number; optionId: number }[] = [];
    for (const group of modGroups) {
      for (const optId of (selectedMods[group.id] || [])) {
        mods.push({ modGroupId: group.id, optionId: optId });
      }
    }

    addItemToCart(pendingProduct, mods);

    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    setStep("menu");
  };

  const toggleModOption = (groupId: number, optionId: number, multi: boolean) => {
    setSelectedMods(prev => {
      const current = prev[groupId] || [];
      if (multi) {
        return { ...prev, [groupId]: current.includes(optionId) ? current.filter(id => id !== optionId) : [...current, optionId] };
      }
      return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
    });
  };

  const removeCartItem = (idx: number) => {
    setCartItems(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (!selectedSubaccount) return;
    submitMutation.mutate({ subaccountId: selectedSubaccount.id, items: cartItems });
  };

  const resetAll = () => {
    setStep("welcome");
    setSelectedSubaccount(null);
    setCustomerName("");
    setNameError("");
    setCartItems([]);
    setSelectedFoodType("comidas");
    setExpandedCategory(null);
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
  };

  const cartItemCount = cartItems.reduce((s, it) => s + it.qty, 0);

  if (tableLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" data-testid="loading-spinner">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tableError || !tableInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <UtensilsCrossed className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="font-bold text-lg mb-2" data-testid="text-table-not-found">Mesa no encontrada</h2>
            <p className="text-sm text-muted-foreground">El código QR no es válido o la mesa no está activa.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === "welcome") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <UtensilsCrossed className="w-12 h-12 mx-auto text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-table-name">{tableInfo.tableName}</h1>
            <p className="text-muted-foreground text-base" data-testid="text-welcome-message">Bienvenido! Pedí fácil y sin carrera.</p>
          </div>
          <Button
            className="w-full min-h-[64px] text-lg"
            onClick={handleStartOrder}
            data-testid="button-start-order"
          >
            <ChefHat className="w-6 h-6 mr-3" />
            Empezar a pedir
          </Button>
          <p className="text-xs text-center text-muted-foreground" data-testid="text-welcome-note">
            Tranqui: un salonero confirma tu pedido antes de mandarlo a cocina.
          </p>
        </div>
      </div>
    );
  }

  if (step === "subaccount") {
    const maxSlots = tableInfo?.maxSubaccounts ?? MAX_SUBACCOUNTS;
    const namedSubaccounts = activeSubaccounts.filter(s => s.label);
    const hasNamedSubs = namedSubaccounts.length > 0;
    const canAddMore = activeSubaccounts.length < maxSlots;

    const handleAddComensal = () => {
      const usedSlots = new Set(activeSubaccounts.map(s => s.slotNumber));
      let nextSlot = 1;
      for (let i = 1; i <= maxSlots; i++) {
        if (!usedSlots.has(i)) { nextSlot = i; break; }
      }
      createSubaccountMutation.mutate(nextSlot);
    };

    if (hasNamedSubs) {
      return (
        <EasyStepLayout
          step={1}
          totalSteps={TOTAL_STEPS}
          title="¿Quién sos?"
          subtitle="Escogé tu nombre o agregá un comensal nuevo."
          onBack={() => setStep("welcome")}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              {namedSubaccounts.map(sub => (
                <Button
                  key={sub.id}
                  variant="default"
                  className="min-h-[72px] text-xl font-bold flex items-center gap-3 justify-start px-6"
                  onClick={() => handleSubaccountSelect(sub)}
                  data-testid={`button-sub-name-${sub.id}`}
                >
                  <User className="w-6 h-6 shrink-0" />
                  <span>{sub.label}</span>
                </Button>
              ))}
            </div>
            {canAddMore && (
              <Button
                variant="outline"
                className="w-full min-h-[72px] text-xl font-bold flex items-center gap-3 justify-center"
                onClick={handleAddComensal}
                disabled={createSubaccountMutation.isPending}
                data-testid="button-add-comensal"
              >
                {createSubaccountMutation.isPending ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <Plus className="w-6 h-6" />
                )}
                <span>Agregar comensal</span>
              </Button>
            )}
          </div>
        </EasyStepLayout>
      );
    }

    const slotNumbers = Array.from({ length: maxSlots }, (_, i) => i + 1);
    const existingSlots = new Map(activeSubaccounts.map(s => [s.slotNumber, s]));

    const handleSlotClick = async (slotNum: number) => {
      const existing = existingSlots.get(slotNum);
      if (existing) {
        handleSubaccountSelect(existing);
      } else {
        createSubaccountMutation.mutate(slotNum);
      }
    };

    return (
      <EasyStepLayout
        step={1}
        totalSteps={TOTAL_STEPS}
        title="Escogé tu subcuenta"
        subtitle="Después ordená lo que querás."
        onBack={() => setStep("welcome")}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            {slotNumbers.map(n => {
              const exists = existingSlots.has(n);
              return (
                <Button
                  key={n}
                  variant={exists ? "default" : "outline"}
                  className="min-h-[80px] text-2xl font-bold flex flex-col gap-1"
                  onClick={() => handleSlotClick(n)}
                  disabled={createSubaccountMutation.isPending}
                  data-testid={`button-slot-${n}`}
                >
                  <span className="text-3xl">{n}</span>
                  <span className="text-xs font-normal text-inherit opacity-70">
                    {exists ? "Cuenta activa" : "Cuenta nueva"}
                  </span>
                </Button>
              );
            })}
          </div>
          {createSubaccountMutation.isPending && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm text-muted-foreground">Creando cuenta...</span>
            </div>
          )}
        </div>
      </EasyStepLayout>
    );
  }

  if (step === "name") {
    return (
      <EasyStepLayout
        step={2}
        totalSteps={TOTAL_STEPS}
        title="¿Cómo te llamás?"
        subtitle="Así el salonero lo lee clarito."
        onBack={() => setStep("subaccount")}
        stickyButton={
          <Button
            className="w-full min-h-[64px] text-lg"
            onClick={handleNameContinue}
            data-testid="button-name-continue"
          >
            Continuar
            <ArrowRight className="w-6 h-6 ml-2" />
          </Button>
        }
      >
        <div className="space-y-6 pt-6">
          <User className="w-16 h-16 mx-auto text-primary" />
          <Input
            value={customerName}
            onChange={(e) => { setCustomerName(e.target.value); setNameError(""); }}
            placeholder="Tu nombre"
            className="text-xl min-h-[64px] text-center"
            autoFocus
            data-testid="input-customer-name"
          />
          {nameError && (
            <p className="text-base text-destructive text-center" data-testid="text-name-error">{nameError}</p>
          )}
        </div>
      </EasyStepLayout>
    );
  }

  if (step === "menu") {
    const foodTypeLabels: { key: "bebidas" | "comidas" | "extras"; label: string; icon: React.ReactNode }[] = [
      { key: "bebidas", label: "Bebidas", icon: <Coffee className="w-4 h-4" /> },
      { key: "comidas", label: "Comidas", icon: <ChefHat className="w-4 h-4" /> },
      { key: "extras", label: "Extras", icon: <Utensils className="w-4 h-4" /> },
    ];

    return (
      <div className="min-h-screen bg-background flex flex-col pb-32">
        <div className="sticky top-0 z-[9999] bg-background border-b px-4 py-3">
          <div className="max-w-md mx-auto">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setStep("name")} data-testid="button-step-back">
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground font-medium" data-testid="text-step-progress">
                  Paso 3 de {TOTAL_STEPS}
                </p>
                <h1 className="text-lg font-bold truncate" data-testid="text-step-title">¿Qué querés pedir?</h1>
              </div>
            </div>
            {hasQrTopSystem ? (
              <div className="space-y-2 mt-3">
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${qrTopCategories.length}, 1fr)` }}>
                  {qrTopCategories.map((top) => {
                    const isActive = selectedQrTopCode === top.code;
                    const colorMap: Record<string, string> = {
                      "TOP-COMIDAS": isActive ? "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500" : "bg-background border-border",
                      "TOP-BEBIDAS": isActive ? "bg-blue-600 text-white border-blue-600 dark:bg-blue-500 dark:border-blue-500" : "bg-background border-border",
                      "TOP-POSTRES": isActive ? "bg-rose-600 text-white border-rose-600 dark:bg-rose-500 dark:border-rose-500" : "bg-background border-border",
                    };
                    return (
                      <button
                        key={top.code}
                        className={`text-center text-sm font-semibold transition-colors rounded-md border truncate ${colorMap[top.code] || (isActive ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border")}`}
                        style={{ height: "48px" }}
                        onClick={() => setSelectedQrTopCode(top.code)}
                        data-testid={`button-qr-top-${top.code}`}
                      >
                        {top.name}
                      </button>
                    );
                  })}
                </div>
                {subcatsForQrTop.length > 0 && (
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${subcatsForQrTop.length <= 3 ? subcatsForQrTop.length : 2}, 1fr)` }}>
                    {subcatsForQrTop.map(({ name: catName, products: catProducts }) => {
                      const isActive = selectedQrSubcat === catName;
                      return (
                        <button
                          key={catName}
                          className={`text-center text-sm font-medium transition-colors rounded-md border truncate ${
                            isActive
                              ? "bg-foreground text-background border-foreground"
                              : "bg-background border-border hover-elevate"
                          }`}
                          style={{ height: "48px" }}
                          onClick={() => setSelectedQrSubcat(catName)}
                          data-testid={`button-qr-subcat-${catName}`}
                        >
                          {catName} ({catProducts.length})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {foodTypeLabels.map(ft => (
                  <Button
                    key={ft.key}
                    variant={selectedFoodType === ft.key ? "default" : "outline"}
                    className="min-h-[48px] text-sm font-semibold"
                    onClick={() => setSelectedFoodType(ft.key)}
                    data-testid={`button-food-type-${ft.key}`}
                  >
                    {ft.icon}
                    <span className="ml-1">{ft.label}</span>
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="max-w-md mx-auto">
            {hasQrTopSystem ? (
              filteredProducts.length === 0 ? (
                <div className="text-center py-8">
                  <Utensils className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-lg text-muted-foreground">No hay productos disponibles.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {filteredProducts.map(product => {
                    const inCart = cartItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
                    const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
                    return (
                      <ProductCard
                        key={product.id}
                        product={product}
                        inCart={inCart}
                        outOfStock={outOfStock}
                        loading={loadingMods}
                        onSelect={() => handleProductClick(product)}
                      />
                    );
                  })}
                </div>
              )
            ) : categoriesForFoodType.length === 0 ? (
              <div className="text-center py-8">
                <Utensils className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-lg text-muted-foreground">No hay productos disponibles en esta categoría.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {categoriesForFoodType.map(({ name: catName, products: catProducts }) => {
                  const isExpanded = expandedCategory === catName;
                  return (
                    <div key={catName} data-testid={`category-group-${catName}`}>
                      <button
                        className="w-full flex items-center justify-between gap-2 px-3 py-3 rounded-md hover-elevate min-h-[48px] text-left"
                        onClick={() => setExpandedCategory(isExpanded ? null : catName)}
                        aria-expanded={isExpanded}
                        data-testid={`button-toggle-category-${catName}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                            : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                          <span className="font-semibold text-base truncate">{catName}</span>
                        </div>
                        <Badge variant="secondary" className="text-xs">{catProducts.length}</Badge>
                      </button>
                      {isExpanded && (
                        <div className="px-1 pb-3 pt-1">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {catProducts.map(product => {
                              const inCart = cartItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
                              const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
                              return (
                                <ProductCard
                                  key={product.id}
                                  product={product}
                                  inCart={inCart}
                                  outOfStock={outOfStock}
                                  loading={loadingMods}
                                  onSelect={() => handleProductClick(product)}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-[9999] bg-background border-t px-4 py-3">
          <div className="max-w-md mx-auto space-y-2">
            {cartItemCount > 0 && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="text-cart-count">
                <ShoppingBag className="w-4 h-4" />
                <span>{cartItemCount} item{cartItemCount !== 1 ? "s" : ""} en tu pedido</span>
              </div>
            )}
            <Button
              className="w-full min-h-[56px] text-lg"
              onClick={() => setStep("review")}
              disabled={cartItemCount === 0}
              data-testid="button-review-order"
            >
              Revisar pedido
              <ArrowRight className="w-6 h-6 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "modifiers") {
    return (
      <EasyStepLayout
        step={3}
        totalSteps={TOTAL_STEPS}
        title={`¿Cómo preferís tu ${pendingProduct?.name}?`}
        onBack={() => { setPendingProduct(null); setModGroups([]); setSelectedMods({}); setStep("menu"); }}
        stickyButton={
          <Button
            className="w-full min-h-[64px] text-lg"
            onClick={() => confirmModifiers()}
            data-testid="button-confirm-modifiers"
          >
            Confirmar
            <ArrowRight className="w-6 h-6 ml-2" />
          </Button>
        }
      >
        <div className="space-y-5">
          {modGroups.map(group => (
            <div key={group.id} className="space-y-2" data-testid={`modifier-group-${group.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-lg">{group.name}</span>
                {group.required && <Badge variant="secondary">Requerido</Badge>}
                {group.multiSelect && <span className="text-sm text-muted-foreground">(varias opciones)</span>}
              </div>
              <div className="space-y-2">
                {group.options.map(opt => {
                  const isSelected = (selectedMods[group.id] || []).includes(opt.id);
                  return (
                    <Button
                      key={opt.id}
                      variant={isSelected ? "default" : "outline"}
                      className="w-full min-h-[64px] justify-start text-left text-lg"
                      onClick={() => toggleModOption(group.id, opt.id, group.multiSelect)}
                      data-testid={`button-modifier-${opt.id}`}
                    >
                      {isSelected && <CheckCircle2 className="w-6 h-6 mr-2 flex-shrink-0" />}
                      <span className="flex-1">{opt.name}</span>
                      {Number(opt.priceDelta) !== 0 && (
                        <span className="text-base ml-2">+{"\u20A1"}{Number(opt.priceDelta).toLocaleString()}</span>
                      )}
                    </Button>
                  );
                })}
                {!group.required && (
                  <Button
                    variant={(selectedMods[group.id] || []).length === 0 ? "secondary" : "ghost"}
                    className="w-full min-h-[64px] text-lg"
                    onClick={() => setSelectedMods(prev => ({ ...prev, [group.id]: [] }))}
                    data-testid={`button-modifier-skip-${group.id}`}
                  >
                    No gracias
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </EasyStepLayout>
    );
  }

  if (step === "review") {
    return (
      <EasyStepLayout
        step={4}
        totalSteps={TOTAL_STEPS}
        title="Revisá tu pedido"
        onBack={() => setStep("menu")}
        stickyButton={
          <Button
            className="w-full min-h-[64px] text-lg"
            onClick={handleSubmit}
            disabled={submitMutation.isPending || cartItems.length === 0}
            data-testid="button-confirm-order"
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
            ) : (
              <Send className="w-6 h-6 mr-2" />
            )}
            Confirmar y enviar
          </Button>
        }
      >
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center gap-2 text-base text-muted-foreground" data-testid="text-review-account">
                <Users className="w-5 h-5" />
                <span>Cuenta: {tableInfo.tableName}-{selectedSubaccount?.slotNumber}</span>
              </div>
              <div className="flex items-center gap-2 text-base" data-testid="text-review-name">
                <User className="w-5 h-5 text-muted-foreground" />
                <span className="text-muted-foreground">Nombre:</span>
                <strong>{customerName.trim()}</strong>
              </div>
            </CardContent>
          </Card>

          {cartItems.length > 0 ? (
            <div className="space-y-2">
              {cartItems.map((item, idx) => (
                <Card key={idx} data-testid={`review-item-${idx}`}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-lg">{item.qty}x {item.productName}</p>
                      {item.modifiers && item.modifiers.length > 0 && (
                        <p className="text-sm text-muted-foreground truncate">
                          {item.modifiers.length} modificador{item.modifiers.length !== 1 ? "es" : ""}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCartItem(idx)}
                      data-testid={`button-remove-item-${idx}`}
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-base py-6" data-testid="text-empty-order">No hay items en tu pedido.</p>
          )}

          <Button
            variant="outline"
            className="w-full min-h-[64px] text-lg"
            onClick={() => setStep("menu")}
            data-testid="button-add-more"
          >
            <Plus className="w-6 h-6 mr-2" />
            Agregar algo más
          </Button>
        </div>
      </EasyStepLayout>
    );
  }

  if (step === "sent") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-order-sent">Pedido enviado</h1>
          <p className="text-muted-foreground text-lg" data-testid="text-order-sent-message">
            Ya viene un salonero a confirmarles la orden.
          </p>
          <p className="text-base text-muted-foreground">Gracias por la paciencia, y buen provecho!</p>
          <Button className="min-h-[64px] text-lg" onClick={resetAll} data-testid="button-new-order">
            <Plus className="w-6 h-6 mr-2" />
            Hacer otro pedido
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
