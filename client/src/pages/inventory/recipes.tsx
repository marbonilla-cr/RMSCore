import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, Trash2, Pencil, Search, ChefHat, DollarSign } from "lucide-react";

interface Product {
  id: number;
  name: string;
  productCode: string;
  inventoryControlEnabled: boolean;
  price: string;
}

interface InvItem {
  id: number;
  sku: string;
  name: string;
  itemType: string;
  baseUom: string;
  lastCostPerBaseUom: string;
  isActive: boolean;
}

interface RecipeWithDetails {
  id: number;
  menuProductId: number;
  version: number;
  isActive: boolean;
  yieldQty: string;
  note: string | null;
  createdAt: string;
  productName: string;
  productCode: string;
  lineCount: number;
}

interface RecipeLine {
  id: number;
  recipeId: number;
  invItemId: number;
  itemType: string;
  qtyBasePerMenuUnit: string;
  wastePct: string;
  invItemName?: string;
  baseUom?: string;
  itemCost?: string;
}

interface RecipeLineInput {
  invItemId: number;
  itemType: string;
  qtyBasePerMenuUnit: string;
  wastePct: string;
}

export default function RecipesPage() {
  const { toast } = useToast();
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [recipeLines, setRecipeLines] = useState<RecipeLineInput[]>([]);
  const [yieldQty, setYieldQty] = useState("1");
  const [recipeNote, setRecipeNote] = useState("");
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [lineForm, setLineForm] = useState({ invItemId: "", itemType: "EP", qtyBasePerMenuUnit: "", wastePct: "0" });
  const [editLineIndex, setEditLineIndex] = useState<number | null>(null);
  const [itemSearchFilter, setItemSearchFilter] = useState("");
  const [activeTab, setActiveTab] = useState("products");

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/inv/products"],
  });

  const { data: invItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const { data: allRecipes, isLoading: recipesLoading } = useQuery<RecipeWithDetails[]>({
    queryKey: ["/api/inv/recipes"],
  });

  const { data: expandedRecipeData } = useQuery<{ lines: RecipeLine[] }>({
    queryKey: ["/api/inv/recipes", editingRecipeId],
    enabled: editingRecipeId !== null,
  });

  const filteredProducts = (products || []).filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.productCode.toLowerCase().includes(productSearch.toLowerCase())
  );

  const activeItems = (invItems || []).filter(i => i.isActive);
  const epItems = activeItems.filter(i => i.itemType === "EP");
  const apItems = activeItems.filter(i => i.itemType === "AP");

  const productRecipeMap = new Map<number, RecipeWithDetails[]>();
  (allRecipes || []).forEach(r => {
    const list = productRecipeMap.get(r.menuProductId) || [];
    list.push(r);
    productRecipeMap.set(r.menuProductId, list);
  });

  const getActiveRecipeForProduct = (productId: number) => {
    const recipes = productRecipeMap.get(productId) || [];
    return recipes.find(r => r.isActive) || null;
  };

  const createRecipeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProductId) throw new Error("No product selected");
      await apiRequest("POST", "/api/inv/recipes", {
        menuProductId: selectedProductId,
        yieldQty,
        note: recipeNote || null,
        lines: recipeLines,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes"] });
      toast({ title: "Receta creada exitosamente" });
      closeRecipeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deactivateRecipeMutation = useMutation({
    mutationFn: async (recipeId: number) => {
      await apiRequest("DELETE", `/api/inv/recipes/${recipeId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes"] });
      toast({ title: "Receta desactivada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async (data: { recipeId: number; line: RecipeLineInput }) => {
      await apiRequest("POST", "/api/inv/recipe-lines", {
        recipeId: data.recipeId,
        invItemId: data.line.invItemId,
        itemType: data.line.itemType,
        qtyBasePerMenuUnit: data.line.qtyBasePerMenuUnit,
        wastePct: data.line.wastePct,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes"] });
      if (editingRecipeId) {
        queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes", editingRecipeId] });
      }
      toast({ title: "Línea agregada" });
      setAddLineOpen(false);
      resetLineForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editLineMutation = useMutation({
    mutationFn: async (data: { lineId: number; updates: Partial<RecipeLineInput> }) => {
      await apiRequest("PATCH", `/api/inv/recipe-lines/${data.lineId}`, data.updates);
    },
    onSuccess: () => {
      if (editingRecipeId) {
        queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes", editingRecipeId] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes"] });
      toast({ title: "Línea actualizada" });
      setAddLineOpen(false);
      setEditLineIndex(null);
      resetLineForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (lineId: number) => {
      await apiRequest("DELETE", `/api/inv/recipe-lines/${lineId}`);
    },
    onSuccess: () => {
      if (editingRecipeId) {
        queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes", editingRecipeId] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes"] });
      toast({ title: "Línea eliminada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  function resetLineForm() {
    setLineForm({ invItemId: "", itemType: "EP", qtyBasePerMenuUnit: "", wastePct: "0" });
    setItemSearchFilter("");
  }

  function closeRecipeDialog() {
    setRecipeDialogOpen(false);
    setRecipeLines([]);
    setYieldQty("1");
    setRecipeNote("");
    setSelectedProductId(null);
  }

  function openNewRecipe(productId: number) {
    setSelectedProductId(productId);
    setRecipeLines([]);
    setYieldQty("1");
    setRecipeNote("");
    setRecipeDialogOpen(true);
    setEditingRecipeId(null);
  }

  function openViewRecipe(recipeId: number) {
    setEditingRecipeId(recipeId);
  }

  function addLineToNewRecipe() {
    if (!lineForm.invItemId || !lineForm.qtyBasePerMenuUnit) return;
    if (editLineIndex !== null) {
      const updated = [...recipeLines];
      updated[editLineIndex] = {
        invItemId: parseInt(lineForm.invItemId),
        itemType: lineForm.itemType,
        qtyBasePerMenuUnit: lineForm.qtyBasePerMenuUnit,
        wastePct: lineForm.wastePct || "0",
      };
      setRecipeLines(updated);
      setEditLineIndex(null);
    } else {
      setRecipeLines([
        ...recipeLines,
        {
          invItemId: parseInt(lineForm.invItemId),
          itemType: lineForm.itemType,
          qtyBasePerMenuUnit: lineForm.qtyBasePerMenuUnit,
          wastePct: lineForm.wastePct || "0",
        },
      ]);
    }
    resetLineForm();
    setAddLineOpen(false);
  }

  function removeLineFromNewRecipe(index: number) {
    setRecipeLines(recipeLines.filter((_, i) => i !== index));
  }

  function calculateLineCost(invItemId: number, qty: string, wastePct: string) {
    const item = (invItems || []).find(i => i.id === invItemId);
    if (!item) return 0;
    const qtyNum = parseFloat(qty) || 0;
    const wasteMultiplier = 1 + (parseFloat(wastePct) || 0) / 100;
    return qtyNum * wasteMultiplier * parseFloat(item.lastCostPerBaseUom || "0");
  }

  function calculateTotalCost(lines: Array<{ invItemId: number; qtyBasePerMenuUnit: string; wastePct: string }>) {
    return lines.reduce((sum, line) => sum + calculateLineCost(line.invItemId, line.qtyBasePerMenuUnit, line.wastePct), 0);
  }

  const getItemName = (itemId: number) => {
    const item = (invItems || []).find(i => i.id === itemId);
    return item ? `${item.name} (${item.baseUom})` : `Ítem #${itemId}`;
  };

  const getItemType = (itemId: number) => {
    const item = (invItems || []).find(i => i.id === itemId);
    return item?.itemType || "AP";
  };

  const filteredItemsForSelect = activeItems.filter(i =>
    i.name.toLowerCase().includes(itemSearchFilter.toLowerCase()) ||
    i.sku.toLowerCase().includes(itemSearchFilter.toLowerCase())
  );

  return (
    <div className="admin-page">
      <h1 className="admin-page-title" data-testid="text-recipes-title">Recetas / BOM</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-recipes-view">
          <TabsTrigger value="products" data-testid="tab-products">Por Producto</TabsTrigger>
          <TabsTrigger value="all" data-testid="tab-all-recipes">Todas las Recetas</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <Card>
            <CardHeader>
              <CardTitle>Productos del Menú</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="input-product-search"
                  placeholder="Buscar producto..."
                  className="pl-9"
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                />
              </div>
              {productsLoading ? (
                <div className="flex justify-center p-4" data-testid="loading-products">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>Código</TableHead>
                        <TableHead>Receta</TableHead>
                        <TableHead className="text-right">Costo Est.</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.slice(0, 50).map((p) => {
                        const activeRecipe = getActiveRecipeForProduct(p.id);
                        return (
                          <TableRow key={p.id} data-testid={`row-product-${p.id}`}>
                            <TableCell data-testid={`text-product-name-${p.id}`}>
                              {p.name}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm" data-testid={`text-product-code-${p.id}`}>
                              {p.productCode}
                            </TableCell>
                            <TableCell>
                              {activeRecipe ? (
                                <Badge data-testid={`badge-recipe-status-${p.id}`}>
                                  v{activeRecipe.version} ({activeRecipe.lineCount} líneas)
                                </Badge>
                              ) : (
                                <Badge variant="secondary" data-testid={`badge-recipe-status-${p.id}`}>
                                  Sin receta
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right text-sm" data-testid={`text-recipe-cost-${p.id}`}>
                              {activeRecipe && activeRecipe.lineCount > 0 ? (
                                <span className="text-muted-foreground">ver detalle</span>
                              ) : "-"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1 flex-wrap">
                                {activeRecipe && (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    data-testid={`button-view-recipe-${p.id}`}
                                    onClick={() => openViewRecipe(activeRecipe.id)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  data-testid={`button-new-recipe-${p.id}`}
                                  onClick={() => openNewRecipe(p.id)}
                                >
                                  <Plus className="mr-1 h-4 w-4" />
                                  {activeRecipe ? "Nueva versión" : "Crear receta"}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle>Todas las Recetas</CardTitle>
            </CardHeader>
            <CardContent>
              {recipesLoading ? (
                <div className="flex justify-center p-4" data-testid="loading-all-recipes">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (allRecipes || []).length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead>Versión</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Líneas</TableHead>
                        <TableHead>Rendimiento</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(allRecipes || []).map((r) => (
                        <TableRow key={r.id} data-testid={`row-recipe-${r.id}`}>
                          <TableCell data-testid={`text-recipe-product-${r.id}`}>
                            {r.productName}
                            <span className="text-muted-foreground text-sm ml-1">({r.productCode})</span>
                          </TableCell>
                          <TableCell data-testid={`text-recipe-version-${r.id}`}>
                            v{r.version}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={r.isActive ? "default" : "secondary"}
                              data-testid={`badge-recipe-active-${r.id}`}
                            >
                              {r.isActive ? "Activa" : "Inactiva"}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-recipe-lines-${r.id}`}>
                            {r.lineCount}
                          </TableCell>
                          <TableCell data-testid={`text-recipe-yield-${r.id}`}>
                            {r.yieldQty}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1 flex-wrap">
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-view-recipe-detail-${r.id}`}
                                onClick={() => openViewRecipe(r.id)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {r.isActive && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  data-testid={`button-deactivate-recipe-${r.id}`}
                                  onClick={() => deactivateRecipeMutation.mutate(r.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-no-recipes">
                  No hay recetas creadas.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {editingRecipeId !== null && (
        <RecipeDetailCard
          recipeId={editingRecipeId}
          recipe={(allRecipes || []).find(r => r.id === editingRecipeId) || null}
          lines={expandedRecipeData?.lines || []}
          invItems={invItems || []}
          onClose={() => setEditingRecipeId(null)}
          onAddLine={(recipeId) => {
            resetLineForm();
            setEditLineIndex(null);
            setAddLineOpen(true);
          }}
          onEditLine={(line, index) => {
            setLineForm({
              invItemId: String(line.invItemId),
              itemType: line.itemType || "AP",
              qtyBasePerMenuUnit: line.qtyBasePerMenuUnit,
              wastePct: line.wastePct,
            });
            setEditLineIndex(index);
            setAddLineOpen(true);
          }}
          onDeleteLine={(lineId) => deleteLineMutation.mutate(lineId)}
          onDeactivate={(recipeId) => deactivateRecipeMutation.mutate(recipeId)}
        />
      )}

      <Dialog open={recipeDialogOpen} onOpenChange={(open) => { if (!open) closeRecipeDialog(); }}>
        <DialogContent className="max-w-2xl" data-testid="dialog-new-recipe">
          <DialogHeader>
            <DialogTitle>
              <ChefHat className="inline mr-2 h-5 w-5" />
              Nueva Receta
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-recipe-product-name">
              Producto: <strong>{(products || []).find(p => p.id === selectedProductId)?.name}</strong>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="yield-qty">Rendimiento (unidades menú)</Label>
                <Input
                  id="yield-qty"
                  data-testid="input-yield-qty"
                  type="number"
                  step="0.01"
                  value={yieldQty}
                  onChange={(e) => setYieldQty(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="recipe-note">Nota (opcional)</Label>
                <Input
                  id="recipe-note"
                  data-testid="input-recipe-note"
                  value={recipeNote}
                  onChange={(e) => setRecipeNote(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label>Ingredientes</Label>
                <Button
                  variant="outline"
                  data-testid="button-add-line-new-recipe"
                  onClick={() => {
                    resetLineForm();
                    setEditLineIndex(null);
                    setAddLineOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Agregar
                </Button>
              </div>

              {recipeLines.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Ítem</TableHead>
                        <TableHead className="text-right">Qty / Unidad</TableHead>
                        <TableHead className="text-right">% Merma</TableHead>
                        <TableHead className="text-right">Costo Est.</TableHead>
                        <TableHead className="text-right">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipeLines.map((line, idx) => (
                        <TableRow key={idx} data-testid={`row-new-recipe-line-${idx}`}>
                          <TableCell>
                            <Badge variant={line.itemType === "EP" ? "default" : "secondary"} data-testid={`badge-line-type-${idx}`}>
                              {line.itemType}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-line-item-${idx}`}>
                            {getItemName(line.invItemId)}
                          </TableCell>
                          <TableCell className="text-right" data-testid={`text-line-qty-${idx}`}>
                            {parseFloat(line.qtyBasePerMenuUnit).toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right" data-testid={`text-line-waste-${idx}`}>
                            {parseFloat(line.wastePct).toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-right" data-testid={`text-line-cost-${idx}`}>
                            ${calculateLineCost(line.invItemId, line.qtyBasePerMenuUnit, line.wastePct).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-edit-new-line-${idx}`}
                                onClick={() => {
                                  setLineForm({
                                    invItemId: String(line.invItemId),
                                    itemType: line.itemType,
                                    qtyBasePerMenuUnit: line.qtyBasePerMenuUnit,
                                    wastePct: line.wastePct,
                                  });
                                  setEditLineIndex(idx);
                                  setAddLineOpen(true);
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-remove-new-line-${idx}`}
                                onClick={() => removeLineFromNewRecipe(idx)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-3" data-testid="text-no-lines-yet">
                  Agregue ingredientes a la receta.
                </p>
              )}

              {recipeLines.length > 0 && (
                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium" data-testid="text-total-recipe-cost">
                    Costo total estimado: ${calculateTotalCost(recipeLines).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRecipeDialog} data-testid="button-cancel-recipe">
              Cancelar
            </Button>
            <Button
              data-testid="button-submit-new-recipe"
              onClick={() => createRecipeMutation.mutate()}
              disabled={createRecipeMutation.isPending || recipeLines.length === 0}
            >
              {createRecipeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear Receta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addLineOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddLineOpen(false);
            setEditLineIndex(null);
            resetLineForm();
          }
        }}
      >
        <DialogContent data-testid="dialog-recipe-line">
          <DialogHeader>
            <DialogTitle>{editLineIndex !== null ? "Editar Ingrediente" : "Agregar Ingrediente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Tipo de Ítem</Label>
              <Select
                value={lineForm.itemType}
                onValueChange={(v) => {
                  setLineForm({ ...lineForm, itemType: v, invItemId: "" });
                  setItemSearchFilter("");
                }}
              >
                <SelectTrigger data-testid="select-item-type-trigger">
                  <SelectValue placeholder="Seleccionar tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EP" data-testid="select-item-type-ep">EP (Elaborado)</SelectItem>
                  <SelectItem value="AP" data-testid="select-item-type-ap">AP (Materia Prima)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Ítem de Inventario</Label>
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    data-testid="input-item-search"
                    placeholder="Buscar ítem..."
                    className="pl-9"
                    value={itemSearchFilter}
                    onChange={(e) => setItemSearchFilter(e.target.value)}
                  />
                </div>
                <Select
                  value={lineForm.invItemId}
                  onValueChange={(v) => {
                    const selectedItem = activeItems.find(i => String(i.id) === v);
                    setLineForm({
                      ...lineForm,
                      invItemId: v,
                      itemType: selectedItem?.itemType || lineForm.itemType,
                    });
                  }}
                >
                  <SelectTrigger data-testid="select-inv-item-trigger">
                    <SelectValue placeholder="Seleccionar ítem" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredItemsForSelect
                      .filter(i => lineForm.itemType === "" || i.itemType === lineForm.itemType)
                      .slice(0, 50)
                      .map((item) => (
                        <SelectItem key={item.id} value={String(item.id)} data-testid={`select-inv-item-${item.id}`}>
                          <span className="flex items-center gap-2">
                            <Badge variant={item.itemType === "EP" ? "default" : "secondary"} className="text-xs">
                              {item.itemType}
                            </Badge>
                            {item.name} ({item.baseUom})
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="qty-per-unit">Cantidad por unidad menú</Label>
                <Input
                  id="qty-per-unit"
                  data-testid="input-qty-per-unit"
                  type="number"
                  step="0.0001"
                  value={lineForm.qtyBasePerMenuUnit}
                  onChange={(e) => setLineForm({ ...lineForm, qtyBasePerMenuUnit: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="waste-pct">% Desperdicio</Label>
                <Input
                  id="waste-pct"
                  data-testid="input-waste-pct"
                  type="number"
                  step="0.01"
                  value={lineForm.wastePct}
                  onChange={(e) => setLineForm({ ...lineForm, wastePct: e.target.value })}
                />
              </div>
            </div>

            {lineForm.invItemId && lineForm.qtyBasePerMenuUnit && (
              <div className="text-sm text-muted-foreground bg-muted p-2 rounded-md" data-testid="text-line-cost-preview">
                Costo estimado: ${calculateLineCost(
                  parseInt(lineForm.invItemId),
                  lineForm.qtyBasePerMenuUnit,
                  lineForm.wastePct
                ).toFixed(4)}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              data-testid="button-submit-recipe-line"
              onClick={() => {
                if (recipeDialogOpen) {
                  addLineToNewRecipe();
                } else if (editingRecipeId && editLineIndex !== null) {
                  const lines = expandedRecipeData?.lines || [];
                  const existingLine = lines[editLineIndex];
                  if (existingLine) {
                    editLineMutation.mutate({
                      lineId: existingLine.id,
                      updates: {
                        qtyBasePerMenuUnit: lineForm.qtyBasePerMenuUnit,
                        wastePct: lineForm.wastePct,
                      },
                    });
                  }
                } else if (editingRecipeId) {
                  addLineMutation.mutate({
                    recipeId: editingRecipeId,
                    line: {
                      invItemId: parseInt(lineForm.invItemId),
                      itemType: lineForm.itemType,
                      qtyBasePerMenuUnit: lineForm.qtyBasePerMenuUnit,
                      wastePct: lineForm.wastePct || "0",
                    },
                  });
                }
              }}
              disabled={!lineForm.invItemId || !lineForm.qtyBasePerMenuUnit || addLineMutation.isPending || editLineMutation.isPending}
            >
              {(addLineMutation.isPending || editLineMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editLineIndex !== null ? "Guardar" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecipeDetailCard({
  recipeId,
  recipe,
  lines,
  invItems,
  onClose,
  onAddLine,
  onEditLine,
  onDeleteLine,
  onDeactivate,
}: {
  recipeId: number;
  recipe: RecipeWithDetails | null;
  lines: RecipeLine[];
  invItems: InvItem[];
  onClose: () => void;
  onAddLine: (recipeId: number) => void;
  onEditLine: (line: RecipeLine, index: number) => void;
  onDeleteLine: (lineId: number) => void;
  onDeactivate: (recipeId: number) => void;
}) {
  const totalCost = lines.reduce((sum, line) => {
    const item = invItems.find(i => i.id === line.invItemId);
    if (!item) return sum;
    const qty = parseFloat(line.qtyBasePerMenuUnit) || 0;
    const waste = 1 + (parseFloat(line.wastePct) || 0) / 100;
    return sum + qty * waste * parseFloat(item.lastCostPerBaseUom || "0");
  }, 0);

  if (!recipe) {
    return (
      <Card className="mt-4">
        <CardContent className="p-4">
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-4" data-testid={`card-recipe-detail-${recipeId}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
        <div>
          <CardTitle className="flex items-center gap-2 flex-wrap">
            <ChefHat className="h-5 w-5" />
            {recipe.productName}
            <Badge variant={recipe.isActive ? "default" : "secondary"}>
              v{recipe.version} - {recipe.isActive ? "Activa" : "Inactiva"}
            </Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Rendimiento: {recipe.yieldQty} | Líneas: {lines.length}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {recipe.isActive && (
            <>
              <Button
                variant="outline"
                data-testid="button-add-line-existing"
                onClick={() => onAddLine(recipeId)}
              >
                <Plus className="mr-1 h-4 w-4" />
                Agregar Línea
              </Button>
              <Button
                variant="outline"
                data-testid="button-deactivate-recipe-detail"
                onClick={() => onDeactivate(recipeId)}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Desactivar
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose} data-testid="button-close-recipe-detail">
            Cerrar
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {lines.length > 0 ? (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Ítem</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Qty / Unidad</TableHead>
                    <TableHead className="text-right">% Merma</TableHead>
                    <TableHead className="text-right">Costo Unit.</TableHead>
                    <TableHead className="text-right">Costo Línea</TableHead>
                    {recipe.isActive && <TableHead className="text-right">Acciones</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => {
                    const item = invItems.find(i => i.id === line.invItemId);
                    const qty = parseFloat(line.qtyBasePerMenuUnit) || 0;
                    const waste = 1 + (parseFloat(line.wastePct) || 0) / 100;
                    const unitCost = parseFloat(item?.lastCostPerBaseUom || line.itemCost || "0");
                    const lineCost = qty * waste * unitCost;

                    return (
                      <TableRow key={line.id} data-testid={`row-recipe-line-${line.id}`}>
                        <TableCell>
                          <Badge variant={line.itemType === "EP" ? "default" : "secondary"} data-testid={`badge-line-type-${line.id}`}>
                            {line.itemType}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-recipe-line-item-${line.id}`}>
                          {line.invItemName || item?.name || `Ítem #${line.invItemId}`}
                        </TableCell>
                        <TableCell data-testid={`text-recipe-line-uom-${line.id}`}>
                          {line.baseUom || item?.baseUom || "-"}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-recipe-line-qty-${line.id}`}>
                          {qty.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-recipe-line-waste-${line.id}`}>
                          {parseFloat(line.wastePct).toFixed(2)}%
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground" data-testid={`text-recipe-line-unitcost-${line.id}`}>
                          ${unitCost.toFixed(4)}
                        </TableCell>
                        <TableCell className="text-right font-medium" data-testid={`text-recipe-line-linecost-${line.id}`}>
                          ${lineCost.toFixed(2)}
                        </TableCell>
                        {recipe.isActive && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-edit-recipe-line-${line.id}`}
                                onClick={() => onEditLine(line, idx)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-delete-recipe-line-${line.id}`}
                                onClick={() => onDeleteLine(line.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium" data-testid="text-total-cost-detail">
                Costo total estimado: ${totalCost.toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-recipe-lines">
            No hay ingredientes en esta receta.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
