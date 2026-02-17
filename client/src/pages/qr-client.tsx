import { useState, useCallback } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  UtensilsCrossed, Plus, Loader2, Check, ChevronLeft,
  Search, X, Users, User, ArrowRight, Coffee, ChefHat,
  Utensils, Send, CheckCircle2,
} from "lucide-react";

type Step =
  | "welcome"
  | "subaccount"
  | "name"
  | "easy_categories"
  | "easy_products"
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

interface QRModifierOption {
  id: number;
  name: string;
  priceDelta: string;
}

interface QRModifierGroup {
  id: number;
  name: string;
  required: boolean;
  multiSelect: boolean;
  options: QRModifierOption[];
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

function isBeverage(categoryName: string | null): boolean {
  if (!categoryName) return false;
  return categoryName.toLowerCase().includes("bebida");
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [easySearchTerm, setEasySearchTerm] = useState("");
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

  const activeSubaccounts = subaccounts.filter((s) => s.isActive);

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
      if (err.message.includes("max") || err.message.includes("limit")) {
        toast({ title: "Limite alcanzado", description: `Ya hay ${MAX_SUBACCOUNTS} cuentas en esta mesa. Usa una existente o pedile al salonero que lo acomode`, variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Se fue la senal un toque. Proba de nuevo y ya quedamos.", variant: "destructive" });
      }
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (payload: { subaccountId: number; items: CartItem[] }) => {
      const items = payload.items.map((it) => ({
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
    onSuccess: () => {
      setStep("sent");
    },
    onError: (err: Error) => {
      if (err.message.includes("pending") || err.message.includes("confirmando")) {
        toast({ title: "Espera un momento", description: "Un momentito. El salonero esta confirmando pedidos. Apenas confirme, podes enviar el siguiente.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: "Se fue la senal un toque. Proba de nuevo y ya quedamos.", variant: "destructive" });
      }
    },
  });

  const categories = Array.from(new Set(menu.map((p) => p.categoryName || "Otros")));

  const foodProducts = menu.filter((p) => !isBeverage(p.categoryName));
  const drinkProducts = menu.filter((p) => isBeverage(p.categoryName));

  const handleModeSelect = (m: "easy" | "standard") => {
    setMode(m);
    setStep("subaccount");
    refetchSubaccounts();
  };

  const handleSubaccountSelect = (sub: Subaccount) => {
    setSelectedSubaccount({ id: sub.id, code: sub.code, slotNumber: sub.slotNumber });
    setStep("name");
  };

  const handleNameContinue = () => {
    const trimmed = customerName.trim();
    if (!trimmed) {
      setNameError("Pone tu nombre para que no se nos enrede la cuenta");
      return;
    }
    setNameError("");
    if (mode === "easy") {
      setStep("easy_categories");
    } else {
      setDiners([{ name: trimmed, items: [] }]);
      setCurrentDinerIndex(0);
      setStdSelectedItems([]);
      setStep("std_food");
    }
  };

  const handleEasyProductClick = useCallback(async (product: QRProduct) => {
    if (product.availablePortions !== null && product.availablePortions <= 0) {
      toast({ title: "Agotado", description: "Uy... eso se nos acabo por hoy. Escoge otra opcion y seguimos.", variant: "destructive" });
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
        setStep("easy_modifiers");
      } else {
        setEasyItems((prev) => {
          const existing = prev.find((it) => it.productId === product.id && !it.modifiers?.length);
          if (existing) {
            return prev.map((it) => (it === existing ? { ...it, qty: it.qty + 1 } : it));
          }
          return [...prev, { productId: product.id, productName: product.name, qty: 1, customerName: customerName.trim(), categoryName: product.categoryName || "Otros" }];
        });
      }
    } catch {
      setEasyItems((prev) => [
        ...prev,
        { productId: product.id, productName: product.name, qty: 1, customerName: customerName.trim(), categoryName: product.categoryName || "Otros" },
      ]);
    } finally {
      setLoadingMods(false);
    }
  }, [customerName, toast]);

  const handleStdProductClick = useCallback(async (product: QRProduct) => {
    if (product.availablePortions !== null && product.availablePortions <= 0) {
      toast({ title: "Agotado", description: "Uy... eso se nos acabo por hoy. Escoge otra opcion y seguimos.", variant: "destructive" });
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
        setStep("std_modifiers");
      } else {
        addStdItem(product, []);
      }
    } catch {
      addStdItem(product, []);
    } finally {
      setLoadingMods(false);
    }
  }, [currentDinerIndex, diners]);

  const addStdItem = (product: QRProduct, mods: { modGroupId: number; optionId: number }[]) => {
    const dinerName = diners[currentDinerIndex]?.name || customerName.trim();
    const item: CartItem = {
      productId: product.id,
      productName: product.name,
      qty: 1,
      customerName: dinerName,
      modifiers: mods.length > 0 ? mods : undefined,
      categoryName: product.categoryName || "Otros",
    };
    setStdSelectedItems((prev) => {
      const existing = prev.find((it) => it.productId === product.id && JSON.stringify(it.modifiers) === JSON.stringify(item.modifiers));
      if (existing) {
        return prev.map((it) => (it === existing ? { ...it, qty: it.qty + 1 } : it));
      }
      return [...prev, item];
    });
  };

  const removeStdItem = (productId: number) => {
    setStdSelectedItems((prev) => prev.filter((it) => it.productId !== productId));
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
      const selected = selectedMods[group.id] || [];
      for (const optId of selected) {
        mods.push({ modGroupId: group.id, optionId: optId });
      }
    }

    if (mode === "easy") {
      setEasyItems((prev) => [
        ...prev,
        {
          productId: pendingProduct.id,
          productName: pendingProduct.name,
          qty: 1,
          customerName: customerName.trim(),
          modifiers: mods.length > 0 ? mods : undefined,
          categoryName: pendingProduct.categoryName || "Otros",
        },
      ]);
      setStep("easy_products");
    } else {
      addStdItem(pendingProduct, mods);
      setStep(returnStep === "std_modifiers" ? "std_food" : returnStep);
    }
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
  };

  const toggleModOption = (groupId: number, optionId: number, multi: boolean) => {
    setSelectedMods((prev) => {
      const current = prev[groupId] || [];
      if (multi) {
        return { ...prev, [groupId]: current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId] };
      }
      return { ...prev, [groupId]: current.includes(optionId) ? [] : [optionId] };
    });
  };

  const handleStdNextFromFood = () => {
    setStep("std_drink");
  };

  const handleStdNextFromDrink = () => {
    const dinerName = diners[currentDinerIndex]?.name || customerName.trim();
    const updatedDiners = [...diners];
    updatedDiners[currentDinerIndex] = { name: dinerName, items: [...stdSelectedItems] };
    setDiners(updatedDiners);
    setStep("std_review");
  };

  const handleStdSkipDrinks = () => {
    handleStdNextFromDrink();
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

  const handleSubmitEasy = () => {
    if (!selectedSubaccount) return;
    submitMutation.mutate({ subaccountId: selectedSubaccount.id, items: easyItems });
  };

  const handleSubmitStandard = () => {
    if (!selectedSubaccount) return;
    const allItems = diners.flatMap((d) => d.items);
    submitMutation.mutate({ subaccountId: selectedSubaccount.id, items: allItems });
  };

  const resetAll = () => {
    setStep("welcome");
    setMode(null);
    setSelectedSubaccount(null);
    setCustomerName("");
    setNameError("");
    setEasyItems([]);
    setSelectedCategory(null);
    setEasySearchTerm("");
    setPendingProduct(null);
    setModGroups([]);
    setSelectedMods({});
    setDiners([]);
    setCurrentDinerIndex(0);
    setStdSelectedItems([]);
  };

  const easyItemCount = easyItems.reduce((s, it) => s + it.qty, 0);

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
            <p className="text-sm text-muted-foreground">El codigo QR no es valido o la mesa no esta activa.</p>
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
            <UtensilsCrossed className="w-10 h-10 mx-auto text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-table-name">{tableInfo.tableName}</h1>
            <p className="text-muted-foreground">Bienvenido! Pedimos facil y sin carrera.</p>
          </div>
          <div className="space-y-3">
            <Button
              className="w-full min-h-[56px] text-base"
              onClick={() => handleModeSelect("easy")}
              data-testid="button-mode-easy"
            >
              <ChefHat className="w-5 h-5 mr-2" />
              Modo facil (entrevista)
            </Button>
            <Button
              variant="outline"
              className="w-full min-h-[56px] text-base"
              onClick={() => handleModeSelect("standard")}
              data-testid="button-mode-standard"
            >
              <Utensils className="w-5 h-5 mr-2" />
              Modo estandar (yo me la juego)
            </Button>
          </div>
          <p className="text-xs text-center text-muted-foreground" data-testid="text-welcome-note">
            Tranqui: un salonero confirma tu pedido antes de mandarlo a cocina.
          </p>
        </div>
      </div>
    );
  }

  if (step === "subaccount") {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-6 pt-8">
          <Button variant="ghost" size="sm" onClick={() => setStep("welcome")} data-testid="button-back-welcome">
            <ChevronLeft className="w-4 h-4 mr-1" /> Volver
          </Button>
          <div className="text-center space-y-2">
            <Users className="w-10 h-10 mx-auto text-primary" />
            <h1 className="text-xl font-bold" data-testid="text-subaccount-title">A cual cuenta lo cargamos?</h1>
            <p className="text-sm text-muted-foreground">Si vienen en grupos, asi en caja sale ordenadito.</p>
          </div>
          <div className="space-y-3">
            {activeSubaccounts.map((sub) => (
              <Button
                key={sub.id}
                variant="outline"
                className="w-full min-h-[48px] text-base"
                onClick={() => handleSubaccountSelect(sub)}
                data-testid={`button-subaccount-${sub.id}`}
              >
                {sub.label || sub.code}
              </Button>
            ))}
            {activeSubaccounts.length < MAX_SUBACCOUNTS ? (
              <Button
                className="w-full min-h-[48px]"
                onClick={() => createSubaccountMutation.mutate()}
                disabled={createSubaccountMutation.isPending}
                data-testid="button-create-subaccount"
              >
                {createSubaccountMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Crear cuenta nueva
              </Button>
            ) : (
              <p className="text-sm text-center text-muted-foreground p-3" data-testid="text-max-subaccounts">
                Ya hay {MAX_SUBACCOUNTS} cuentas en esta mesa. Usa una existente o pedile al salonero que lo acomode
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (step === "name") {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-6 pt-8">
          <Button variant="ghost" size="sm" onClick={() => setStep("subaccount")} data-testid="button-back-subaccount">
            <ChevronLeft className="w-4 h-4 mr-1" /> Volver
          </Button>
          <div className="text-center space-y-2">
            <User className="w-10 h-10 mx-auto text-primary" />
            <h1 className="text-xl font-bold" data-testid="text-name-title">Como te llamas?</h1>
            <p className="text-sm text-muted-foreground">Asi el salonero lo lee clarito.</p>
          </div>
          <div className="space-y-3">
            <Input
              value={customerName}
              onChange={(e) => { setCustomerName(e.target.value); setNameError(""); }}
              placeholder="Tu nombre"
              className="text-lg min-h-[48px]"
              autoFocus
              data-testid="input-customer-name"
            />
            {nameError && (
              <p className="text-sm text-destructive" data-testid="text-name-error">{nameError}</p>
            )}
            <Button
              className="w-full min-h-[48px]"
              onClick={handleNameContinue}
              data-testid="button-name-continue"
            >
              Continuar
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "easy_categories") {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-6 pt-4">
          <Button variant="ghost" size="sm" onClick={() => setStep("name")} data-testid="button-back-name">
            <ChevronLeft className="w-4 h-4 mr-1" /> Volver
          </Button>
          <div className="text-center space-y-2">
            <h1 className="text-xl font-bold" data-testid="text-easy-categories-title">Que se te antoja hoy?</h1>
          </div>
          <div className="space-y-3">
            {categories.map((cat) => (
              <Button
                key={cat}
                variant="outline"
                className="w-full min-h-[56px] text-base"
                onClick={() => { setSelectedCategory(cat); setEasySearchTerm(""); setStep("easy_products"); }}
                data-testid={`button-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {isBeverage(cat) ? <Coffee className="w-5 h-5 mr-2" /> : <ChefHat className="w-5 h-5 mr-2" />}
                {cat}
              </Button>
            ))}
          </div>
          {easyItemCount > 0 && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t z-[9]">
              <div className="max-w-md mx-auto">
                <Button className="w-full" onClick={() => setStep("easy_review")} data-testid="button-easy-view-order">
                  Ver Mi Pedido ({easyItemCount})
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (step === "easy_products") {
    const searchLower = easySearchTerm.toLowerCase();
    const productsInCategory = menu.filter((p) => (p.categoryName || "Otros") === selectedCategory);
    const filtered = searchLower
      ? productsInCategory.filter((p) => p.name.toLowerCase().includes(searchLower) || p.description.toLowerCase().includes(searchLower))
      : productsInCategory;

    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="sticky top-0 z-[9] bg-background border-b p-4">
          <div className="max-w-md mx-auto space-y-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setStep("easy_categories")} data-testid="button-back-categories">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <h1 className="text-lg font-bold flex-1" data-testid="text-easy-products-title">Elige tu plato</h1>
              <Badge variant="secondary">{selectedCategory}</Badge>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar..."
                value={easySearchTerm}
                onChange={(e) => setEasySearchTerm(e.target.value)}
                className="pl-9 pr-9"
                data-testid="input-easy-search"
              />
              {easySearchTerm && (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  onClick={() => setEasySearchTerm("")}
                  data-testid="button-clear-easy-search"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="max-w-md mx-auto px-4 pt-3 space-y-2">
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8" data-testid="text-no-results">Sin resultados</p>
          )}
          {filtered.map((product) => {
            const inCart = easyItems.filter((it) => it.productId === product.id).reduce((s, it) => s + it.qty, 0);
            const outOfStock = product.availablePortions !== null && product.availablePortions <= 0;
            return (
              <Card key={product.id} data-testid={`card-product-${product.id}`}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-base">{product.name}</p>
                      {product.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.description}</p>
                      )}
                      <p className="font-bold text-sm mt-1">₡{Number(product.price).toLocaleString()}</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {inCart > 0 && <Badge variant="secondary">{inCart}</Badge>}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEasyProductClick(product)}
                        disabled={loadingMods || outOfStock}
                        data-testid={`button-add-easy-${product.id}`}
                      >
                        {outOfStock ? "Agotado" : <><Plus className="w-3 h-3 mr-1" /> Agregar</>}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
        {easyItemCount > 0 && (
          <div className="fixed bottom-0 left-0 right-0 p-4 bg-background border-t z-[9]">
            <div className="max-w-md mx-auto">
              <Button className="w-full" onClick={() => setStep("easy_review")} data-testid="button-easy-view-order-bottom">
                Ver Mi Pedido ({easyItemCount})
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (step === "easy_modifiers" || step === "std_modifiers") {
    const returnStep = step === "easy_modifiers" ? "easy_products" : "std_food";
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-6 pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setPendingProduct(null); setModGroups([]); setSelectedMods({}); setStep(returnStep); }}
            data-testid="button-back-from-modifiers"
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Volver
          </Button>
          <h1 className="text-xl font-bold text-center" data-testid="text-modifiers-title">
            Como prefieres tu {pendingProduct?.name}?
          </h1>
          <div className="space-y-4">
            {modGroups.map((group) => (
              <div key={group.id} className="space-y-2" data-testid={`modifier-group-${group.id}`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{group.name}</span>
                  {group.required && <Badge variant="secondary">Requerido</Badge>}
                  {group.multiSelect && <span className="text-xs text-muted-foreground">(varias opciones)</span>}
                </div>
                <div className="space-y-2">
                  {group.options.map((opt) => {
                    const isSelected = (selectedMods[group.id] || []).includes(opt.id);
                    return (
                      <Button
                        key={opt.id}
                        variant={isSelected ? "default" : "outline"}
                        className="w-full min-h-[48px] justify-start text-left"
                        onClick={() => toggleModOption(group.id, opt.id, group.multiSelect)}
                        data-testid={`button-modifier-${opt.id}`}
                      >
                        {isSelected && <Check className="w-4 h-4 mr-2 flex-shrink-0" />}
                        <span className="flex-1">{opt.name}</span>
                        {Number(opt.priceDelta) !== 0 && (
                          <span className="text-xs ml-2">+₡{Number(opt.priceDelta).toLocaleString()}</span>
                        )}
                      </Button>
                    );
                  })}
                  {!group.required && (
                    <Button
                      variant={(selectedMods[group.id] || []).length === 0 ? "secondary" : "ghost"}
                      className="w-full min-h-[48px]"
                      onClick={() => setSelectedMods((prev) => ({ ...prev, [group.id]: [] }))}
                      data-testid={`button-modifier-skip-${group.id}`}
                    >
                      No gracias
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button
            className="w-full min-h-[48px]"
            onClick={() => confirmModifiers(step)}
            data-testid="button-confirm-modifiers"
          >
            Confirmar
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  if (step === "easy_review") {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-md mx-auto space-y-6 pt-4">
          <h1 className="text-xl font-bold text-center" data-testid="text-easy-review-title">Revisa tu pedido</h1>
          <p className="text-center text-muted-foreground" data-testid="text-easy-review-subtitle">
            {customerName.trim()} ({tableInfo.tableName}-{selectedSubaccount?.slotNumber})
          </p>
          <Card>
            <CardContent className="p-4 space-y-2">
              {easyItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between" data-testid={`review-item-${idx}`}>
                  <span>{item.qty}x {item.productName}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEasyItems((prev) => prev.filter((_, i) => i !== idx))}
                    data-testid={`button-remove-item-${idx}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
          {easyItems.length === 0 && (
            <p className="text-center text-muted-foreground text-sm">No hay items en tu pedido.</p>
          )}
          <div className="space-y-3">
            <Button
              className="w-full min-h-[48px]"
              onClick={handleSubmitEasy}
              disabled={submitMutation.isPending || easyItems.length === 0}
              data-testid="button-easy-confirm"
            >
              {submitMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Confirmar Pedido
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline py-2"
              onClick={() => setStep("easy_categories")}
              data-testid="button-easy-back-to-menu"
            >
              Volver atras
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            <h1 className="text-xl font-bold" data-testid="text-std-food-title">Que desea comer?</h1>
          </div>
        </div>
        <div className="max-w-md mx-auto px-4 pt-3">
          <div className="grid grid-cols-2 gap-3">
            {foodProducts.map((product) => {
              const isSelected = stdSelectedItems.some((it) => it.productId === product.id);
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
                        onClick={() => handleStdProductClick(product)}
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
                Pedido: {stdSelectedItems.map((it) => it.productName).join(", ")}
              </p>
            )}
            <Button
              className="w-full"
              onClick={handleStdNextFromFood}
              data-testid="button-std-next-food"
            >
              Siguiente
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

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
            <h1 className="text-xl font-bold" data-testid="text-std-drink-title">Algo para beber?</h1>
            <p className="text-sm text-muted-foreground">Pa' bajar la comida como Dios manda.</p>
          </div>
        </div>
        <div className="max-w-md mx-auto px-4 pt-3">
          <div className="grid grid-cols-2 gap-3">
            {drinkProducts.map((product) => {
              const isSelected = stdSelectedItems.some((it) => it.productId === product.id);
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
                        onClick={() => handleStdProductClick(product)}
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
                Pedido: {stdSelectedItems.map((it) => it.productName).join(", ")}
              </p>
            )}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleStdSkipDrinks}
                data-testid="button-std-skip-drinks"
              >
                Omitir
              </Button>
              <Button
                className="flex-1"
                onClick={handleStdNextFromDrink}
                data-testid="button-std-next-drink"
              >
                Siguiente
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
              className="w-full min-h-[48px]"
              onClick={handleAddAnotherDiner}
              data-testid="button-add-diner"
            >
              <Plus className="w-4 h-4 mr-2" />
              Agregar otro comensal
            </Button>
            <Button
              className="w-full min-h-[48px]"
              onClick={handleSubmitStandard}
              disabled={submitMutation.isPending || diners.every((d) => d.items.length === 0)}
              data-testid="button-std-confirm"
            >
              {submitMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Confirmar y enviar pedido
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline py-2"
              onClick={() => setStep("std_food")}
              data-testid="button-std-back"
            >
              Volver atras
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "sent") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <Check className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold" data-testid="text-order-sent">Pedido Enviado</h1>
          <p className="text-muted-foreground" data-testid="text-order-sent-message">En un momentito llega el salonero a confirmarlo.</p>
          <p className="text-sm text-muted-foreground">Gracias, y buen provecho</p>
          <Button onClick={resetAll} data-testid="button-new-order">
            <Plus className="w-4 h-4 mr-2" />
            Hacer otro pedido
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
