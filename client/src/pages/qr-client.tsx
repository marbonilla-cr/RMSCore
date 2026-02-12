import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  UtensilsCrossed, ShoppingCart, Plus, Minus, Trash2,
  Send, Loader2, Check, ChevronRight, ChevronDown, ArrowRight, ClipboardList,
  Search, X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

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

interface QRCartItem {
  productId: number;
  name: string;
  price: string;
  qty: number;
  cartKey: string;
  modifiers?: { optionId: number; name: string; priceDelta: string; qty: number }[];
}

function makeQRCartKey(productId: number, modifiers?: { optionId: number }[]) {
  if (!modifiers || modifiers.length === 0) return `${productId}`;
  const ids = modifiers.map((m) => m.optionId).sort((a, b) => a - b).join(",");
  return `${productId}:${ids}`;
}

export default function QRClientPage() {
  const [, params] = useRoute("/qr/:tableCode");
  const tableCode = params?.tableCode || "";
  const { toast } = useToast();

  const [cart, setCart] = useState<QRCartItem[]>([]);
  const [confirmSlide, setConfirmSlide] = useState(false);
  const [slideProgress, setSlideProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [modDialogProduct, setModDialogProduct] = useState<QRProduct | null>(null);
  const [modGroups, setModGroups] = useState<QRModifierGroup[]>([]);
  const [selectedMods, setSelectedMods] = useState<Record<number, number[]>>({});
  const [loadingMods, setLoadingMods] = useState(false);

  const { data: tableInfo, isLoading: tableLoading, error: tableError } = useQuery<any>({
    queryKey: ["/api/qr", tableCode, "info"],
    enabled: !!tableCode,
  });

  const { data: menu = [] } = useQuery<QRProduct[]>({
    queryKey: ["/api/qr", tableCode, "menu"],
    enabled: !!tableCode,
  });

  const { data: previousItems = [] } = useQuery<{ id: number; productName: string; qty: number; price: string; status: string }[]>({
    queryKey: ["/api/qr", tableCode, "my-items"],
    enabled: !!tableCode,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/qr/${tableCode}/submit`, { items: cart });
    },
    onSuccess: () => {
      setCart([]);
      setConfirmSlide(false);
      setSlideProgress(0);
      setSubmitted(true);
      queryClient.invalidateQueries({ queryKey: ["/api/qr", tableCode, "my-items"] });
      toast({ title: "Pedido enviado", description: "Un salonero revisará tu pedido pronto." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleProductClick = async (product: QRProduct) => {
    setLoadingMods(true);
    try {
      const res = await fetch(`/api/products/${product.id}/modifiers`);
      const groups: QRModifierGroup[] = await res.json();
      if (groups.length > 0) {
        setModDialogProduct(product);
        setModGroups(groups);
        setSelectedMods({});
      } else {
        addToCartDirect(product, []);
      }
    } catch {
      addToCartDirect(product, []);
    } finally {
      setLoadingMods(false);
    }
  };

  const addToCartDirect = (product: QRProduct, mods: { optionId: number; name: string; priceDelta: string; qty: number }[]) => {
    const key = makeQRCartKey(product.id, mods);
    const existing = cart.find((c) => c.cartKey === key);
    if (existing) {
      setCart(cart.map((c) => (c.cartKey === key ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, qty: 1, cartKey: key, modifiers: mods.length > 0 ? mods : undefined }]);
    }
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

  const confirmModifiers = () => {
    if (!modDialogProduct) return;
    for (const group of modGroups) {
      const selected = selectedMods[group.id] || [];
      if (group.required && selected.length === 0) {
        toast({ title: `"${group.name}" es requerido`, variant: "destructive" });
        return;
      }
    }
    const mods: { optionId: number; name: string; priceDelta: string; qty: number }[] = [];
    for (const group of modGroups) {
      const selected = selectedMods[group.id] || [];
      for (const optId of selected) {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) mods.push({ optionId: opt.id, name: opt.name, priceDelta: opt.priceDelta, qty: 1 });
      }
    }
    addToCartDirect(modDialogProduct, mods);
    setModDialogProduct(null);
    setModGroups([]);
    setSelectedMods({});
  };

  const updateQty = (cartKey: string, qty: number) => {
    if (qty <= 0) {
      setCart(cart.filter((c) => c.cartKey !== cartKey));
    } else {
      setCart(cart.map((c) => (c.cartKey === cartKey ? { ...c, qty } : c)));
    }
  };

  const getItemTotal = (item: QRCartItem) => {
    const modDelta = (item.modifiers || []).reduce((s, m) => s + Number(m.priceDelta), 0);
    return (Number(item.price) + modDelta) * item.qty;
  };
  const cartTotal = cart.reduce((sum, c) => sum + getItemTotal(c), 0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const searchLower = debouncedSearch.toLowerCase();
  const isSearching = searchLower.length > 0;

  const filteredMenu = menu.filter((p) =>
    p.name.toLowerCase().includes(searchLower) ||
    p.description.toLowerCase().includes(searchLower)
  );

  const groupedMenu = filteredMenu.reduce((acc: Record<string, QRProduct[]>, p) => {
    const cat = p.categoryName || "Otros";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

  const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const toggleCategory = (cat: string) => {
    setExpandedCategory((prev) => (prev === cat ? null : cat));
  };

  const swipeTrackRef = useRef<HTMLDivElement>(null);
  const swipeThumbRef = useRef<HTMLDivElement>(null);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startXRef = useRef(0);
  const trackWidthRef = useRef(0);
  const SWIPE_THRESHOLD = 0.85;

  const handleSwipeStart = useCallback((clientX: number) => {
    if (!swipeTrackRef.current) return;
    setSwiping(true);
    startXRef.current = clientX;
    trackWidthRef.current = swipeTrackRef.current.offsetWidth - 56;
  }, []);

  const handleSwipeMove = useCallback((clientX: number) => {
    if (!swiping) return;
    const dx = clientX - startXRef.current;
    const clamped = Math.max(0, Math.min(dx, trackWidthRef.current));
    setSwipeX(clamped);
  }, [swiping]);

  const handleSwipeEnd = useCallback(() => {
    if (!swiping) return;
    setSwiping(false);
    const pct = swipeX / trackWidthRef.current;
    if (pct >= SWIPE_THRESHOLD && !submitMutation.isPending) {
      submitMutation.mutate();
    }
    setSwipeX(0);
  }, [swiping, swipeX, submitMutation]);

  if (tableLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tableError || !tableInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="py-12 text-center">
            <UtensilsCrossed className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="font-bold text-lg mb-2">Mesa no encontrada</h2>
            <p className="text-sm text-muted-foreground">El código QR no es válido o la mesa no está activa.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="font-bold text-lg mb-2" data-testid="text-order-sent">Pedido Enviado</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Un salonero revisará tu pedido y lo enviará a cocina. Puedes agregar más items.
            </p>
            <Button onClick={() => setSubmitted(false)} data-testid="button-order-more">
              <Plus className="w-4 h-4 mr-1" /> Agregar más items
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-[9]">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="w-5 h-5" />
            <span className="font-bold">Restaurante</span>
          </div>
          <Badge variant="secondary" className="text-xs" data-testid="text-table-badge">
            {tableInfo.tableName}
          </Badge>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-4">
        {previousItems.length > 0 && (
          <Card className="mb-4" data-testid="card-previous-items">
            <CardHeader className="pb-2 flex flex-row items-center gap-2">
              <ClipboardList className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-bold text-sm">Tu Pedido</h3>
              <Badge variant="secondary" className="ml-auto text-xs">{previousItems.length} items</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-1">
                {previousItems.map((item) => (
                  <div key={item.id} className="flex items-center justify-between text-sm" data-testid={`prev-item-${item.id}`}>
                    <span className="text-muted-foreground">{item.qty}x {item.productName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">₡{(Number(item.price) * item.qty).toLocaleString()}</span>
                      <Badge variant={item.status === "PENDING" ? "secondary" : "default"} className="text-[10px]">
                        {item.status === "PENDING" ? "Pendiente" : item.status === "SENT" ? "En cocina" : item.status === "READY" ? "Listo" : item.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t mt-2 pt-2 flex justify-between font-medium text-sm">
                <span>Subtotal pedido</span>
                <span>₡{previousItems.reduce((s, i) => s + Number(i.price) * i.qty, 0).toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="sticky top-[56px] z-[8] bg-background border-b px-4 py-2 max-w-lg mx-auto">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar en el menú..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-9"
            data-testid="input-search-qr-menu"
          />
          {searchTerm && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2"
              onClick={() => { setSearchTerm(""); setDebouncedSearch(""); setExpandedCategory(null); }}
              data-testid="button-clear-qr-search"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 pt-2">
        {filteredMenu.length === 0 && debouncedSearch.length > 0 && (
          <p className="text-center text-muted-foreground py-8" data-testid="text-no-results">Sin resultados</p>
        )}

        {Object.entries(groupedMenu).map(([category, items]) => {
          const isOpen = isSearching || expandedCategory === category;
          return (
            <div key={category} className="mb-2">
              <button
                type="button"
                className="w-full flex items-center gap-2 min-h-[48px] px-2 py-2 rounded-md hover-elevate"
                onClick={() => toggleCategory(category)}
                data-testid={`button-toggle-qr-category-${slugify(category)}`}
              >
                {isOpen ? <ChevronDown className="w-5 h-5 flex-shrink-0" /> : <ChevronRight className="w-5 h-5 flex-shrink-0" />}
                <span className="font-bold text-base flex-1 text-left">{category}</span>
                <Badge variant="secondary">{items.length}</Badge>
              </button>
              {isOpen && (
                <div className="space-y-2 pb-2">
                  {items.map((product) => {
                    const totalInCart = cart.filter((c) => c.productId === product.id).reduce((s, c) => s + c.qty, 0);
                    return (
                      <Card key={product.id} data-testid={`qr-product-${product.id}`}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-base">{product.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.description}</p>
                              <p className="font-bold text-sm mt-1">₡{Number(product.price).toLocaleString()}</p>
                            </div>
                            <div className="flex-shrink-0 flex items-center gap-2">
                              {totalInCart > 0 && (
                                <Badge variant="secondary">{totalInCart}</Badge>
                              )}
                              <Button size="sm" variant="outline" onClick={() => handleProductClick(product)} disabled={loadingMods} data-testid={`button-add-qr-${product.id}`} className="min-h-[48px]">
                                <Plus className="w-3 h-3 mr-1" /> Agregar
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 z-[9]">
          <div className="max-w-lg mx-auto">
            {!confirmSlide ? (
              <Button
                className="w-full"
                onClick={() => setConfirmSlide(true)}
                data-testid="button-review-cart"
              >
                <ShoppingCart className="w-4 h-4 mr-1" />
                Ver Pedido ({cart.length} items) - ₡{cartTotal.toLocaleString()}
                <ChevronRight className="w-4 h-4 ml-auto" />
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {cart.map((item) => (
                    <div key={item.cartKey} className="flex items-center justify-between text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span>{item.qty}x {item.name}</span>
                          <div className="flex items-center gap-1">
                            <Button size="icon" variant="ghost" onClick={() => updateQty(item.cartKey, item.qty - 1)}>
                              <Minus className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => updateQty(item.cartKey, item.qty + 1)}>
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        {item.modifiers && item.modifiers.length > 0 && (
                          <p className="text-xs text-muted-foreground">{item.modifiers.map((m) => m.name).join(", ")}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span>₡{getItemTotal(item).toLocaleString()}</span>
                        <Button size="icon" variant="ghost" onClick={() => updateQty(item.cartKey, 0)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between font-bold border-t pt-2">
                  <span>Total</span>
                  <span>₡{cartTotal.toLocaleString()}</span>
                </div>
                <p className="text-xs text-center text-muted-foreground">
                  Confirme la solicitud de este pedido
                </p>
                {submitMutation.isPending ? (
                  <div className="flex items-center justify-center py-3">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    <span className="text-sm font-medium">Enviando pedido...</span>
                  </div>
                ) : (
                  <div
                    ref={swipeTrackRef}
                    className="relative h-14 rounded-md bg-primary/10 overflow-hidden select-none"
                    data-testid="swipe-confirm-track"
                    onTouchStart={(e) => handleSwipeStart(e.touches[0].clientX)}
                    onTouchMove={(e) => handleSwipeMove(e.touches[0].clientX)}
                    onTouchEnd={handleSwipeEnd}
                    onMouseDown={(e) => handleSwipeStart(e.clientX)}
                    onMouseMove={(e) => handleSwipeMove(e.clientX)}
                    onMouseUp={handleSwipeEnd}
                    onMouseLeave={handleSwipeEnd}
                  >
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                        Desliza para confirmar <ArrowRight className="w-4 h-4" />
                      </span>
                    </div>
                    <div
                      className="absolute inset-y-0 left-0 bg-primary/20 rounded-md transition-none"
                      style={{ width: swipeX + 56 }}
                    />
                    <div
                      ref={swipeThumbRef}
                      className="absolute top-1 bottom-1 left-1 w-12 rounded-md bg-primary flex items-center justify-center text-primary-foreground cursor-grab active:cursor-grabbing"
                      style={{ transform: `translateX(${swipeX}px)`, transition: swiping ? 'none' : 'transform 0.3s ease' }}
                      data-testid="swipe-confirm-thumb"
                    >
                      <Send className="w-4 h-4" />
                    </div>
                  </div>
                )}
                <Button variant="outline" className="w-full" onClick={() => setConfirmSlide(false)}>
                  Volver al Menú
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {modDialogProduct && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50" data-testid="qr-modifier-dialog-overlay" onClick={() => { setModDialogProduct(null); setModGroups([]); setSelectedMods({}); }}>
          <Card className="w-full rounded-t-xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="pb-2 flex-shrink-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-bold text-base">{modDialogProduct.name}</h3>
                <span className="text-sm text-muted-foreground">₡{Number(modDialogProduct.price).toLocaleString()}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 overflow-y-auto flex-1 pb-4">
              {modGroups.map((group) => (
                <div key={group.id} data-testid={`qr-modifier-group-${group.id}`}>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="font-semibold text-sm">{group.name}</span>
                    {group.required && <Badge variant="secondary">Requerido</Badge>}
                    {group.multiSelect && <span className="text-xs text-muted-foreground">(varias opciones)</span>}
                  </div>
                  <div className="space-y-1">
                    {group.options.map((opt) => {
                      const isSelected = (selectedMods[group.id] || []).includes(opt.id);
                      return (
                        <div
                          key={opt.id}
                          className={`flex items-center justify-between p-3 rounded-md border cursor-pointer min-h-[44px] transition-colors ${isSelected ? "bg-primary/10 border-primary" : "hover-elevate"}`}
                          onClick={() => toggleModOption(group.id, opt.id, group.multiSelect)}
                          data-testid={`qr-modifier-option-${opt.id}`}
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
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setModDialogProduct(null); setModGroups([]); setSelectedMods({}); }}
                  data-testid="button-cancel-qr-modifiers"
                >
                  Cancelar
                </Button>
                <Button
                  className="flex-1"
                  onClick={confirmModifiers}
                  data-testid="button-confirm-qr-modifiers"
                >
                  <Plus className="w-4 h-4 mr-1" /> Agregar
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
