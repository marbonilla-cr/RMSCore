import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  AlertTriangle,
  Pencil,
  ChevronDown,
  ChevronRight,
  Loader2,
  Package,
  ShoppingCart,
} from "lucide-react";

interface InvItem {
  id: number;
  sku: string;
  name: string;
  category: string;
  baseUom: string;
  onHandQtyBase: string;
  isActive: boolean;
}

interface Product {
  id: number;
  productCode: string;
  name: string;
  description: string;
  categoryId: number | null;
  price: string;
  active: boolean;
}

interface Category {
  id: number;
  name: string;
}

interface ReportPayload {
  entityType: "INV_ITEM" | "MENU_PRODUCT";
  invItemId?: number;
  menuProductId?: number;
  severityReport: "LOW_STOCK" | "NO_STOCK";
  notes?: string;
}

export default function ShortageReport() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  const [notesValues, setNotesValues] = useState<Record<string, string>>({});

  const { data: invItems, isLoading: loadingInv } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const { data: products, isLoading: loadingProducts } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: categories, isLoading: loadingCategories } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const reportMutation = useMutation({
    mutationFn: async (payload: ReportPayload) => {
      const res = await apiRequest("POST", "/api/shortages/report", payload);
      return await res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Faltante reportado" });
      if (data?.auditCreated) {
        toast({ title: "Se genero revision para gerente" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/shortages"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleCategory = useCallback((cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const toggleNotes = useCallback((key: string) => {
    setNotesOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const updateNotes = useCallback((key: string, value: string) => {
    setNotesValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleReport = useCallback(
    (
      entityType: "INV_ITEM" | "MENU_PRODUCT",
      id: number,
      severity: "LOW_STOCK" | "NO_STOCK",
      noteKey: string
    ) => {
      const payload: ReportPayload = {
        entityType,
        severityReport: severity,
        notes: notesValues[noteKey] || undefined,
      };
      if (entityType === "INV_ITEM") {
        payload.invItemId = id;
      } else {
        payload.menuProductId = id;
      }
      reportMutation.mutate(payload);
    },
    [notesValues, reportMutation]
  );

  const hasSearch = search.trim().length > 0;

  const filteredInvItems = useMemo(() => {
    if (!invItems) return [];
    const q = search.toLowerCase().trim();
    if (!q) return invItems.filter((i) => i.isActive);
    return invItems.filter(
      (i) => i.isActive && (i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
    );
  }, [invItems, search]);

  const invGrouped = useMemo(() => {
    const map = new Map<string, InvItem[]>();
    for (const item of filteredInvItems) {
      const cat = item.category || "Sin categoria";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredInvItems]);

  const categoryMap = useMemo(() => {
    if (!categories) return new Map<number, string>();
    const map = new Map<number, string>();
    for (const c of categories) {
      map.set(c.id, c.name);
    }
    return map;
  }, [categories]);

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    const q = search.toLowerCase().trim();
    if (!q) return products.filter((p) => p.active);
    return products.filter(
      (p) =>
        p.active &&
        (p.name.toLowerCase().includes(q) || p.productCode.toLowerCase().includes(q))
    );
  }, [products, search]);

  const prodGrouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filteredProducts) {
      const cat = (p.categoryId && categoryMap.get(p.categoryId)) || "Sin categoria";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredProducts, categoryMap]);

  const isLoading = loadingInv || loadingProducts || loadingCategories;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 flex-wrap">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg" data-testid="text-page-title">
              Reportar Faltante
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="sticky top-0 z-50 bg-card pb-3 pt-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o codigo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
          </div>

          <Tabs defaultValue="insumos">
            <TabsList className="w-full">
              <TabsTrigger value="insumos" className="flex-1 gap-1" data-testid="tab-insumos">
                <Package className="h-4 w-4" />
                Insumos
              </TabsTrigger>
              <TabsTrigger value="productos" className="flex-1 gap-1" data-testid="tab-productos">
                <ShoppingCart className="h-4 w-4" />
                Productos del Menu
              </TabsTrigger>
            </TabsList>

            <TabsContent value="insumos" className="mt-3 space-y-2">
              {invGrouped.length === 0 && (
                <p className="text-center text-muted-foreground py-8" data-testid="text-empty-insumos">
                  No se encontraron insumos
                </p>
              )}
              {invGrouped.map(([cat, items]) => {
                const isOpen = hasSearch || expandedCategories.has(`inv-${cat}`);
                return (
                  <div key={cat} className="border rounded-md" data-testid={`group-inv-${cat}`}>
                    <button
                      type="button"
                      className="flex items-center justify-between gap-2 w-full p-3 text-left text-sm font-medium hover-elevate rounded-md"
                      onClick={() => toggleCategory(`inv-${cat}`)}
                      data-testid={`button-toggle-inv-${cat}`}
                    >
                      <span>
                        {cat} ({items.length})
                      </span>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="border-t divide-y">
                        {items.map((item) => {
                          const noteKey = `inv-${item.id}`;
                          const showNotes = notesOpen.has(noteKey);
                          return (
                            <div key={item.id} className="p-3 space-y-2" data-testid={`item-inv-${item.id}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-sm" data-testid={`text-name-inv-${item.id}`}>
                                    {item.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground" data-testid={`text-stock-inv-${item.id}`}>
                                    Stock sistema: {parseFloat(item.onHandQtyBase).toFixed(2)} {item.baseUom}
                                  </p>
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => toggleNotes(noteKey)}
                                  data-testid={`button-notes-inv-${item.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </div>
                              {showNotes && (
                                <Textarea
                                  placeholder="Comentario opcional..."
                                  value={notesValues[noteKey] || ""}
                                  onChange={(e) => updateNotes(noteKey, e.target.value)}
                                  className="text-sm min-h-[60px]"
                                  data-testid={`textarea-notes-inv-${item.id}`}
                                />
                              )}
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  className="flex-1 border-amber-500 text-amber-600 dark:text-amber-400 dark:border-amber-400"
                                  disabled={reportMutation.isPending}
                                  onClick={() => handleReport("INV_ITEM", item.id, "LOW_STOCK", noteKey)}
                                  data-testid={`button-low-stock-inv-${item.id}`}
                                >
                                  {reportMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                  ) : null}
                                  Poco Stock
                                </Button>
                                <Button
                                  variant="destructive"
                                  className="flex-1"
                                  disabled={reportMutation.isPending}
                                  onClick={() => handleReport("INV_ITEM", item.id, "NO_STOCK", noteKey)}
                                  data-testid={`button-no-stock-inv-${item.id}`}
                                >
                                  {reportMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                  ) : null}
                                  Sin Stock
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>

            <TabsContent value="productos" className="mt-3 space-y-2">
              {prodGrouped.length === 0 && (
                <p className="text-center text-muted-foreground py-8" data-testid="text-empty-productos">
                  No se encontraron productos
                </p>
              )}
              {prodGrouped.map(([cat, prods]) => {
                const isOpen = hasSearch || expandedCategories.has(`prod-${cat}`);
                return (
                  <div key={cat} className="border rounded-md" data-testid={`group-prod-${cat}`}>
                    <button
                      type="button"
                      className="flex items-center justify-between gap-2 w-full p-3 text-left text-sm font-medium hover-elevate rounded-md"
                      onClick={() => toggleCategory(`prod-${cat}`)}
                      data-testid={`button-toggle-prod-${cat}`}
                    >
                      <span>
                        {cat} ({prods.length})
                      </span>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="border-t divide-y">
                        {prods.map((prod) => {
                          const noteKey = `prod-${prod.id}`;
                          const showNotes = notesOpen.has(noteKey);
                          return (
                            <div key={prod.id} className="p-3 space-y-2" data-testid={`item-prod-${prod.id}`}>
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-sm" data-testid={`text-name-prod-${prod.id}`}>
                                    {prod.name}
                                  </p>
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => toggleNotes(noteKey)}
                                  data-testid={`button-notes-prod-${prod.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </div>
                              {showNotes && (
                                <Textarea
                                  placeholder="Comentario opcional..."
                                  value={notesValues[noteKey] || ""}
                                  onChange={(e) => updateNotes(noteKey, e.target.value)}
                                  className="text-sm min-h-[60px]"
                                  data-testid={`textarea-notes-prod-${prod.id}`}
                                />
                              )}
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  className="flex-1 border-amber-500 text-amber-600 dark:text-amber-400 dark:border-amber-400"
                                  disabled={reportMutation.isPending}
                                  onClick={() => handleReport("MENU_PRODUCT", prod.id, "LOW_STOCK", noteKey)}
                                  data-testid={`button-low-stock-prod-${prod.id}`}
                                >
                                  {reportMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                  ) : null}
                                  Poco Stock
                                </Button>
                                <Button
                                  variant="destructive"
                                  className="flex-1"
                                  disabled={reportMutation.isPending}
                                  onClick={() => handleReport("MENU_PRODUCT", prod.id, "NO_STOCK", noteKey)}
                                  data-testid={`button-no-stock-prod-${prod.id}`}
                                >
                                  {reportMutation.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                                  ) : null}
                                  Sin Stock
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
