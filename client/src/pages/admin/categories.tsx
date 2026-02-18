import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Tag, Loader2, ChefHat, Wine, Zap, Layers } from "lucide-react";
import type { Category } from "@shared/schema";

export default function AdminCategoriesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ categoryCode: "", name: "", parentCategoryCode: "", active: true, sortOrder: 0, kdsDestination: "cocina", easyMode: false, foodType: "comidas" });

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["/api/admin/categories"],
  });

  const topCategories = categories.filter(c => c.categoryCode.startsWith("TOP-"));
  const subCategories = categories.filter(c => !c.categoryCode.startsWith("TOP-"));

  const seedTopsMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/admin/categories/seed-tops");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      toast({ title: "TOPs base creados correctamente" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) {
        return apiRequest("PATCH", `/api/admin/categories/${editing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Categoría actualizada" : "Categoría creada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    const defaultTop = topCategories.length > 0 ? topCategories[0].categoryCode : "";
    setForm({ categoryCode: "", name: "", parentCategoryCode: defaultTop, active: true, sortOrder: 0, kdsDestination: "cocina", easyMode: false, foodType: "comidas" });
    setOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditing(cat);
    const isTop = cat.categoryCode.startsWith("TOP-");
    const defaultParent = isTop ? "" : (cat.parentCategoryCode || (topCategories.length > 0 ? topCategories[0].categoryCode : ""));
    setForm({
      categoryCode: cat.categoryCode,
      name: cat.name,
      parentCategoryCode: defaultParent,
      active: cat.active,
      sortOrder: cat.sortOrder,
      kdsDestination: cat.kdsDestination || "cocina",
      easyMode: cat.easyMode,
      foodType: cat.foodType || "comidas",
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...form, parentCategoryCode: form.parentCategoryCode || null };
    saveMutation.mutate(payload);
  };

  return (
    <div className="p-3 md:p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Tag className="w-6 h-6" />
            Categorías
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Organice los productos del menú</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {topCategories.length === 0 && (
            <Button
              variant="outline"
              onClick={() => seedTopsMutation.mutate()}
              disabled={seedTopsMutation.isPending}
              data-testid="button-seed-tops"
            >
              {seedTopsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
              <span className="ml-1">Crear TOPs Base</span>
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openCreate} data-testid="button-add-category">
                <Plus className="w-4 h-4" />
                <span className="ml-1">Nueva Subcategoría</span>
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Categoría" : "Nueva Subcategoría"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Código</Label>
                <Input
                  data-testid="input-category-code"
                  value={form.categoryCode}
                  onChange={(e) => setForm({ ...form, categoryCode: e.target.value })}
                  placeholder="BEB"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  data-testid="input-category-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Bebidas"
                  required
                />
              </div>
              {topCategories.length > 0 && !(editing && editing.categoryCode.startsWith("TOP-")) && (
                <div className="space-y-2">
                  <Label>TOP Padre *</Label>
                  <Select value={form.parentCategoryCode || topCategories[0]?.categoryCode} onValueChange={(v) => setForm({ ...form, parentCategoryCode: v })}>
                    <SelectTrigger data-testid="select-parent-category">
                      <SelectValue placeholder="Seleccione TOP" />
                    </SelectTrigger>
                    <SelectContent>
                      {topCategories.map(top => (
                        <SelectItem key={top.categoryCode} value={top.categoryCode}>{top.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label>Orden</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Destino KDS</Label>
                <Select value={form.kdsDestination} onValueChange={(v) => setForm({ ...form, kdsDestination: v })}>
                  <SelectTrigger data-testid="select-kds-destination">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cocina">
                      <span className="flex items-center gap-2"><ChefHat className="w-4 h-4" /> Cocina</span>
                    </SelectItem>
                    <SelectItem value="bar">
                      <span className="flex items-center gap-2"><Wine className="w-4 h-4" /> Bar</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Alimento</Label>
                <Select value={form.foodType} onValueChange={(v) => setForm({ ...form, foodType: v })}>
                  <SelectTrigger data-testid="select-food-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bebidas">Bebidas</SelectItem>
                    <SelectItem value="comidas">Comidas</SelectItem>
                    <SelectItem value="extras">Extras</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.active} onCheckedChange={(c) => setForm({ ...form, active: c })} />
                <Label>Activa</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch data-testid="switch-category-easymode" checked={form.easyMode} onCheckedChange={(c) => setForm({ ...form, easyMode: c })} />
                <Label>Modo Fácil (Easy Mode)</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-category">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Subcategoría"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : categories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Tag className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay categorías</p>
            <Button variant="outline" className="mt-4" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1" /> Crear primera categoría
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {topCategories.map((top) => {
            const children = subCategories.filter(sc => sc.parentCategoryCode === top.categoryCode);
            const colorMap: Record<string, string> = {
              "TOP-COMIDAS": "bg-emerald-600 dark:bg-emerald-500",
              "TOP-BEBIDAS": "bg-blue-600 dark:bg-blue-500",
              "TOP-POSTRES": "bg-rose-600 dark:bg-rose-500",
            };
            return (
              <div key={top.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full flex-shrink-0 ${colorMap[top.categoryCode] || "bg-primary"}`} />
                    <h2 className="text-sm font-bold uppercase tracking-wide" data-testid={`text-top-${top.id}`}>{top.name}</h2>
                    <Badge variant={top.active ? "default" : "secondary"} className="text-xs">{top.active ? "Activa" : "Inactiva"}</Badge>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(top)} data-testid={`button-edit-category-${top.id}`}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
                {children.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">Sin subcategorías</p>
                ) : (
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${children.length <= 3 ? children.length : 2}, 1fr)` }}>
                    {children.map((cat) => (
                      <Card key={cat.id} data-testid={`card-category-${cat.id}`} className="hover-elevate cursor-pointer" onClick={() => openEdit(cat)}>
                        <CardContent className="flex items-center justify-between gap-2 py-3 px-3 min-h-[48px]">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{cat.name}</p>
                            <p className="text-xs text-muted-foreground">{cat.kdsDestination === "bar" ? "Bar" : "Cocina"}</p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {cat.easyMode && (
                              <Badge variant="outline" className="text-xs" data-testid="badge-easy-mode">
                                <Zap className="w-3 h-3" />
                              </Badge>
                            )}
                            <Badge variant={cat.active ? "default" : "secondary"} className="text-xs">
                              {cat.active ? "On" : "Off"}
                            </Badge>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {subCategories.filter(sc => !topCategories.some(t => t.categoryCode === sc.parentCategoryCode)).length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Sin TOP asignado</h2>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                {subCategories.filter(sc => !topCategories.some(t => t.categoryCode === sc.parentCategoryCode)).map((cat) => (
                  <Card key={cat.id} data-testid={`card-category-${cat.id}`} className="hover-elevate cursor-pointer" onClick={() => openEdit(cat)}>
                    <CardContent className="flex items-center justify-between gap-2 py-3 px-3 min-h-[48px]">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{cat.name}</p>
                        <p className="text-xs text-muted-foreground">{cat.kdsDestination === "bar" ? "Bar" : "Cocina"}</p>
                      </div>
                      <Badge variant={cat.active ? "default" : "secondary"} className="text-xs">
                        {cat.active ? "On" : "Off"}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
