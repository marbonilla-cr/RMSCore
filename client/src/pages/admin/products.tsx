import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, ShoppingBag, Loader2, Search, X, ChevronDown, ChevronRight } from "lucide-react";
import type { Product, Category } from "@shared/schema";

export default function AdminProductsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({
    productCode: "", name: "", description: "", categoryId: "" as string,
    price: "", active: true, visibleQr: true, availablePortions: "" as string,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery<Product[]>({ queryKey: ["/api/admin/products"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/admin/categories"] });

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (debouncedSearch.length === 0) {
      setExpandedCategoryId(null);
    }
  }, [debouncedSearch]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) return apiRequest("PATCH", `/api/admin/products/${editing.id}`, data);
      return apiRequest("POST", "/api/admin/products", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Producto actualizado" : "Producto creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      return apiRequest("PATCH", `/api/admin/products/${id}`, { active });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ productCode: "", name: "", description: "", categoryId: "", price: "", active: true, visibleQr: true, availablePortions: "" });
    setOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      productCode: p.productCode,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId?.toString() || "",
      price: p.price,
      active: p.active,
      visibleQr: p.visibleQr,
      availablePortions: p.availablePortions?.toString() || "",
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...form,
      categoryId: form.categoryId ? parseInt(form.categoryId) : null,
      availablePortions: form.availablePortions ? parseInt(form.availablePortions) : null,
    });
  };

  const searchLower = debouncedSearch.toLowerCase();
  const isSearching = searchLower.length > 0;

  const filteredProducts = products.filter(
    (p) =>
      !isSearching ||
      p.name.toLowerCase().includes(searchLower) ||
      p.productCode.toLowerCase().includes(searchLower) ||
      (p.description && p.description.toLowerCase().includes(searchLower))
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

  const getCategoryName = (catId: string) => {
    if (catId === "sin-categoria") return "Sin Categoría";
    const cat = categories.find((c) => c.id === Number(catId));
    return cat?.name || "Sin Categoría";
  };

  const toggleCategory = (catId: string) => {
    if (isSearching) return;
    setExpandedCategoryId((prev) => (prev === catId ? null : catId));
  };

  const isCategoryExpanded = (catId: string) => {
    if (isSearching) return true;
    return expandedCategoryId === catId;
  };

  return (
    <div className="p-3 md:p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <ShoppingBag className="w-6 h-6" />
            Productos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Administre el menú del restaurante</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-product">
              <Plus className="w-4 h-4" />
              <span className="ml-1">Nuevo Producto</span>
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Producto" : "Nuevo Producto"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Código</Label>
                  <Input data-testid="input-product-code" value={form.productCode} onChange={(e) => setForm({ ...form, productCode: e.target.value })} placeholder="PROD01" required />
                </div>
                <div className="space-y-2">
                  <Label>Precio</Label>
                  <Input data-testid="input-product-price" type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input data-testid="input-product-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nombre del producto" required />
              </div>
              <div className="space-y-2">
                <Label>Descripción</Label>
                <Textarea data-testid="input-product-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descripción detallada del producto" required />
              </div>
              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger data-testid="select-product-category">
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.filter(c => c.active).map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Porciones Disponibles (vacío = ilimitado)</Label>
                <Input type="number" value={form.availablePortions} onChange={(e) => setForm({ ...form, availablePortions: e.target.value })} placeholder="Ilimitado" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.visibleQr} onCheckedChange={(c) => setForm({ ...form, visibleQr: c })} />
                <Label>Visible QR</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-product">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Producto"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="sticky top-0 z-[9] bg-background pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            data-testid="input-search-products"
            placeholder="Buscar productos..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-9 text-base"
          />
          {searchTerm.length > 0 && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={() => setSearchTerm("")}
              data-testid="button-clear-search"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : products.length === 0 ? (
        <div className="py-12 text-center">
          <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">No hay productos</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" /> Crear primer producto
          </Button>
        </div>
      ) : sortedCategoryIds.length === 0 ? (
        <div className="py-12 text-center">
          <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground text-base" data-testid="text-no-results">Sin resultados</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedCategoryIds.map((catId) => {
            const catProducts = productsByCategory[catId];
            const expanded = isCategoryExpanded(catId);

            return (
              <div key={catId} className="rounded-md border overflow-visible">
                <button
                  data-testid={`button-toggle-category-${catId}`}
                  className="flex items-center gap-2 w-full text-left px-3 min-h-[48px] hover-elevate active-elevate-2"
                  onClick={() => toggleCategory(catId)}
                >
                  {expanded ? (
                    <ChevronDown className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="font-medium text-base flex-1">{getCategoryName(catId)}</span>
                  <Badge variant="secondary">{catProducts.length}</Badge>
                </button>

                {expanded && (
                  <div className="border-t">
                    {catProducts.map((p) => (
                      <div
                        key={p.id}
                        data-testid={`card-product-${p.id}`}
                        className={`flex items-center justify-between gap-2 px-3 min-h-[48px] border-b last:border-b-0 ${!p.active ? "opacity-50" : ""}`}
                      >
                        <div className="min-w-0 flex-1 py-2">
                          <p className="font-medium text-sm truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground">₡{Number(p.price).toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {p.availablePortions !== null && (
                            <Badge variant="outline" className="text-xs">{p.availablePortions}p</Badge>
                          )}
                          {!p.visibleQr && p.active && (
                            <Badge variant="outline" className="text-xs">No QR</Badge>
                          )}
                          <Switch
                            data-testid={`switch-product-active-${p.id}`}
                            checked={p.active}
                            onCheckedChange={(checked) => toggleActiveMutation.mutate({ id: p.id, active: checked })}
                          />
                          <Button size="icon" variant="ghost" onClick={() => openEdit(p)} data-testid={`button-edit-product-${p.id}`}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
