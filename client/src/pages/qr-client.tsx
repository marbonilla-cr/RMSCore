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
  Search, X, Users, User, ArrowRight, Coffee, ChefHat,
  Utensils, Send, CheckCircle2, Minus,
} from "lucide-react";

type Step =
  | "welcome"
  | "subaccount"
  | "name"
  | "easy_food"
  | "easy_drink"
  | "easy_modifiers"
  | "easy_review"
  | "std_food"
  | "std_drink"
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
const ITEMS_PER_PAGE = 4;

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
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
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

function PagedMenuGrid({
  products, onSelect, cart, loading, searchTerm, onSearchChange, categoryLabel,
}: {
  products: QRProduct[];
  onSelect: (p: QRProduct) => void;
  cart: CartItem[];
  loading: boolean;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  categoryLabel?: string;
}) {
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return products;
    const lower = searchTerm.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(lower) || (p.description || "").toLowerCase().includes(lower));
  }, [products, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar..."
          value={searchTerm}
          onChange={(e) => { onSearchChange(e.target.value); setPage(0); }}
          className="pl-9 pr-9 min-h-[48px] text-base"
          data-testid="input-menu-search"
        />
        {searchTerm && (
          <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => { onSearchChange(""); setPage(0); }} data-testid="button-clear-search">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>
      {categoryLabel && <Badge variant="secondary" className="text-xs">{categoryLabel}</Badge>}

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-8" data-testid="text-no-results">Sin resultados</p>
      ) : (
        <div className="space-y-3">
          {pageItems.map((product) => {
            const inCart = cart.filter(it => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
            const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
            return (
              <Card key={product.id} className={outOfStock ? "opacity-50" : ""} data-testid={`card-product-${product.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-base">{product.name}</p>
                      {product.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{product.description}</p>
                      )}
                      <p className="font-bold text-base mt-1">₡{Number(product.price).toLocaleString()}</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {inCart > 0 && <Badge variant="secondary">{inCart}</Badge>}
                      <Button
                        className="min-h-[44px] min-w-[80px]"
                        variant={outOfStock ? "secondary" : "default"}
                        onClick={() => onSelect(product)}
                        disabled={loading || outOfStock}
                        data-testid={`button-add-${product.id}`}
                      >
                        {outOfStock ? "Agotado" : "Elegir"}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 gap-3">
          <Button
            variant="outline"
            className="flex-1 min-h-[48px]"
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={safePage === 0}
            data-testid="button-page-prev"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Atrás
          </Button>
          <span className="text-sm text-muted-foreground whitespace-nowrap" data-testid="text-page-indicator">
            {safePage + 1} / {totalPages}
          </span>
          <Button
            variant="outline"
            className="flex-1 min-h-[48px]"
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            data-testid="button-page-next"
          >
            Siguiente <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
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
  const [easyFoodSearch, setEasyFoodSearch] = useState("");
  const [easyDrinkSearch, setEasyDrinkSearch] = useState("");
  const [pendingProduct, setPendingProduct] = useState<QRProduct | null>(null);
  const [modGroups, setModGroups] = useState<QRModifierGroup[]>([]);
  const [selectedMods, setSelectedMods] = useState<Record<number, number[]>>({});
  const [loadingMods, setLoadingMods] = useState(false);

  const [diners, setDiners] = useState<DinerData[]>([]);
  const [currentDinerIndex, setCurrentDinerIndex] = useState(0);
  const [stdSelectedItems, setStdSelectedItems] = useState<CartItem[]>([]);

  const { data: tableInfo, isLoading: tableLoading, error: tableError } = useQuery<{
    tableId: number;
    tableName: string;
    tableCode: string;
  }>({
    queryKey: ["/api/qr", tableCode, "info"],
    enabled: !!tableCode,
  });

  const { data: menu = [] } = useQuery<QRProduct[]>({
    queryKey: ["/api/qr", tableCode, "menu"],
    enabled: !!tableCode,
  });

  const { data: subaccounts = [], refetch: refetchSubaccounts } = useQuery<Subaccount[]>({
    queryKey: ["/api/qr", tableCode, "subaccounts"],
    enabled: !!tableCode && step === "subaccount",
  });

  const activeSubaccounts = subaccounts.filter(s => s.isActive);

  const createSubaccountMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/qr/${tableCode}/subaccounts`, {});
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

  const batchSubaccountMutation = useMutation({
    mutationFn: async (count: number) => {
      const res = await apiRequest("POST", `/api/qr/${tableCode}/subaccounts-batch`, { count });
      return res.json() as Promise<Subaccount[]>;
    },
    onSuccess: (data: Subaccount[]) => {
      queryClient.invalidateQueries({ queryKey: ["/api/qr", tableCode, "subaccounts"] });
      if (data.length === 1) {
        setSelectedSubaccount({ id: data[0].id, code: data[0].code, slotNumber: data[0].slotNumber });
        setStep("name");
      } else {
        refetchSubaccounts();
      }
    },
    onError: () => {
      toast({ title: "Error", description: "No se pudieron crear las cuentas. Probá de nuevo.", variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: { subaccountId: number; items: CartItem[] }) => {
      const items = payload.items.map(it => ({
        productId: it.productId,
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

  const foodProducts = useMemo(() => menu.filter(p => !isBeverage(p.categoryName)), [menu]);
  const drinkProducts = useMemo(() => menu.filter(p => isBeverage(p.categoryName)), [menu]);

  const handleModeSelect = (m: "easy" | "standard") => {
    setMode(m);
    setStep("subaccount");
    refetchSubaccounts();
  };

  const handleSubaccountSelect = (sub: Subaccount) => {
    setSelectedSubaccount({ id: sub.id, code: sub.code, slotNumber: sub.slotNumber });
    setStep("name");
  };

  const handleGroupSelect = async (count: number) => {
    batchSubaccountMutation.mutate(count);
  };

  const handleNameContinue = () => {
    const trimmed = customerName.trim();
    if (!trimmed) {
      setNameError("Poné tu nombre para que no se nos enrede la cuenta");
      return;
    }
    setNameError("");
    if (mode === "easy") {
      setStep("easy_food");
    } else {
      setDiners([{ name: trimmed, items: [] }]);
      setCurrentDinerIndex(0);
      setStdSelectedItems([]);
      setStep("std_food");
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
        setStep(returnStep === "std_food" || returnStep === "std_drink" ? "std_modifiers" : "easy_modifiers");
      } else {
        addItemToCart(product, [], returnStep);
      }
    } catch {
      addItemToCart(product, [], returnStep);
    } finally {
      setLoadingMods(false);
    }
  }, [customerName, toast, mode, currentDinerIndex, diners]);

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

    if (context === "std_food" || context === "std_drink" || context === "std_modifiers") {
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

    const isStd = returnStep === "std_food" || returnStep === "std_drink" || returnStep === "std_modifiers";
    addItemToCart(pendingProduct, mods, isStd ? stdModReturnStep : modReturnStep);

    const goBack = isStd ? stdModReturnStep : modReturnStep;
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    setStep(goBack as Step);
  };

  const [modReturnStep, setModReturnStep] = useState<Step>("easy_food");
  const [stdModReturnStep, setStdModReturnStep] = useState<Step>("std_food");

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

  const handleStdNextFromFood = () => setStep("std_drink");

  const handleStdNextFromDrink = () => {
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
    setEasyFoodSearch("");
    setEasyDrinkSearch("");
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    setDiners([]);
    setCurrentDinerIndex(0);
    setStdSelectedItems([]);
  };

  const easyItemCount = easyItems.reduce((s, it) => s + it.qty, 0);
  const EASY_TOTAL_STEPS = 5;

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

  // ─── Pantalla 1: Bienvenida ─────────────────────────────────
  if (step === "welcome") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <UtensilsCrossed className="w-12 h-12 mx-auto text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-table-name">{tableInfo.tableName}</h1>
            <p className="text-muted-foreground text-base">Bienvenido! Pedimos fácil y sin carrera.</p>
          </div>
          <div className="space-y-4">
            <Button
              className="w-full min-h-[56px] text-base"
              onClick={() => handleModeSelect("easy")}
              data-testid="button-mode-easy"
            >
              <ChefHat className="w-5 h-5 mr-2" />
              Modo fácil (entrevista)
            </Button>
            <Button
              variant="outline"
              className="w-full min-h-[56px] text-base"
              onClick={() => handleModeSelect("standard")}
              data-testid="button-mode-standard"
            >
              <Utensils className="w-5 h-5 mr-2" />
              Modo estándar (yo me la juego)
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground" data-testid="text-welcome-note">
            Tranqui: un salonero confirma tu pedido antes de mandarlo a cocina.
          </p>
        </div>
      </div>
    );
  }

  // ─── Pantalla 2: Subcuenta / Grupo ──────────────────────────
  if (step === "subaccount") {
    const hasExisting = activeSubaccounts.length > 0;
    const canCreateMore = activeSubaccounts.length < MAX_SUBACCOUNTS;

    return (
      <EasyStepLayout
        step={1}
        totalSteps={mode === "easy" ? EASY_TOTAL_STEPS : 5}
        title="¿A cuál cuenta lo cargamos?"
        subtitle="Si vienen en grupos, así en caja sale ordenadito."
        onBack={() => setStep("welcome")}
      >
        <div className="space-y-6">
          {/* Quick-select: Somos N */}
          {!hasExisting && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground text-center">¿Cuántos son?</p>
              <div className="grid grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6].filter(n => n <= MAX_SUBACCOUNTS).map(n => (
                  <Button
                    key={n}
                    variant="outline"
                    className="min-h-[64px] text-lg font-bold flex flex-col gap-1"
                    onClick={() => handleGroupSelect(n)}
                    disabled={batchSubaccountMutation.isPending}
                    data-testid={`button-group-${n}`}
                  >
                    <Users className="w-5 h-5" />
                    {n === 1 ? "Solo yo" : `Somos ${n}`}
                  </Button>
                ))}
              </div>
              {batchSubaccountMutation.isPending && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm text-muted-foreground">Creando cuentas...</span>
                </div>
              )}
            </div>
          )}

          {/* Existing subaccounts - pick one */}
          {hasExisting && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground text-center">Elegí tu cuenta:</p>
              {activeSubaccounts.map(sub => (
                <Button
                  key={sub.id}
                  variant="outline"
                  className="w-full min-h-[56px] text-base justify-start gap-3"
                  onClick={() => handleSubaccountSelect(sub)}
                  data-testid={`button-subaccount-${sub.id}`}
                >
                  <User className="w-5 h-5 flex-shrink-0" />
                  <span>{sub.label || `Cuenta ${sub.slotNumber}`}</span>
                  <Badge variant="secondary" className="ml-auto">{sub.code}</Badge>
                </Button>
              ))}

              {canCreateMore && (
                <Button
                  variant="default"
                  className="w-full min-h-[56px] text-base"
                  onClick={() => createSubaccountMutation.mutate()}
                  disabled={createSubaccountMutation.isPending}
                  data-testid="button-create-subaccount"
                >
                  {createSubaccountMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="w-5 h-5 mr-2" />
                  )}
                  Crear cuenta nueva
                </Button>
              )}

              {!canCreateMore && (
                <p className="text-sm text-center text-muted-foreground p-3" data-testid="text-max-subaccounts">
                  Ya hay {MAX_SUBACCOUNTS} cuentas en esta mesa. Usá una existente o pedile al salonero.
                </p>
              )}
            </div>
          )}
        </div>
      </EasyStepLayout>
    );
  }

  // ─── Pantalla 3: Nombre ─────────────────────────────────────
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
            className="w-full min-h-[56px] text-base"
            onClick={handleNameContinue}
            data-testid="button-name-continue"
          >
            Continuar
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        }
      >
        <div className="space-y-4 pt-4">
          <User className="w-12 h-12 mx-auto text-primary" />
          <Input
            value={customerName}
            onChange={(e) => { setCustomerName(e.target.value); setNameError(""); }}
            placeholder="Tu nombre"
            className="text-lg min-h-[56px] text-center"
            autoFocus
            data-testid="input-customer-name"
          />
          {nameError && (
            <p className="text-sm text-destructive text-center" data-testid="text-name-error">{nameError}</p>
          )}
        </div>
      </EasyStepLayout>
    );
  }

  // ─── Easy: Pantalla 4 — Platos (paginado) ───────────────────
  if (step === "easy_food") {
    return (
      <EasyStepLayout
        step={3}
        totalSteps={EASY_TOTAL_STEPS}
        title="¿Qué se te antoja para comer?"
        onBack={() => setStep("name")}
        stickyButton={
          <div className="space-y-2">
            {easyItemCount > 0 && (
              <p className="text-sm text-muted-foreground text-center">
                {easyItemCount} item{easyItemCount !== 1 ? "s" : ""} en tu pedido
              </p>
            )}
            <Button
              className="w-full min-h-[56px] text-base"
              onClick={() => setStep("easy_drink")}
              data-testid="button-easy-next-to-drinks"
            >
              Siguiente: Bebidas
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </div>
        }
      >
        <PagedMenuGrid
          products={foodProducts}
          onSelect={(p) => {
            setModReturnStep("easy_food");
            handleProductClick(p, "easy_food");
          }}
          cart={easyItems}
          loading={loadingMods}
          searchTerm={easyFoodSearch}
          onSearchChange={setEasyFoodSearch}
        />
      </EasyStepLayout>
    );
  }

  // ─── Easy: Pantalla 5 — Bebidas (paginado) ──────────────────
  if (step === "easy_drink") {
    return (
      <EasyStepLayout
        step={4}
        totalSteps={EASY_TOTAL_STEPS}
        title="¿Algo para beber?"
        onBack={() => setStep("easy_food")}
        stickyButton={
          <div className="space-y-2">
            <Button
              className="w-full min-h-[56px] text-base"
              onClick={() => setStep("easy_review")}
              data-testid="button-easy-next-to-review"
            >
              Siguiente: Revisar pedido
              <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
            <Button
              variant="ghost"
              className="w-full min-h-[48px] text-base text-muted-foreground"
              onClick={() => setStep("easy_review")}
              data-testid="button-easy-skip-drinks"
            >
              No quiero bebida
            </Button>
          </div>
        }
      >
        {drinkProducts.length === 0 ? (
          <div className="text-center py-8">
            <Coffee className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No hay bebidas disponibles por ahora.</p>
          </div>
        ) : (
          <PagedMenuGrid
            products={drinkProducts}
            onSelect={(p) => {
              setModReturnStep("easy_drink");
              handleProductClick(p, "easy_drink");
            }}
            cart={easyItems}
            loading={loadingMods}
            searchTerm={easyDrinkSearch}
            onSearchChange={setEasyDrinkSearch}
          />
        )}
      </EasyStepLayout>
    );
  }

  // ─── Easy/Std: Modificadores ────────────────────────────────
  if (step === "easy_modifiers" || step === "std_modifiers") {
    const returnStep = step === "easy_modifiers" ? modReturnStep : stdModReturnStep;
    return (
      <EasyStepLayout
        step={step === "easy_modifiers" ? 3 : 3}
        totalSteps={mode === "easy" ? EASY_TOTAL_STEPS : 5}
        title={`¿Cómo preferís tu ${pendingProduct?.name}?`}
        onBack={() => { setPendingProduct(null); setModGroups([]); setSelectedMods({}); setStep(returnStep); }}
        stickyButton={
          <Button
            className="w-full min-h-[56px] text-base"
            onClick={() => confirmModifiers(returnStep)}
            data-testid="button-confirm-modifiers"
          >
            Confirmar
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        }
      >
        <div className="space-y-5">
          {modGroups.map(group => (
            <div key={group.id} className="space-y-2" data-testid={`modifier-group-${group.id}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-base">{group.name}</span>
                {group.required && <Badge variant="secondary">Requerido</Badge>}
                {group.multiSelect && <span className="text-xs text-muted-foreground">(varias opciones)</span>}
              </div>
              <div className="space-y-2">
                {group.options.map(opt => {
                  const isSelected = (selectedMods[group.id] || []).includes(opt.id);
                  return (
                    <Button
                      key={opt.id}
                      variant={isSelected ? "default" : "outline"}
                      className="w-full min-h-[56px] justify-start text-left text-base"
                      onClick={() => toggleModOption(group.id, opt.id, group.multiSelect)}
                      data-testid={`button-modifier-${opt.id}`}
                    >
                      {isSelected && <CheckCircle2 className="w-5 h-5 mr-2 flex-shrink-0" />}
                      <span className="flex-1">{opt.name}</span>
                      {Number(opt.priceDelta) !== 0 && (
                        <span className="text-sm ml-2">+₡{Number(opt.priceDelta).toLocaleString()}</span>
                      )}
                    </Button>
                  );
                })}
                {!group.required && (
                  <Button
                    variant={(selectedMods[group.id] || []).length === 0 ? "secondary" : "ghost"}
                    className="w-full min-h-[56px] text-base"
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

  // ─── Easy: Pantalla 6 — Resumen ─────────────────────────────
  if (step === "easy_review") {
    const foodItems = easyItems.filter(it => !isBeverage(it.categoryName));
    const drinkItems = easyItems.filter(it => isBeverage(it.categoryName));

    return (
      <EasyStepLayout
        step={5}
        totalSteps={EASY_TOTAL_STEPS}
        title="Revisá tu pedido"
        onBack={() => setStep("easy_drink")}
        stickyButton={
          <Button
            className="w-full min-h-[56px] text-base"
            onClick={handleSubmitEasy}
            disabled={submitMutation.isPending || easyItems.length === 0}
            data-testid="button-easy-confirm"
          >
            {submitMutation.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
            ) : (
              <Send className="w-5 h-5 mr-2" />
            )}
            Confirmar y enviar pedido
          </Button>
        }
      >
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="w-4 h-4" />
                <span>Cuenta: {tableInfo.tableName}-{selectedSubaccount?.slotNumber}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="w-4 h-4" />
                <span>Nombre: <strong className="text-foreground">{customerName.trim()}</strong></span>
              </div>
            </CardContent>
          </Card>

          {foodItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <ChefHat className="w-4 h-4" /> Comida
              </p>
              {foodItems.map((item, idx) => {
                const globalIdx = easyItems.indexOf(item);
                return (
                  <Card key={globalIdx} data-testid={`review-food-item-${globalIdx}`}>
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{item.qty}x {item.productName}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEasyItem(globalIdx)}
                        data-testid={`button-remove-item-${globalIdx}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {drinkItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Coffee className="w-4 h-4" /> Bebidas
              </p>
              {drinkItems.map((item) => {
                const globalIdx = easyItems.indexOf(item);
                return (
                  <Card key={globalIdx} data-testid={`review-drink-item-${globalIdx}`}>
                    <CardContent className="p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{item.qty}x {item.productName}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEasyItem(globalIdx)}
                        data-testid={`button-remove-drink-${globalIdx}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {easyItems.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-4">No hay items en tu pedido.</p>
          )}

          <Button
            variant="outline"
            className="w-full min-h-[56px] text-base"
            onClick={() => setStep("easy_food")}
            data-testid="button-easy-add-more"
          >
            <Plus className="w-5 h-5 mr-2" />
            Agregar algo más
          </Button>
        </div>
      </EasyStepLayout>
    );
  }

  // ─── Standard: Food ─────────────────────────────────────────
  if (step === "std_food") {
    const dinerNum = currentDinerIndex + 1;
    const totalDiners = diners.length;
    return (
      <div className="min-h-screen bg-background pb-28">
        <div className="sticky top-0 z-[9] bg-background border-b p-4">
          <div className="max-w-md mx-auto space-y-1">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setStep("name")} data-testid="button-back-from-food">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="secondary" data-testid="text-diner-counter">Comensal {dinerNum} de {totalDiners}</Badge>
            </div>
            <h1 className="text-xl font-bold" data-testid="text-std-food-title">¿Qué deseás comer?</h1>
          </div>
        </div>
        <div className="max-w-md mx-auto px-4 pt-3">
          <div className="grid grid-cols-2 gap-3">
            {foodProducts.map(product => {
              const isSelected = stdSelectedItems.some(it => it.productId === product.id);
              const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
              return (
                <Card key={product.id} className={isSelected ? "ring-2 ring-primary" : ""} data-testid={`card-food-${product.id}`}>
                  <CardContent className="p-3 space-y-2">
                    <p className="font-medium text-sm">{product.name}</p>
                    {product.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>
                    )}
                    <p className="font-bold text-sm">₡{Number(product.price).toLocaleString()}</p>
                    {isSelected ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                        <Button variant="ghost" size="sm" onClick={() => removeStdItem(product.id)} data-testid={`button-remove-food-${product.id}`}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => { setStdModReturnStep("std_food"); handleProductClick(product, "std_food"); }}
                        disabled={loadingMods || outOfStock}
                        data-testid={`button-select-food-${product.id}`}
                      >
                        {outOfStock ? "Agotado" : "Elegir"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t z-[9]">
          <div className="max-w-md mx-auto space-y-2">
            {stdSelectedItems.length > 0 && (
              <p className="text-sm text-muted-foreground truncate" data-testid="text-food-selection-summary">
                Pedido: {stdSelectedItems.map(it => it.productName).join(", ")}
              </p>
            )}
            <Button className="w-full" onClick={handleStdNextFromFood} data-testid="button-std-next-food">
              Siguiente <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Standard: Drink ────────────────────────────────────────
  if (step === "std_drink") {
    const dinerNum = currentDinerIndex + 1;
    const totalDiners = diners.length;
    return (
      <div className="min-h-screen bg-background pb-28">
        <div className="sticky top-0 z-[9] bg-background border-b p-4">
          <div className="max-w-md mx-auto space-y-1">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setStep("std_food")} data-testid="button-back-from-drink">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Badge variant="secondary" data-testid="text-diner-counter-drink">Comensal {dinerNum} de {totalDiners}</Badge>
            </div>
            <h1 className="text-xl font-bold" data-testid="text-std-drink-title">¿Algo para beber?</h1>
          </div>
        </div>
        <div className="max-w-md mx-auto px-4 pt-3">
          <div className="grid grid-cols-2 gap-3">
            {drinkProducts.map(product => {
              const isSelected = stdSelectedItems.some(it => it.productId === product.id);
              const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
              return (
                <Card key={product.id} className={isSelected ? "ring-2 ring-primary" : ""} data-testid={`card-drink-${product.id}`}>
                  <CardContent className="p-3 space-y-2">
                    <p className="font-medium text-sm">{product.name}</p>
                    {product.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>
                    )}
                    <p className="font-bold text-sm">₡{Number(product.price).toLocaleString()}</p>
                    {isSelected ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-primary" />
                        <Button variant="ghost" size="sm" onClick={() => removeStdItem(product.id)} data-testid={`button-remove-drink-${product.id}`}>
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => { setStdModReturnStep("std_drink"); handleProductClick(product, "std_drink"); }}
                        disabled={loadingMods || outOfStock}
                        data-testid={`button-select-drink-${product.id}`}
                      >
                        {outOfStock ? "Agotado" : "Elegir"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t z-[9]">
          <div className="max-w-md mx-auto space-y-2">
            {stdSelectedItems.length > 0 && (
              <p className="text-sm text-muted-foreground truncate" data-testid="text-drink-selection-summary">
                Pedido: {stdSelectedItems.map(it => it.productName).join(", ")}
              </p>
            )}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => handleStdNextFromDrink()} data-testid="button-std-skip-drinks">
                No quiero bebida
              </Button>
              <Button className="flex-1" onClick={handleStdNextFromDrink} data-testid="button-std-next-drink">
                Siguiente <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Standard: Review ───────────────────────────────────────
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
              onClick={() => setStep("std_food")}
              data-testid="button-std-back"
            >
              Volver atrás
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Pantalla Éxito ─────────────────────────────────────────
  if (step === "sent") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <Check className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-order-sent">Listo! Ya lo avisamos</h1>
          <p className="text-muted-foreground text-base" data-testid="text-order-sent-message">
            En un momentito llega el salonero a confirmarlo.
          </p>
          <p className="text-sm text-muted-foreground">Gracias, y buen provecho!</p>
          <Button className="min-h-[56px] text-base" onClick={resetAll} data-testid="button-new-order">
            <Plus className="w-5 h-5 mr-2" />
            Hacer otro pedido
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
