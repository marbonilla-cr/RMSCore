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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Tag, Loader2, ChefHat, Wine, Zap, Layers } from "lucide-react";
import type { Category } from "@shared/schema";

const TOP_COLOR_OPTIONS = [
  { value: "emerald", label: "Verde", class: "bg-emerald-600 dark:bg-emerald-500" },
  { value: "blue", label: "Azul", class: "bg-blue-600 dark:bg-blue-500" },
  { value: "rose", label: "Rosa", class: "bg-rose-600 dark:bg-rose-500" },
  { value: "amber", label: "Ámbar", class: "bg-amber-600 dark:bg-amber-500" },
  { value: "purple", label: "Morado", class: "bg-purple-600 dark:bg-purple-500" },
  { value: "cyan", label: "Cian", class: "bg-cyan-600 dark:bg-cyan-500" },
  { value: "orange", label: "Naranja", class: "bg-orange-600 dark:bg-orange-500" },
];

const DEFAULT_TOP_COLORS: Record<string, string> = {
  "TOP-COMIDAS": "emerald",
  "TOP-BEBIDAS": "blue",
  "TOP-POSTRES": "rose",
};

function getTopColorClass(code: string, colorValue?: string): string {
  const val = colorValue || DEFAULT_TOP_COLORS[code] || "primary";
  const found = TOP_COLOR_OPTIONS.find(c => c.value === val);
  return found ? found.class : "bg-primary";
}

export default function AdminCategoriesPage() {
  const { toast } = useToast();

  const [topOpen, setTopOpen] = useState(false);
  const [topEditing, setTopEditing] = useState<Category | null>(null);
  const [topForm, setTopForm] = useState({ categoryCode: "", name: "", active: true, sortOrder: 0 });

  const [subOpen, setSubOpen] = useState(false);
  const [subEditing, setSubEditing] = useState<Category | null>(null);
  const [subForm, setSubForm] = useState({ categoryCode: "", name: "", parentCategoryCode: "", active: true, sortOrder: 0, kdsDestination: "cocina", easyMode: false, foodType: "comidas" });

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["/api/admin/categories"],
  });

  const topCategories = categories.filter(c => c.categoryCode.startsWith("TOP-"));
  const subCategories = categories.filter(c => !c.categoryCode.startsWith("TOP-"));

  const seedTopsMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/categories/seed-tops"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      toast({ title: "TOPs base creados correctamente" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveTopMutation = useMutation({
    mutationFn: async (data: any) => {
      if (topEditing) {
        return apiRequest("PATCH", `/api/admin/categories/${topEditing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      setTopOpen(false);
      setTopEditing(null);
      toast({ title: topEditing ? "TOP actualizado" : "TOP creado" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveSubMutation = useMutation({
    mutationFn: async (data: any) => {
      if (subEditing) {
        return apiRequest("PATCH", `/api/admin/categories/${subEditing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/categories", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/categories"] });
      setSubOpen(false);
      setSubEditing(null);
      toast({ title: subEditing ? "Subcategoría actualizada" : "Subcategoría creada" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openCreateTop = () => {
    setTopEditing(null);
    setTopForm({ categoryCode: "", name: "", active: true, sortOrder: topCategories.length });
    setTopOpen(true);
  };

  const openEditTop = (cat: Category) => {
    setTopEditing(cat);
    setTopForm({ categoryCode: cat.categoryCode, name: cat.name, active: cat.active, sortOrder: cat.sortOrder });
    setTopOpen(true);
  };

  const handleTopSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = topForm.categoryCode.startsWith("TOP-") ? topForm.categoryCode : `TOP-${topForm.categoryCode.toUpperCase()}`;
    saveTopMutation.mutate({
      categoryCode: code,
      name: topForm.name,
      parentCategoryCode: null,
      active: topForm.active,
      sortOrder: topForm.sortOrder,
      kdsDestination: "cocina",
      easyMode: false,
      foodType: "comidas",
    });
  };

  const openCreateSub = () => {
    setSubEditing(null);
    const defaultTop = topCategories.length > 0 ? topCategories[0].categoryCode : "";
    setSubForm({ categoryCode: "", name: "", parentCategoryCode: defaultTop, active: true, sortOrder: 0, kdsDestination: "cocina", easyMode: false, foodType: "comidas" });
    setSubOpen(true);
  };

  const openEditSub = (cat: Category) => {
    setSubEditing(cat);
    const defaultParent = cat.parentCategoryCode || (topCategories.length > 0 ? topCategories[0].categoryCode : "");
    setSubForm({
      categoryCode: cat.categoryCode,
      name: cat.name,
      parentCategoryCode: defaultParent,
      active: cat.active,
      sortOrder: cat.sortOrder,
      kdsDestination: cat.kdsDestination || "cocina",
      easyMode: cat.easyMode,
      foodType: cat.foodType || "comidas",
    });
    setSubOpen(true);
  };

  const handleSubSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveSubMutation.mutate({ ...subForm, parentCategoryCode: subForm.parentCategoryCode || null });
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title flex items-center gap-2" data-testid="text-page-title">
            <Tag className="w-6 h-6" />
            Categorías
          </h1>
          <p className="admin-page-sub">Organice los productos del menú</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-8">
          <section>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">TOPs (Categorías Padre)</h2>
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
                <Button onClick={openCreateTop} data-testid="button-add-top">
                  <Plus className="w-4 h-4" />
                  <span className="ml-1">Nuevo TOP</span>
                </Button>
              </div>
            </div>

            {topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No hay TOPs. Cree uno o use "Crear TOPs Base".</p>
            ) : (
              <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(topCategories.length, 4)}, 1fr)` }}>
                {topCategories.sort((a, b) => a.sortOrder - b.sortOrder).map((top) => {
                  const childCount = subCategories.filter(sc => sc.parentCategoryCode === top.categoryCode).length;
                  return (
                    <Card key={top.id} data-testid={`card-top-${top.id}`} className="hover-elevate cursor-pointer" onClick={() => openEditTop(top)}>
                      <CardContent className="flex items-center justify-between gap-2 py-3 px-3 min-h-[48px]">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className={`w-3 h-3 rounded-full flex-shrink-0 ${getTopColorClass(top.categoryCode)}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">{top.name}</p>
                            <p className="text-xs text-muted-foreground">{childCount} subcategorías</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Badge variant={top.active ? "default" : "secondary"} className="text-xs">
                            {top.active ? "On" : "Off"}
                          </Badge>
                          <Pencil className="w-3 h-3 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Tag className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-semibold">Subcategorías</h2>
              </div>
              <Button onClick={openCreateSub} data-testid="button-add-category">
                <Plus className="w-4 h-4" />
                <span className="ml-1">Nueva Subcategoría</span>
              </Button>
            </div>

            {subCategories.length === 0 && topCategories.length > 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No hay subcategorías. Cree una para organizar productos.</p>
            ) : subCategories.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Tag className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No hay categorías</p>
                  <Button variant="outline" className="mt-4" onClick={openCreateSub}>
                    <Plus className="w-4 h-4 mr-1" /> Crear primera categoría
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {topCategories.sort((a, b) => a.sortOrder - b.sortOrder).map((top) => {
                  const children = subCategories.filter(sc => sc.parentCategoryCode === top.categoryCode).sort((a, b) => a.sortOrder - b.sortOrder);
                  if (children.length === 0) return null;
                  return (
                    <div key={top.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${getTopColorClass(top.categoryCode)}`} />
                        <h3 className="text-sm font-bold uppercase tracking-wide" data-testid={`text-top-${top.id}`}>{top.name}</h3>
                      </div>
                      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${children.length <= 3 ? children.length : 2}, 1fr)` }}>
                        {children.map((cat) => (
                          <Card key={cat.id} data-testid={`card-category-${cat.id}`} className="hover-elevate cursor-pointer" onClick={() => openEditSub(cat)}>
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
                    </div>
                  );
                })}
                {subCategories.filter(sc => !topCategories.some(t => t.categoryCode === sc.parentCategoryCode)).length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">Sin TOP asignado</h3>
                    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                      {subCategories.filter(sc => !topCategories.some(t => t.categoryCode === sc.parentCategoryCode)).map((cat) => (
                        <Card key={cat.id} data-testid={`card-category-${cat.id}`} className="hover-elevate cursor-pointer" onClick={() => openEditSub(cat)}>
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
          </section>
        </div>
      )}

      <Dialog open={topOpen} onOpenChange={setTopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{topEditing ? "Editar TOP" : "Nuevo TOP"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTopSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Código</Label>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">TOP-</span>
                  <Input
                    data-testid="input-top-code"
                    value={topForm.categoryCode.replace(/^TOP-/, "")}
                    onChange={(e) => setTopForm({ ...topForm, categoryCode: e.target.value.toUpperCase() })}
                    placeholder="COMIDAS"
                    required
                    disabled={!!topEditing}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Orden</Label>
                <Input
                  type="number"
                  value={topForm.sortOrder}
                  onChange={(e) => setTopForm({ ...topForm, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                data-testid="input-top-name"
                value={topForm.name}
                onChange={(e) => setTopForm({ ...topForm, name: e.target.value })}
                placeholder="Comidas"
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={topForm.active} onCheckedChange={(c) => setTopForm({ ...topForm, active: c })} />
              <Label>Activo</Label>
            </div>
            <Button type="submit" className="w-full" disabled={saveTopMutation.isPending} data-testid="button-save-top">
              {saveTopMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {topEditing ? "Guardar Cambios" : "Crear TOP"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={subOpen} onOpenChange={setSubOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{subEditing ? "Editar Subcategoría" : "Nueva Subcategoría"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Código</Label>
              <Input
                data-testid="input-category-code"
                value={subForm.categoryCode}
                onChange={(e) => setSubForm({ ...subForm, categoryCode: e.target.value })}
                placeholder="BEB-NATURALES"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                data-testid="input-category-name"
                value={subForm.name}
                onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
                placeholder="Bebidas Naturales"
                required
              />
            </div>
            {topCategories.length > 0 && (
              <div className="space-y-2">
                <Label>TOP Padre *</Label>
                <Select value={subForm.parentCategoryCode || topCategories[0]?.categoryCode} onValueChange={(v) => setSubForm({ ...subForm, parentCategoryCode: v })}>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Orden</Label>
                <Input
                  type="number"
                  value={subForm.sortOrder}
                  onChange={(e) => setSubForm({ ...subForm, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Destino KDS</Label>
                <Select value={subForm.kdsDestination} onValueChange={(v) => setSubForm({ ...subForm, kdsDestination: v })}>
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
            </div>
            <div className="space-y-2">
              <Label>Tipo de Alimento</Label>
              <Select value={subForm.foodType} onValueChange={(v) => setSubForm({ ...subForm, foodType: v })}>
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
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch checked={subForm.active} onCheckedChange={(c) => setSubForm({ ...subForm, active: c })} />
                <Label>Activa</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch data-testid="switch-category-easymode" checked={subForm.easyMode} onCheckedChange={(c) => setSubForm({ ...subForm, easyMode: c })} />
                <Label>Easy Mode</Label>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={saveSubMutation.isPending} data-testid="button-save-category">
              {saveSubMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {subEditing ? "Guardar Cambios" : "Crear Subcategoría"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
