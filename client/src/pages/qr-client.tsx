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
  Send, Loader2, Check, ChevronRight, ArrowRight,
} from "lucide-react";

interface QRProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  categoryName: string | null;
  availablePortions: number | null;
}

export default function QRClientPage() {
  const [, params] = useRoute("/qr/:tableCode");
  const tableCode = params?.tableCode || "";
  const { toast } = useToast();

  const [cart, setCart] = useState<{ productId: number; name: string; price: string; qty: number }[]>([]);
  const [confirmSlide, setConfirmSlide] = useState(false);
  const [slideProgress, setSlideProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: tableInfo, isLoading: tableLoading, error: tableError } = useQuery<any>({
    queryKey: ["/api/qr", tableCode, "info"],
    enabled: !!tableCode,
  });

  const { data: menu = [] } = useQuery<QRProduct[]>({
    queryKey: ["/api/qr", tableCode, "menu"],
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
      toast({ title: "Pedido enviado", description: "Un salonero revisará tu pedido pronto." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addToCart = (product: QRProduct) => {
    const existing = cart.find((c) => c.productId === product.id);
    if (existing) {
      setCart(cart.map((c) => (c.productId === product.id ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, qty: 1 }]);
    }
  };

  const updateQty = (productId: number, qty: number) => {
    if (qty <= 0) {
      setCart(cart.filter((c) => c.productId !== productId));
    } else {
      setCart(cart.map((c) => (c.productId === productId ? { ...c, qty } : c)));
    }
  };

  const cartTotal = cart.reduce((sum, c) => sum + Number(c.price) * c.qty, 0);

  const filteredMenu = menu.filter((p) =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const groupedMenu = filteredMenu.reduce((acc: Record<string, QRProduct[]>, p) => {
    const cat = p.categoryName || "Otros";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p);
    return acc;
  }, {});

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
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-50">
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

      <div className="max-w-lg mx-auto p-4">
        <Input
          placeholder="Buscar en el menú..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="mb-4"
          data-testid="input-search-qr-menu"
        />

        {Object.entries(groupedMenu).map(([category, items]) => (
          <div key={category} className="mb-6">
            <h2 className="font-bold text-lg mb-3">{category}</h2>
            <div className="space-y-2">
              {items.map((product) => {
                const inCart = cart.find((c) => c.productId === product.id);
                return (
                  <Card key={product.id} data-testid={`qr-product-${product.id}`}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm">{product.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.description}</p>
                          <p className="font-bold text-sm mt-1">₡{Number(product.price).toLocaleString()}</p>
                        </div>
                        <div className="flex-shrink-0">
                          {inCart ? (
                            <div className="flex items-center gap-1">
                              <Button size="icon" variant="outline" onClick={() => updateQty(product.id, inCart.qty - 1)} className="h-8 w-8">
                                <Minus className="w-3 h-3" />
                              </Button>
                              <span className="w-6 text-center text-sm font-bold">{inCart.qty}</span>
                              <Button size="icon" variant="outline" onClick={() => updateQty(product.id, inCart.qty + 1)} className="h-8 w-8">
                                <Plus className="w-3 h-3" />
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => addToCart(product)} data-testid={`button-add-qr-${product.id}`}>
                              <Plus className="w-3 h-3 mr-1" /> Agregar
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 z-50">
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
                    <div key={item.productId} className="flex items-center justify-between text-sm">
                      <span>{item.qty}x {item.name}</span>
                      <div className="flex items-center gap-2">
                        <span>₡{(Number(item.price) * item.qty).toLocaleString()}</span>
                        <Button size="icon" variant="ghost" onClick={() => updateQty(item.productId, 0)} className="h-6 w-6">
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
    </div>
  );
}
