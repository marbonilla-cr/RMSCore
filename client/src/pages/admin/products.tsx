import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, ShoppingBag, Loader2 } from "lucide-react";
import type { Product, Category } from "@shared/schema";

export default function AdminProductsPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({
    productCode: "", name: "", description: "", categoryId: "" as string,
    price: "", active: true, visibleQr: true, availablePortions: "" as string,
  });

  const { data: products = [], isLoading } = useQuery<Product[]>({ queryKey: ["/api/admin/products"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/admin/categories"] });

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

  const getCategoryName = (id: number | null) => {
    if (!id) return null;
    return categories.find((c) => c.id === id)?.name;
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
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
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={form.active} onCheckedChange={(c) => setForm({ ...form, active: c })} />
                  <Label>Activo</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.visibleQr} onCheckedChange={(c) => setForm({ ...form, visibleQr: c })} />
                  <Label>Visible QR</Label>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-product">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Producto"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ShoppingBag className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay productos</p>
            <Button variant="outline" className="mt-4" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1" /> Crear primer producto
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {products.map((p) => (
            <Card key={p.id} data-testid={`card-product-${p.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                    <ShoppingBag className="w-5 h-5 text-accent-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{p.description}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {getCategoryName(p.categoryId) && (
                        <Badge variant="secondary" className="text-xs">{getCategoryName(p.categoryId)}</Badge>
                      )}
                      {p.availablePortions !== null && (
                        <span className="text-xs text-muted-foreground">{p.availablePortions} porciones</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="font-semibold text-sm">₡{Number(p.price).toLocaleString()}</span>
                  <Badge variant={p.active ? "default" : "secondary"}>
                    {p.active ? "Activo" : "Inactivo"}
                  </Badge>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)} data-testid={`button-edit-product-${p.id}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
