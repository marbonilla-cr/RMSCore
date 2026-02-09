import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { wsManager } from "@/lib/ws";
import {
  ArrowLeft, Plus, Send, Check, Trash2, Loader2,
  ShoppingBag, AlertCircle, ChefHat,
} from "lucide-react";
import type { Product, Category } from "@shared/schema";

interface TableCurrentView {
  table: any;
  activeOrder: any;
  orderItems: any[];
  pendingQrSubmissions: any[];
}

export default function TableDetailPage() {
  const [, params] = useRoute("/tables/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const tableId = params?.id ? parseInt(params.id) : 0;

  const [showMenu, setShowMenu] = useState(false);
  const [cart, setCart] = useState<{ productId: number; name: string; price: string; qty: number; notes: string }[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  const { data: currentView, isLoading: isLoadingCurrent } = useQuery<TableCurrentView>({
    queryKey: ["/api/tables", tableId, "current"],
    enabled: !!tableId,
    refetchInterval: 10000,
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/waiter/menu"],
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/admin/categories"],
  });

  useEffect(() => {
    wsManager.connect();
    const unsubs = [
      wsManager.on("order_updated", (p: any) => {
        if (p.tableId === tableId) {
          queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
        }
      }),
      wsManager.on("qr_submission_created", (p: any) => {
        if (p.tableId === tableId) {
          queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
          toast({ title: "Nuevo pedido QR", description: p.tableName ? `Pedido recibido en ${p.tableName}` : "Un cliente ha enviado un pedido desde QR" });
        }
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [tableId, toast]);

  const sendRoundMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/waiter/tables/${tableId}/send-round`, { items: cart });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tables", tableId, "current"] });
      queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      setCart([]);
      setShowMenu(false);
      toast({ title: "Ronda enviada a cocina" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const acceptSubmissionMutation = useMutation({
    mutationFn: async (submissionId: number) => {
      const res = await apiRequest("POST", `/api/waiter/qr-submissions/${submissionId}/accept`);
      return res;
    },
    onSuccess: (data: any) => {
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

  const addToCart = (product: Product) => {
    const existing = cart.find((c) => c.productId === product.id);
    if (existing) {
      setCart(cart.map((c) => (c.productId === product.id ? { ...c, qty: c.qty + 1 } : c)));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, price: product.price, qty: 1, notes: "" }]);
    }
  };

  const removeFromCart = (productId: number) => {
    setCart(cart.filter((c) => c.productId !== productId));
  };

  const updateCartQty = (productId: number, qty: number) => {
    if (qty <= 0) return removeFromCart(productId);
    setCart(cart.map((c) => (c.productId === productId ? { ...c, qty } : c)));
  };

  const filteredProducts = products.filter(
    (p) =>
      p.active &&
      (p.availablePortions === null || p.availablePortions > 0) &&
      (p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.productCode.toLowerCase().includes(searchTerm.toLowerCase()))
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

  const groupedItems = orderItems
    .filter((item: any) => item.status !== "PENDING" || !item.qrSubmissionId)
    .reduce((acc: Record<number, any[]>, item: any) => {
      const round = item.roundNumber || 1;
      if (!acc[round]) acc[round] = [];
      acc[round].push(item);
      return acc;
    }, {});

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING": return <Badge variant="secondary">Pendiente</Badge>;
      case "SENT": return <Badge>En Cocina</Badge>;
      case "PREPARING": return <Badge className="bg-blue-600 dark:bg-blue-700 text-white">Preparando</Badge>;
      case "READY": return <Badge className="bg-green-600 dark:bg-green-700 text-white">Listo</Badge>;
      default: return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (isLoadingCurrent) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <Button size="icon" variant="ghost" onClick={() => navigate("/tables")} data-testid="button-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <Skeleton className="h-8 w-40 mb-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <Skeleton className="h-32 w-full mb-4" />
        <Skeleton className="h-24 w-full mb-4" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 mb-6">
        <Button size="icon" variant="ghost" onClick={() => navigate("/tables")} data-testid="button-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-table-name">
            {tableData?.tableName || `Mesa ${tableId}`}
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeOrder ? `Orden #${activeOrder.id}` : "Sin orden abierta"}
          </p>
        </div>
      </div>

      {pendingSubmissions.length > 0 && (
        <Card className="mb-4 ring-2 ring-orange-500">
          <CardHeader className="pb-2 flex flex-row items-center gap-2">
            <AlertCircle className="w-5 h-5 text-orange-500" />
            <h2 className="font-bold text-orange-600" data-testid="text-pending-qr-title">Pedidos QR Pendientes</h2>
          </CardHeader>
          <CardContent>
            {pendingSubmissions.map((sub: any) => (
              <div key={sub.id} className="mb-4 last:mb-0" data-testid={`pending-submission-${sub.id}`}>
                <div className="space-y-2 mb-3">
                  {sub.items?.map((item: any) => (
                    <div key={item.id} className="flex items-center justify-between text-sm py-1" data-testid={`qr-item-${item.id}`}>
                      <span>{item.qty}x {item.productNameSnapshot}</span>
                      <span className="text-muted-foreground">₡{Number(Number(item.productPriceSnapshot) * item.qty).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => acceptSubmissionMutation.mutate(sub.id)}
                  disabled={acceptSubmissionMutation.isPending}
                  className="w-full"
                  data-testid={`button-accept-qr-${sub.id}`}
                >
                  {acceptSubmissionMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  ) : (
                    <Check className="w-4 h-4 mr-1" />
                  )}
                  Aceptar y Enviar a Cocina
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {Object.keys(groupedItems).length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <h2 className="font-bold flex items-center gap-2">
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
                    <div key={item.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{item.qty}x {item.productNameSnapshot}</p>
                        {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm">₡{Number(Number(item.productPriceSnapshot) * item.qty).toLocaleString()}</span>
                        {getStatusBadge(item.status)}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            {activeOrder?.totalAmount && (
              <div className="pt-3 border-t mt-3">
                <div className="flex items-center justify-between font-bold">
                  <span>Total</span>
                  <span>₡{Number(activeOrder.totalAmount).toLocaleString()}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {cart.length > 0 && (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <h2 className="font-bold flex items-center gap-2">
              <ShoppingBag className="w-5 h-5" /> Nueva Ronda
            </h2>
          </CardHeader>
          <CardContent>
            {cart.map((item) => (
              <div key={item.productId} className="flex items-center justify-between py-2 border-b last:border-0 gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.name}</p>
                  <Input
                    placeholder="Notas..."
                    value={item.notes}
                    onChange={(e) =>
                      setCart(cart.map((c) => (c.productId === item.productId ? { ...c, notes: e.target.value } : c)))
                    }
                    className="mt-1 text-xs h-7"
                  />
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => updateCartQty(item.productId, item.qty - 1)} className="h-7 w-7">
                    <span className="text-lg">-</span>
                  </Button>
                  <span className="w-6 text-center text-sm font-medium">{item.qty}</span>
                  <Button size="icon" variant="ghost" onClick={() => updateCartQty(item.productId, item.qty + 1)} className="h-7 w-7">
                    <span className="text-lg">+</span>
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => removeFromCart(item.productId)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              className="w-full mt-3"
              onClick={() => sendRoundMutation.mutate()}
              disabled={sendRoundMutation.isPending}
              data-testid="button-send-round"
            >
              {sendRoundMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Send className="w-4 h-4 mr-1" />}
              Enviar Ronda a Cocina
            </Button>
          </CardContent>
        </Card>
      )}

      <Button variant="outline" className="w-full" onClick={() => setShowMenu(true)} data-testid="button-add-items">
        <Plus className="w-4 h-4 mr-1" /> Agregar Items
      </Button>

      <Dialog open={showMenu} onOpenChange={setShowMenu}>
        <DialogContent className="max-h-[85vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle>Menu</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Buscar producto..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-3"
            data-testid="input-search-menu"
          />
          <div className="space-y-4">
            {sortedCategoryIds.map((catId) => {
              const catName = catId === "sin-categoria"
                ? "Sin Categoria"
                : categories.find((c) => c.id === Number(catId))?.name || "Categoria";
              const items = productsByCategory[catId];
              return (
                <div key={catId}>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1" data-testid={`text-category-${catId}`}>
                    {catName}
                  </h3>
                  <div className="space-y-1.5">
                    {items.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between p-2.5 md:p-3 rounded-md border hover-elevate cursor-pointer"
                        onClick={() => addToCart(p)}
                        data-testid={`menu-item-${p.id}`}
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{p.name}</p>
                          {p.description && <p className="text-xs text-muted-foreground truncate">{p.description}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="font-semibold text-sm">₡{Number(p.price).toLocaleString()}</span>
                          {p.availablePortions !== null && (
                            <Badge variant="secondary" className="text-xs">{p.availablePortions}</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
