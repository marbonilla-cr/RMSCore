import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, ShoppingBag, Loader2, Search, X, Zap, Filter, Trash2, Upload, ImageOff } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { Product, Category, TaxCategory } from "@shared/schema";

export default function AdminProductsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({
    productCode: "", name: "", description: "", categoryId: "" as string,
    price: "", visibleQr: true, availablePortions: "" as string,
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filterTop, setFilterTop] = useState<string>("all");
  const [filterSubcat, setFilterSubcat] = useState<string>("all");

  const [selectedTaxIds, setSelectedTaxIds] = useState<number[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  const { data: products = [], isLoading } = useQuery<Product[]>({ queryKey: ["/api/admin/products"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/admin/categories"] });
  const { data: taxCategories = [] } = useQuery<TaxCategory[]>({ queryKey: ["/api/admin/tax-categories"] });

  const topCategories = useMemo(() => categories.filter(c => c.categoryCode.startsWith("TOP-")).sort((a, b) => a.sortOrder - b.sortOrder), [categories]);
  const subCategories = useMemo(() => categories.filter(c => !c.categoryCode.startsWith("TOP-")), [categories]);

  const filteredSubcats = useMemo(() => {
    if (filterTop === "all") return subCategories;
    return subCategories.filter(sc => sc.parentCategoryCode === filterTop);
  }, [filterTop, subCategories]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 250);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setFilterSubcat("all");
  }, [filterTop]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) {
        await apiRequest("PATCH", `/api/admin/products/${editing.id}`, data);
        await apiRequest("PUT", `/api/admin/products/${editing.id}/taxes`, { taxCategoryIds: selectedTaxIds });
        return;
      }
      const res = await apiRequest("POST", "/api/admin/products", data);
      const newProduct = await res.json();
      if (newProduct?.id && selectedTaxIds.length > 0) {
        await apiRequest("PUT", `/api/admin/products/${newProduct.id}/taxes`, { taxCategoryIds: selectedTaxIds });
      }
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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/admin/products/${id}`);
      return res.json();
    },
    onSuccess: (data: { hardDeleted: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      setDeleteTarget(null);
      toast({
        title: data.hardDeleted ? "Producto eliminado" : "Producto desactivado",
        description: data.hardDeleted
          ? "El producto fue eliminado permanentemente."
          : "El producto tiene órdenes asociadas y fue desactivado.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      return new Promise<{ imageUrl: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(",")[1];
            const res = await apiRequest("POST", `/api/admin/products/${id}/image`, {
              imageData: base64,
              mimeType: file.type,
            });
            const data = await res.json();
            resolve(data);
          } catch (err: any) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error("Error leyendo archivo"));
        reader.readAsDataURL(file);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      toast({ title: "Imagen actualizada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteImageMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/products/${id}/image`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      toast({ title: "Imagen eliminada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Error", description: "La imagen no debe exceder 2MB", variant: "destructive" });
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({ title: "Error", description: "Use JPG, PNG o WebP", variant: "destructive" });
      return;
    }
    uploadImageMutation.mutate({ id: editing.id, file });
    e.target.value = "";
  };

  const toggleMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: string; value: boolean }) => {
      return apiRequest("PATCH", `/api/admin/products/${id}`, { [field]: value });
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
    setForm({ productCode: "", name: "", description: "", categoryId: "", price: "", visibleQr: true, availablePortions: "" });
    setSelectedTaxIds([]);
    setOpen(true);
  };

  const openEdit = async (p: Product) => {
    setEditing(p);
    setForm({
      productCode: p.productCode,
      name: p.name,
      description: p.description,
      categoryId: p.categoryId?.toString() || "",
      price: p.price,
      visibleQr: p.visibleQr,
      availablePortions: p.availablePortions?.toString() || "",
    });
    try {
      const res = await fetch(`/api/admin/products/${p.id}/taxes`, { credentials: "include" });
      const ids = await res.json();
      setSelectedTaxIds(ids);
    } catch {
      setSelectedTaxIds([]);
    }
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

  const filteredProducts = useMemo(() => {
    let result = products;

    if (isSearching) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(searchLower) ||
          p.productCode.toLowerCase().includes(searchLower) ||
          (p.description && p.description.toLowerCase().includes(searchLower))
      );
    }

    if (filterSubcat !== "all") {
      const subcatId = parseInt(filterSubcat);
      result = result.filter(p => p.categoryId === subcatId);
    } else if (filterTop !== "all") {
      const subcatIds = new Set(subCategories.filter(sc => sc.parentCategoryCode === filterTop).map(sc => sc.id));
      result = result.filter(p => p.categoryId !== null && subcatIds.has(p.categoryId));
    }

    return result;
  }, [products, isSearching, searchLower, filterTop, filterSubcat, subCategories]);

  const getCategoryName = (categoryId: number | null) => {
    if (!categoryId) return "Sin Categoría";
    const cat = categories.find(c => c.id === categoryId);
    return cat?.name || "Sin Categoría";
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title flex items-center gap-2" data-testid="text-page-title">
            <ShoppingBag className="w-6 h-6" />
            Productos
          </h1>
          <p className="admin-page-sub">Administre el menú del restaurante</p>
        </div>
        <Button onClick={openCreate} data-testid="button-add-product">
          <Plus className="w-4 h-4" />
          <span className="ml-1">Nuevo Producto</span>
        </Button>
      </div>

      <div className="sticky top-0 z-[9] pb-3 space-y-3" style={{ background: 'var(--bg)' }}>
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

        {topCategories.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Filter className="w-4 h-4" />
              <span>Filtrar:</span>
            </div>
            <Select value={filterTop} onValueChange={setFilterTop}>
              <SelectTrigger className="w-[180px]" data-testid="select-filter-top">
                <SelectValue placeholder="Todos los TOPs" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los TOPs</SelectItem>
                {topCategories.map(top => (
                  <SelectItem key={top.categoryCode} value={top.categoryCode}>{top.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterSubcat} onValueChange={setFilterSubcat}>
              <SelectTrigger className="w-[200px]" data-testid="select-filter-subcat">
                <SelectValue placeholder="Todas las subcategorías" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las subcategorías</SelectItem>
                {filteredSubcats.filter(sc => sc.active).map(sc => (
                  <SelectItem key={sc.id} value={sc.id.toString()}>{sc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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
      ) : filteredProducts.length === 0 ? (
        <div className="py-12 text-center">
          <Search className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground text-base" data-testid="text-no-results">Sin resultados</p>
        </div>
      ) : (
        <div className="rounded-md border overflow-visible">
          <div className="hidden md:grid grid-cols-[1fr_120px_140px_80px_80px_80px_90px] gap-2 px-3 py-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <span>Producto</span>
            <span>Categoría</span>
            <span>Precio</span>
            <span className="text-center">Activo</span>
            <span className="text-center">Easy</span>
            <span className="text-center">QR</span>
            <span></span>
          </div>

          {filteredProducts.map((p) => (
            <div
              key={p.id}
              data-testid={`card-product-${p.id}`}
              className={`grid grid-cols-[1fr_auto] md:grid-cols-[1fr_120px_140px_80px_80px_80px_90px] gap-2 items-center px-3 min-h-[52px] border-b last:border-b-0 ${!p.active ? "opacity-50" : ""}`}
            >
              <div className="min-w-0 py-2">
                <p className="font-medium text-sm truncate">{p.name}</p>
                <p className="text-xs text-muted-foreground md:hidden">{getCategoryName(p.categoryId)} · ₡{Number(p.price).toLocaleString()}</p>
              </div>

              <span className="hidden md:block text-xs text-muted-foreground truncate">{getCategoryName(p.categoryId)}</span>

              <span className="hidden md:block text-sm font-medium">₡{Number(p.price).toLocaleString()}</span>

              <div className="hidden md:flex justify-center">
                <Switch
                  data-testid={`switch-product-active-${p.id}`}
                  checked={p.active}
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: p.id, field: "active", value: checked })}
                />
              </div>

              <div className="hidden md:flex justify-center">
                <Switch
                  data-testid={`switch-product-easy-${p.id}`}
                  checked={p.easyMode}
                  onCheckedChange={(checked) => toggleMutation.mutate({ id: p.id, field: "easyMode", value: checked })}
                />
              </div>

              <div className="hidden md:flex justify-center">
                {p.visibleQr ? (
                  <Badge variant="default" className="text-xs">Si</Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">No</Badge>
                )}
              </div>

              <div className="flex items-center gap-1 md:gap-0 flex-shrink-0">
                <div className="flex items-center gap-1 md:hidden">
                  <Switch
                    data-testid={`switch-product-active-mobile-${p.id}`}
                    checked={p.active}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: p.id, field: "active", value: checked })}
                  />
                  <Switch
                    data-testid={`switch-product-easy-mobile-${p.id}`}
                    checked={p.easyMode}
                    onCheckedChange={(checked) => toggleMutation.mutate({ id: p.id, field: "easyMode", value: checked })}
                  />
                  {p.easyMode && <Zap className="w-3 h-3" style={{ color: 'var(--amber)' }} />}
                </div>
                <Button size="icon" variant="ghost" onClick={() => openEdit(p)} data-testid={`button-edit-product-${p.id}`}>
                  <Pencil className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setDeleteTarget(p)} data-testid={`button-delete-product-${p.id}`}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
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
                  {categories.filter(c => c.active && !c.categoryCode.startsWith("TOP-")).map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Porciones Disponibles (vacío = ilimitado)</Label>
              <Input type="number" value={form.availablePortions} onChange={(e) => setForm({ ...form, availablePortions: e.target.value })} placeholder="Ilimitado" />
            </div>
            {taxCategories.filter(tc => tc.active).length > 0 && (
              <div className="space-y-2">
                <Label>Impuestos Aplicables</Label>
                <div className="space-y-2">
                  {taxCategories.filter(tc => tc.active).map(tc => (
                    <div key={tc.id} className="flex items-center gap-2 min-h-[36px]">
                      <Checkbox
                        checked={selectedTaxIds.includes(tc.id)}
                        onCheckedChange={(checked) => {
                          setSelectedTaxIds(prev =>
                            checked ? [...prev, tc.id] : prev.filter(id => id !== tc.id)
                          );
                        }}
                        data-testid={`checkbox-tax-${tc.id}`}
                      />
                      <span className="text-sm">{tc.name} ({tc.rate}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={form.visibleQr} onCheckedChange={(c) => setForm({ ...form, visibleQr: c })} />
              <Label>Visible QR</Label>
            </div>
            {editing && (
              <div className="space-y-2">
                <Label>Imagen del Producto</Label>
                <div className="flex items-start gap-3">
                  <div
                    className="w-24 h-24 rounded-lg overflow-hidden border flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--muted)", borderColor: "var(--border)" }}
                  >
                    {editing.imageUrl ? (
                      <img src={editing.imageUrl} alt={editing.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImageOff className="w-8 h-8 text-muted-foreground opacity-40" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="cursor-pointer" data-testid="button-upload-image">
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleImageSelect} />
                      <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm font-medium border hover:bg-muted transition-colors" style={{ borderColor: "var(--border)" }}>
                        {uploadImageMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        {editing.imageUrl ? "Cambiar" : "Subir"}
                      </span>
                    </label>
                    {editing.imageUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-xs justify-start px-3"
                        onClick={() => deleteImageMutation.mutate(editing.id)}
                        disabled={deleteImageMutation.isPending}
                        data-testid="button-delete-image"
                      >
                        {deleteImageMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Trash2 className="w-3 h-3 mr-1" />}
                        Eliminar imagen
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">JPG, PNG o WebP · Máx 2MB</p>
                  </div>
                </div>
              </div>
            )}
            <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-product">
              {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {editing ? "Guardar Cambios" : "Crear Producto"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-dialog-title">Eliminar producto</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-dialog-description">
              {deleteTarget ? `¿Eliminar "${deleteTarget.name}"? Si tiene órdenes asociadas se desactivará en lugar de eliminarse.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete"
              onClick={() => { if (deleteTarget) deleteMutation.mutate(deleteTarget.id); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
