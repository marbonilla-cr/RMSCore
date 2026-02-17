import { useState, useCallback, useMemo } from "react";
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

type Step =
  | "welcome"
  | "subaccount"
  | "name"
  | "easy_food_cats"
  | "easy_food_products"
  | "easy_drink_cats"
  | "easy_drink_products"
  | "easy_modifiers"
  | "easy_review"
  | "std_menu"
  | "std_modifiers"
  | "std_review"
  | "sent";

interface QRProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  categoryName: string | null;
  availablePortions: number | null;
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

interface DinerData {
  name: string;
  items: CartItem[];
}

const MAX_SUBACCOUNTS = 6;
const ITEMS_PER_PAGE = 6;

function isBeverage(categoryName: string | null): boolean {
  if (!categoryName) return false;
  const lower = categoryName.toLowerCase();
  return lower.includes("bebida") || lower.includes("trago") || lower.includes("coctel")
    || lower.includes("cerveza") || lower.includes("vino") || lower.includes("licor")
    || lower.includes("drink") || lower.includes("refresco") || lower.includes("jugo")
    || lower.includes("smoothie") || lower.includes("batido") || lower.includes("café")
    || lower.includes("cafe") || lower.includes("té") || lower.includes("te ");
}

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
      <div className="sticky top-0 z-[9] bg-background border-b px-4 py-3">
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
        <div className="sticky bottom-0 z-[9] bg-background border-t px-4 py-3">
          <div className="max-w-md mx-auto">
            {stickyButton}
          </div>
        </div>
      )}
    </div>
  );
}

function BigCategoryButton({
  label, icon, count, onClick, testId,
}: {
  label: string;
  icon: React.ReactNode;
  count: number;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Button
      variant="outline"
      className="min-h-[80px] text-base font-semibold flex flex-col gap-1 w-full"
      onClick={onClick}
      data-testid={testId}
    >
      {icon}
      <span className="truncate w-full text-center">{label}</span>
      <span className="text-xs font-normal text-muted-foreground">{count} opciones</span>
    </Button>
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
        <p className="font-bold text-base mt-1">₡{Number(product.price).toLocaleString()}</p>
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
  const [mode, setMode] = useState<"easy" | "standard" | null>(null);
  const [selectedSubaccount, setSelectedSubaccount] = useState<{ id: number; code: string; slotNumber: number } | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [nameError, setNameError] = useState("");

  const [easyItems, setEasyItems] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [categoryPage, setCategoryPage] = useState(0);
  const [pendingProduct, setPendingProduct] = useState<QRProduct | null>(null);
  const [modGroups, setModGroups] = useState<QRModifierGroup[]>([]);
  const [selectedMods, setSelectedMods] = useState<Record<number, number[]>>({});
  const [loadingMods, setLoadingMods] = useState(false);
  const [modReturnStep, setModReturnStep] = useState<Step>("easy_food_cats");
  const [stdModReturnStep, setStdModReturnStep] = useState<Step>("std_menu");

  const [diners, setDiners] = useState<DinerData[]>([]);
  const [currentDinerIndex, setCurrentDinerIndex] = useState(0);
  const [stdSelectedItems, setStdSelectedItems] = useState<CartItem[]>([]);
  const [expandedStdCategory, setExpandedStdCategory] = useState<string | null>(null);

  const { data: tableInfo, isLoading: tableLoading, error: tableError } = useQuery<{
    tableId: number;
    tableName: string;
    tableCode: string;
    maxSubaccounts: number;
  }>({
    queryKey: ["/api/qr", tableCode, "info"],
    enabled: !!tableCode,
  });

  const menuUrl = mode === "easy"
    ? `/api/qr/${tableCode}/menu?mode=easy`
    : `/api/qr/${tableCode}/menu`;
  const { data: menu = [] } = useQuery<QRProduct[]>({
    queryKey: ["/api/qr", tableCode, "menu", mode],
    queryFn: async () => {
      const res = await fetch(menuUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load menu");
      return res.json();
    },
    enabled: !!tableCode && mode !== null,
  });

  const { data: subaccounts = [], refetch: refetchSubaccounts } = useQuery<Subaccount[]>({
    queryKey: ["/api/qr", tableCode, "subaccounts"],
    enabled: !!tableCode,
  });

  const activeSubaccounts = subaccounts.filter(s => s.isActive);

  const foodProducts = useMemo(() => menu.filter(p => !isBeverage(p.categoryName)), [menu]);
  const drinkProducts = useMemo(() => menu.filter(p => isBeverage(p.categoryName)), [menu]);

  const foodCategories = useMemo(() => {
    const cats = new Map<string, number>();
    foodProducts.forEach(p => {
      const c = p.categoryName || "Otros";
      cats.set(c, (cats.get(c) || 0) + 1);
    });
    return Array.from(cats.entries()).map(([name, count]) => ({ name, count }));
  }, [foodProducts]);

  const drinkCategories = useMemo(() => {
    const cats = new Map<string, number>();
    drinkProducts.forEach(p => {
      const c = p.categoryName || "Otros";
      cats.set(c, (cats.get(c) || 0) + 1);
    });
    return Array.from(cats.entries()).map(([name, count]) => ({ name, count }));
  }, [drinkProducts]);

  const selectedCategoryProducts = useMemo(() => {
    const isDrinkStep = step === "easy_drink_products" || step === "easy_drink_cats";
    const pool = isDrinkStep ? drinkProducts : foodProducts;
    return pool.filter(p => (p.categoryName || "Otros") === selectedCategory);
  }, [step, foodProducts, drinkProducts, selectedCategory]);

  const menuByCategory = useMemo(() => {
    const cats = new Map<string, QRProduct[]>();
    menu.forEach(p => {
      const c = p.categoryName || "Otros";
      if (!cats.has(c)) cats.set(c, []);
      cats.get(c)!.push(p);
    });
    return Array.from(cats.entries()).map(([name, products]) => ({ name, products }));
  }, [menu]);

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

  const handleModeSelect = (m: "easy" | "standard") => {
    setMode(m);
    setStep("subaccount");
    refetchSubaccounts();
  };

  const handleSubaccountSelect = (sub: Subaccount) => {
    setSelectedSubaccount({ id: sub.id, code: sub.code, slotNumber: sub.slotNumber });
    if (sub.label) {
      setCustomerName(sub.label);
      if (mode === "easy") {
        setStep("easy_food_cats");
      } else {
        setStep("std_menu");
      }
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
    if (mode === "easy") {
      setStep("easy_food_cats");
    } else {
      setDiners([{ name: trimmed, items: [] }]);
      setCurrentDinerIndex(0);
      setStdSelectedItems([]);
      setStep("std_menu");
    }
  };

  const handleProductClick = useCallback(async (product: QRProduct, returnStep: Step) => {
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
        if (returnStep === "std_menu") {
          setStdModReturnStep(returnStep);
          setStep("std_modifiers");
        } else {
          setModReturnStep(returnStep);
          setStep("easy_modifiers");
        }
      } else {
        addItemToCart(product, [], returnStep);
      }
    } catch {
      addItemToCart(product, [], returnStep);
    } finally {
      setLoadingMods(false);
    }
  }, [customerName, toast]);

  const addItemToCart = (product: QRProduct, mods: { modGroupId: number; optionId: number }[], context: Step) => {
    const name = customerName.trim();
    const item: CartItem = {
      productId: product.id,
      productName: product.name,
      qty: 1,
      customerName: name,
      modifiers: mods.length > 0 ? mods : undefined,
      categoryName: product.categoryName || "Otros",
    };

    if (context === "std_menu") {
      setStdSelectedItems(prev => {
        const existing = prev.find(it => it.productId === product.id && JSON.stringify(it.modifiers) === JSON.stringify(item.modifiers));
        if (existing) return prev.map(it => it === existing ? { ...it, qty: it.qty + 1 } : it);
        return [...prev, item];
      });
    } else {
      setEasyItems(prev => {
        const existing = prev.find(it => it.productId === product.id && JSON.stringify(it.modifiers) === JSON.stringify(item.modifiers));
        if (existing) return prev.map(it => it === existing ? { ...it, qty: it.qty + 1 } : it);
        return [...prev, item];
      });
      toast({ title: "Apuntado", description: product.name });
    }
  };

  const confirmModifiers = (returnStep: Step) => {
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

    addItemToCart(pendingProduct, mods, returnStep);

    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    setStep(returnStep);
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

  const removeEasyItem = (idx: number) => {
    setEasyItems(prev => prev.filter((_, i) => i !== idx));
  };

  const removeStdItem = (productId: number) => {
    setStdSelectedItems(prev => prev.filter(it => it.productId !== productId));
  };

  const handleSubmitEasy = () => {
    if (!selectedSubaccount) return;
    submitMutation.mutate({ subaccountId: selectedSubaccount.id, items: easyItems });
  };

  const handleSubmitStandard = () => {
    if (!selectedSubaccount) return;
    const allItems = diners.flatMap(d => d.items);
    submitMutation.mutate({ subaccountId: selectedSubaccount.id, items: allItems });
  };

  const handleStdNextFromMenu = () => {
    const dinerName = diners[currentDinerIndex]?.name || customerName.trim();
    const updatedDiners = [...diners];
    updatedDiners[currentDinerIndex] = { name: dinerName, items: [...stdSelectedItems] };
    setDiners(updatedDiners);
    setStep("std_review");
  };

  const handleAddAnotherDiner = () => {
    const dinerName = diners[currentDinerIndex]?.name || customerName.trim();
    const updatedDiners = [...diners];
    updatedDiners[currentDinerIndex] = { name: dinerName, items: [...stdSelectedItems] };
    setDiners(updatedDiners);
    setCurrentDinerIndex(updatedDiners.length);
    setDiners([...updatedDiners, { name: "", items: [] }]);
    setStdSelectedItems([]);
    setCustomerName("");
    setStep("name");
  };

  const resetAll = () => {
    setStep("welcome");
    setMode(null);
    setSelectedSubaccount(null);
    setCustomerName("");
    setNameError("");
    setEasyItems([]);
    setSelectedCategory("");
    setCategoryPage(0);
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    setDiners([]);
    setCurrentDinerIndex(0);
    setExpandedStdCategory(null);
    setStdSelectedItems([]);
  };

  const easyItemCount = easyItems.reduce((s, it) => s + it.qty, 0);
  const EASY_TOTAL_STEPS = 5;

  // Pagination for products within a category
  const totalProductPages = Math.max(1, Math.ceil(selectedCategoryProducts.length / ITEMS_PER_PAGE));
  const safeProductPage = Math.min(categoryPage, totalProductPages - 1);
  const pageProducts = selectedCategoryProducts.slice(safeProductPage * ITEMS_PER_PAGE, (safeProductPage + 1) * ITEMS_PER_PAGE);

  // ─── Loading ────────────────────────────────────────────────
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

  // ═══════════════════════════════════════════════════════════════
  //  PANTALLA 1: BIENVENIDA
  // ═══════════════════════════════════════════════════════════════
  if (step === "welcome") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <UtensilsCrossed className="w-12 h-12 mx-auto text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-table-name">{tableInfo.tableName}</h1>
            <p className="text-muted-foreground text-base" data-testid="text-welcome-message">Bienvenido! Pedí fácil y sin carrera.</p>
          </div>
          <div className="space-y-4">
            <Button
              className="w-full min-h-[64px] text-lg"
              onClick={() => handleModeSelect("easy")}
              data-testid="button-mode-easy"
            >
              <ChefHat className="w-6 h-6 mr-3" />
              Modo fácil
            </Button>
            <Button
              variant="outline"
              className="w-full min-h-[64px] text-lg"
              onClick={() => handleModeSelect("standard")}
              data-testid="button-mode-standard"
            >
              <Utensils className="w-6 h-6 mr-3" />
              Modo estándar
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground" data-testid="text-welcome-note">
            Tranqui: un salonero confirma tu pedido antes de mandarlo a cocina.
          </p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  PANTALLA 2: SUBCUENTA / GRUPO
  // ═══════════════════════════════════════════════════════════════
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
          totalSteps={mode === "easy" ? EASY_TOTAL_STEPS : 5}
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
        totalSteps={mode === "easy" ? EASY_TOTAL_STEPS : 5}
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

  // ═══════════════════════════════════════════════════════════════
  //  PANTALLA 3: NOMBRE
  // ═══════════════════════════════════════════════════════════════
  if (step === "name") {
    return (
      <EasyStepLayout
        step={2}
        totalSteps={mode === "easy" ? EASY_TOTAL_STEPS : 5}
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

  // ═══════════════════════════════════════════════════════════════
  //  EASY — PASO 3A: CATEGORÍAS DE COMIDA (drill-down)
  // ═══════════════════════════════════════════════════════════════
  if (step === "easy_food_cats") {
    return (
      <EasyStepLayout
        step={3}
        totalSteps={EASY_TOTAL_STEPS}
        title="¿Qué se te antoja?"
        subtitle="Elegí una categoría para ver las opciones."
        onBack={() => setStep("name")}
        stickyButton={
          <div className="space-y-2">
            {easyItemCount > 0 && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="text-easy-cart-count">
                <ShoppingBag className="w-4 h-4" />
                <span>{easyItemCount} item{easyItemCount !== 1 ? "s" : ""} en tu pedido</span>
              </div>
            )}
            <Button
              className="w-full min-h-[64px] text-lg"
              onClick={() => setStep("easy_drink_cats")}
              data-testid="button-easy-next-to-drinks"
            >
              Siguiente: Bebidas
              <ArrowRight className="w-6 h-6 ml-2" />
            </Button>
          </div>
        }
      >
        {foodCategories.length === 0 ? (
          <div className="text-center py-8">
            <ChefHat className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-lg text-muted-foreground">No hay comida disponible.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {foodCategories.map(cat => (
              <BigCategoryButton
                key={cat.name}
                label={cat.name}
                icon={<ChefHat className="w-6 h-6" />}
                count={cat.count}
                onClick={() => { setSelectedCategory(cat.name); setCategoryPage(0); setStep("easy_food_products"); }}
                testId={`button-food-cat-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}
              />
            ))}
          </div>
        )}
      </EasyStepLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  EASY — PASO 3B: PRODUCTOS DE COMIDA (dentro de categoría)
  // ═══════════════════════════════════════════════════════════════
  if (step === "easy_food_products") {
    return (
      <EasyStepLayout
        step={3}
        totalSteps={EASY_TOTAL_STEPS}
        title={selectedCategory}
        subtitle="Agregá lo que te guste."
        onBack={() => setStep("easy_food_cats")}
        stickyButton={
          <div className="space-y-2">
            {easyItemCount > 0 && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="text-easy-cart-count-products">
                <ShoppingBag className="w-4 h-4" />
                <span>{easyItemCount} item{easyItemCount !== 1 ? "s" : ""} en tu pedido</span>
              </div>
            )}
            <Button
              variant="outline"
              className="w-full min-h-[64px] text-lg"
              onClick={() => setStep("easy_food_cats")}
              data-testid="button-back-to-food-cats"
            >
              <ChevronLeft className="w-5 h-5 mr-2" />
              Volver a categorías
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {pageProducts.map(product => {
            const inCart = easyItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
            const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
            return (
              <ProductCard
                key={product.id}
                product={product}
                inCart={inCart}
                outOfStock={outOfStock}
                loading={loadingMods}
                onSelect={() => handleProductClick(product, "easy_food_products")}
              />
            );
          })}
        </div>

        {totalProductPages > 1 && (
          <div className="flex items-center justify-between pt-4 gap-3">
            <Button
              variant="outline"
              className="flex-1 min-h-[52px] text-base"
              onClick={() => setCategoryPage(p => Math.max(0, p - 1))}
              disabled={safeProductPage === 0}
              data-testid="button-page-prev"
            >
              <ChevronLeft className="w-5 h-5 mr-1" /> Atrás
            </Button>
            <span className="text-base text-muted-foreground whitespace-nowrap font-medium" data-testid="text-page-indicator">
              {safeProductPage + 1} / {totalProductPages}
            </span>
            <Button
              variant="outline"
              className="flex-1 min-h-[52px] text-base"
              onClick={() => setCategoryPage(p => Math.min(totalProductPages - 1, p + 1))}
              disabled={safeProductPage >= totalProductPages - 1}
              data-testid="button-page-next"
            >
              Siguiente <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
          </div>
        )}
      </EasyStepLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  EASY — PASO 4A: CATEGORÍAS DE BEBIDAS (drill-down)
  // ═══════════════════════════════════════════════════════════════
  if (step === "easy_drink_cats") {
    return (
      <EasyStepLayout
        step={4}
        totalSteps={EASY_TOTAL_STEPS}
        title="¿Algo para beber?"
        subtitle="Elegí una categoría o pasá directo a revisar."
        onBack={() => setStep("easy_food_cats")}
        stickyButton={
          <div className="space-y-2">
            <Button
              className="w-full min-h-[64px] text-lg"
              onClick={() => setStep("easy_review")}
              data-testid="button-easy-next-to-review"
            >
              Siguiente: Revisar pedido
              <ArrowRight className="w-6 h-6 ml-2" />
            </Button>
            <Button
              variant="ghost"
              className="w-full min-h-[56px] text-base text-muted-foreground"
              onClick={() => setStep("easy_review")}
              data-testid="button-easy-skip-drinks"
            >
              No quiero bebida
            </Button>
          </div>
        }
      >
        {drinkCategories.length === 0 ? (
          <div className="text-center py-8">
            <Coffee className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-lg text-muted-foreground">No hay bebidas disponibles.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {drinkCategories.map(cat => (
              <BigCategoryButton
                key={cat.name}
                label={cat.name}
                icon={<Coffee className="w-6 h-6" />}
                count={cat.count}
                onClick={() => { setSelectedCategory(cat.name); setCategoryPage(0); setStep("easy_drink_products"); }}
                testId={`button-drink-cat-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}
              />
            ))}
          </div>
        )}
      </EasyStepLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  EASY — PASO 4B: PRODUCTOS DE BEBIDA (dentro de categoría)
  // ═══════════════════════════════════════════════════════════════
  if (step === "easy_drink_products") {
    return (
      <EasyStepLayout
        step={4}
        totalSteps={EASY_TOTAL_STEPS}
        title={selectedCategory}
        subtitle="Agregá lo que te guste."
        onBack={() => setStep("easy_drink_cats")}
        stickyButton={
          <div className="space-y-2">
            {easyItemCount > 0 && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="text-easy-cart-count-drinks">
                <ShoppingBag className="w-4 h-4" />
                <span>{easyItemCount} item{easyItemCount !== 1 ? "s" : ""} en tu pedido</span>
              </div>
            )}
            <Button
              variant="outline"
              className="w-full min-h-[64px] text-lg"
              onClick={() => setStep("easy_drink_cats")}
              data-testid="button-back-to-drink-cats"
            >
              <ChevronLeft className="w-5 h-5 mr-2" />
              Volver a categorías
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {pageProducts.map(product => {
            const inCart = easyItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
            const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
            return (
              <ProductCard
                key={product.id}
                product={product}
                inCart={inCart}
                outOfStock={outOfStock}
                loading={loadingMods}
                onSelect={() => handleProductClick(product, "easy_drink_products")}
              />
            );
          })}
        </div>

        {totalProductPages > 1 && (
          <div className="flex items-center justify-between pt-4 gap-3">
            <Button
              variant="outline"
              className="flex-1 min-h-[52px] text-base"
              onClick={() => setCategoryPage(p => Math.max(0, p - 1))}
              disabled={safeProductPage === 0}
              data-testid="button-page-prev"
            >
              <ChevronLeft className="w-5 h-5 mr-1" /> Atrás
            </Button>
            <span className="text-base text-muted-foreground whitespace-nowrap font-medium" data-testid="text-page-indicator">
              {safeProductPage + 1} / {totalProductPages}
            </span>
            <Button
              variant="outline"
              className="flex-1 min-h-[52px] text-base"
              onClick={() => setCategoryPage(p => Math.min(totalProductPages - 1, p + 1))}
              disabled={safeProductPage >= totalProductPages - 1}
              data-testid="button-page-next"
            >
              Siguiente <ChevronRight className="w-5 h-5 ml-1" />
            </Button>
          </div>
        )}
      </EasyStepLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  EASY/STD: MODIFICADORES
  // ═══════════════════════════════════════════════════════════════
  if (step === "easy_modifiers" || step === "std_modifiers") {
    const returnStep = step === "easy_modifiers" ? modReturnStep : stdModReturnStep;
    return (
      <EasyStepLayout
        step={mode === "easy" ? 3 : 3}
        totalSteps={mode === "easy" ? EASY_TOTAL_STEPS : 5}
        title={`¿Cómo preferís tu ${pendingProduct?.name}?`}
        onBack={() => { setPendingProduct(null); setModGroups([]); setSelectedMods({}); setStep(returnStep); }}
        stickyButton={
          <Button
            className="w-full min-h-[64px] text-lg"
            onClick={() => confirmModifiers(returnStep)}
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
                        <span className="text-base ml-2">+₡{Number(opt.priceDelta).toLocaleString()}</span>
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

  // ═══════════════════════════════════════════════════════════════
  //  EASY — PASO 5: RESUMEN
  // ═══════════════════════════════════════════════════════════════
  if (step === "easy_review") {
    const foodItems = easyItems.filter(it => !isBeverage(it.categoryName));
    const drinkItems = easyItems.filter(it => isBeverage(it.categoryName));

    return (
      <EasyStepLayout
        step={5}
        totalSteps={EASY_TOTAL_STEPS}
        title="Revisá tu pedido"
        onBack={() => setStep("easy_drink_cats")}
        stickyButton={
          <Button
            className="w-full min-h-[64px] text-lg"
            onClick={handleSubmitEasy}
            disabled={submitMutation.isPending || easyItems.length === 0}
            data-testid="button-easy-confirm"
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
            ) : (
              <Send className="w-6 h-6 mr-2" />
            )}
            Confirmar y enviar pedido
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

          {foodItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-base font-medium text-muted-foreground flex items-center gap-2" data-testid="text-review-food-header">
                <ChefHat className="w-5 h-5" /> Comida
              </p>
              {foodItems.map((item) => {
                const globalIdx = easyItems.indexOf(item);
                return (
                  <Card key={globalIdx} data-testid={`review-food-item-${globalIdx}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <p className="font-medium text-lg">{item.qty}x {item.productName}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEasyItem(globalIdx)}
                        data-testid={`button-remove-item-${globalIdx}`}
                      >
                        <X className="w-5 h-5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {drinkItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-base font-medium text-muted-foreground flex items-center gap-2" data-testid="text-review-drink-header">
                <Coffee className="w-5 h-5" /> Bebidas
              </p>
              {drinkItems.map((item) => {
                const globalIdx = easyItems.indexOf(item);
                return (
                  <Card key={globalIdx} data-testid={`review-drink-item-${globalIdx}`}>
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <p className="font-medium text-lg">{item.qty}x {item.productName}</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEasyItem(globalIdx)}
                        data-testid={`button-remove-drink-${globalIdx}`}
                      >
                        <X className="w-5 h-5" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {easyItems.length === 0 && (
            <p className="text-center text-muted-foreground text-base py-6" data-testid="text-empty-order">No hay items en tu pedido.</p>
          )}

          <Button
            variant="outline"
            className="w-full min-h-[64px] text-lg"
            onClick={() => setStep("easy_food_cats")}
            data-testid="button-easy-add-more"
          >
            <Plus className="w-6 h-6 mr-2" />
            Agregar algo más
          </Button>
        </div>
      </EasyStepLayout>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  STANDARD: MENÚ (acordeón de categorías)
  // ═══════════════════════════════════════════════════════════════
  if (step === "std_menu") {
    const dinerNum = currentDinerIndex + 1;
    const totalDiners = diners.length;
    const stdItemCount = stdSelectedItems.reduce((s, it) => s + it.qty, 0);
    return (
      <div className="min-h-screen bg-background pb-28">
        <div className="sticky top-0 z-[9] bg-background border-b p-4">
          <div className="max-w-md mx-auto space-y-1">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setStep("name")} data-testid="button-back-from-menu">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="secondary" data-testid="text-diner-counter">Comensal {dinerNum} de {totalDiners}</Badge>
            </div>
            <h1 className="text-xl font-bold" data-testid="text-std-menu-title">¿Qué deseás ordenar?</h1>
          </div>
        </div>
        <div className="max-w-md mx-auto px-3 pt-2">
          <div className="space-y-1">
            {menuByCategory.map(({ name: catName, products: catProducts }) => {
              const isExpanded = expandedStdCategory === catName;
              return (
                <div key={catName} data-testid={`category-group-${catName}`}>
                  <button
                    className="w-full flex items-center justify-between gap-2 px-3 py-3 rounded-md hover-elevate min-h-[48px] text-left"
                    onClick={() => setExpandedStdCategory(isExpanded ? null : catName)}
                    aria-expanded={isExpanded}
                    data-testid={`button-toggle-category-${catName}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                        : <ChevronRight className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                      <span className="font-semibold text-sm truncate">{catName}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">{catProducts.length}</Badge>
                  </button>
                  {isExpanded && (
                    <div className="pl-4 pr-1 pb-2 space-y-1">
                      {catProducts.map(product => {
                        const qty = stdSelectedItems.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
                        const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
                        return (
                          <div
                            key={product.id}
                            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md ${outOfStock ? "opacity-50" : "hover-elevate cursor-pointer"}`}
                            onClick={() => {
                              if (!outOfStock && !loadingMods) {
                                setStdModReturnStep("std_menu");
                                handleProductClick(product, "std_menu");
                              }
                            }}
                            data-testid={`product-row-${product.id}`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm truncate">{product.name}</p>
                              <p className="text-xs text-muted-foreground">₡{Number(product.price).toLocaleString()}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {qty > 0 && (
                                <Badge variant="default" className="text-xs" data-testid={`badge-qty-${product.id}`}>{qty}</Badge>
                              )}
                              {outOfStock ? (
                                <span className="text-xs text-muted-foreground">Agotado</span>
                              ) : (
                                <Plus className="w-4 h-4 text-muted-foreground" />
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
            {menuByCategory.length === 0 && (
              <div className="text-center py-8">
                <Utensils className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-lg text-muted-foreground">No hay productos disponibles.</p>
              </div>
            )}
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t z-[9]">
          <div className="max-w-md mx-auto space-y-2">
            {stdItemCount > 0 && (
              <p className="text-sm text-muted-foreground truncate" data-testid="text-menu-selection-summary">
                {stdItemCount} item{stdItemCount !== 1 ? "s" : ""}: {stdSelectedItems.map(it => it.productName).join(", ")}
              </p>
            )}
            <Button className="w-full" onClick={handleStdNextFromMenu} disabled={stdItemCount === 0} data-testid="button-std-next-menu">
              Revisar pedido <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  STANDARD: REVIEW
  // ═══════════════════════════════════════════════════════════════
  if (step === "std_review") {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-6 pt-4">
          <h1 className="text-xl font-bold text-center" data-testid="text-std-review-title">Revisar y Enviar</h1>
          <div className="space-y-4">
            {diners.map((diner, dIdx) => (
              <Card key={dIdx} data-testid={`card-diner-${dIdx}`}>
                <CardContent className="p-4 space-y-2">
                  <p className="font-bold">{diner.name}</p>
                  {diner.items.map((item, iIdx) => (
                    <div key={iIdx} className="flex items-center gap-2 text-sm" data-testid={`review-std-item-${dIdx}-${iIdx}`}>
                      <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
                      <span>{item.qty}x {item.productName}</span>
                    </div>
                  ))}
                  {diner.items.length === 0 && (
                    <p className="text-sm text-muted-foreground">Sin items seleccionados</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full min-h-[56px] text-base"
              onClick={handleAddAnotherDiner}
              data-testid="button-add-diner"
            >
              <Plus className="w-5 h-5 mr-2" />
              Agregar otro comensal
            </Button>
            <Button
              className="w-full min-h-[56px] text-base"
              onClick={handleSubmitStandard}
              disabled={submitMutation.isPending || diners.every(d => d.items.length === 0)}
              data-testid="button-std-confirm"
            >
              {submitMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
              ) : (
                <Send className="w-5 h-5 mr-2" />
              )}
              Confirmar y enviar pedido
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline py-2"
              onClick={() => setStep("std_menu")}
              data-testid="button-std-back"
            >
              Volver atrás
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  //  ÉXITO
  // ═══════════════════════════════════════════════════════════════
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
