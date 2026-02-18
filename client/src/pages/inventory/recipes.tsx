import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { Loader2, Plus, Trash2, Pencil, Search } from "lucide-react";

interface Product {
  id: number;
  name: string;
  productCode: string;
  inventoryControlEnabled: boolean;
}

interface InvItem {
  id: number;
  sku: string;
  name: string;
  baseUom: string;
}

interface Recipe {
  id: number;
  menuProductId: number;
  version: number;
  isActive: boolean;
  yieldQty: string;
  note: string | null;
  createdAt: string;
}

interface RecipeLine {
  id: number;
  recipeId: number;
  invItemId: number;
  qtyBasePerMenuUnit: string;
  wastePct: string;
  itemName?: string;
  itemBaseUom?: string;
}

export default function RecipesPage() {
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [newRecipeOpen, setNewRecipeOpen] = useState(false);
  const [newYieldQty, setNewYieldQty] = useState("1");
  const [expandedRecipeId, setExpandedRecipeId] = useState<number | null>(null);
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [editLine, setEditLine] = useState<RecipeLine | null>(null);
  const [lineForm, setLineForm] = useState({ invItemId: "", qtyBasePerMenuUnit: "", wastePct: "0" });

  const { data: products, isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["/api/inv/products"],
  });

  const { data: invItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const { data: recipes, isLoading: recipesLoading } = useQuery<Recipe[]>({
    queryKey: ["/api/inv/recipes/product", selectedProductId],
    enabled: selectedProductId !== null,
  });

  const filteredProducts = (products || []).filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.productCode.toLowerCase().includes(productSearch.toLowerCase())
  );

  const selectedProduct = (products || []).find((p) => p.id === selectedProductId);

  const createRecipeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/inv/recipes", {
        menuProductId: selectedProductId,
        yieldQty: newYieldQty,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes/product", selectedProductId] });
      toast({ title: "Receta creada" });
      setNewRecipeOpen(false);
      setNewYieldQty("1");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ recipeId, isActive }: { recipeId: number; isActive: boolean }) => {
      await apiRequest("PATCH", `/api/inv/recipes/${recipeId}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes/product", selectedProductId] });
      toast({ title: "Receta actualizada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleInventoryControl = useMutation({
    mutationFn: async ({ productId, enabled }: { productId: number; enabled: boolean }) => {
      await apiRequest("PATCH", `/api/inv/products/${productId}/inventory-control`, {
        enabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/products"] });
      toast({ title: "Control de inventario actualizado" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/inv/recipe-lines", {
        recipeId: expandedRecipeId,
        invItemId: parseInt(lineForm.invItemId),
        qtyBasePerMenuUnit: lineForm.qtyBasePerMenuUnit,
        wastePct: lineForm.wastePct,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes", expandedRecipeId, "lines"] });
      toast({ title: "Línea agregada" });
      setAddLineOpen(false);
      setLineForm({ invItemId: "", qtyBasePerMenuUnit: "", wastePct: "0" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const editLineMutation = useMutation({
    mutationFn: async () => {
      if (!editLine) return;
      await apiRequest("PATCH", `/api/inv/recipe-lines/${editLine.id}`, {
        qtyBasePerMenuUnit: lineForm.qtyBasePerMenuUnit,
        wastePct: lineForm.wastePct,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes", expandedRecipeId, "lines"] });
      toast({ title: "Línea actualizada" });
      setEditLine(null);
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
      queryClient.invalidateQueries({ queryKey: ["/api/inv/recipes", expandedRecipeId, "lines"] });
      toast({ title: "Línea eliminada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold" data-testid="text-recipes-title">Recetas / BOM</h1>

      <Card>
        <CardHeader>
          <CardTitle>Seleccionar Producto</CardTitle>
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
            <div className="max-h-48 overflow-y-auto space-y-1">
              {filteredProducts.slice(0, 20).map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center justify-between gap-2 p-2 rounded-md cursor-pointer hover-elevate ${
                    selectedProductId === p.id ? "bg-accent" : ""
                  }`}
                  onClick={() => {
                    setSelectedProductId(p.id);
                    setExpandedRecipeId(null);
                  }}
                  data-testid={`button-select-product-${p.id}`}
                >
                  <span>{p.name} <span className="text-muted-foreground text-sm">({p.productCode})</span></span>
                  {p.inventoryControlEnabled && (
                    <Badge className="bg-green-600 text-white" data-testid={`badge-inv-control-${p.id}`}>
                      Inv
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedProduct && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
            <CardTitle>
              Recetas: {selectedProduct.name}
            </CardTitle>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Label htmlFor="inv-control-toggle" className="text-sm">Control Inv.</Label>
                <Switch
                  id="inv-control-toggle"
                  data-testid="switch-inventory-control"
                  checked={selectedProduct.inventoryControlEnabled}
                  onCheckedChange={(checked) =>
                    toggleInventoryControl.mutate({
                      productId: selectedProduct.id,
                      enabled: checked,
                    })
                  }
                />
              </div>
              <Button
                data-testid="button-new-recipe"
                onClick={() => setNewRecipeOpen(true)}
              >
                <Plus className="mr-2 h-4 w-4" />
                Nueva Receta
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recipesLoading ? (
              <div className="flex justify-center p-4" data-testid="loading-recipes">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : recipes && recipes.length > 0 ? (
              <div className="space-y-3">
                {recipes.map((r) => (
                  <Card key={r.id} data-testid={`card-recipe-${r.id}`}>
                    <CardHeader
                      className="flex flex-row items-center justify-between gap-2 py-3 cursor-pointer"
                      onClick={() => setExpandedRecipeId(expandedRecipeId === r.id ? null : r.id)}
                      data-testid={`button-expand-recipe-${r.id}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">v{r.version}</span>
                        <Badge
                          variant={r.isActive ? "default" : "secondary"}
                          className={r.isActive ? "bg-green-600 text-white" : ""}
                          data-testid={`badge-recipe-status-${r.id}`}
                        >
                          {r.isActive ? "Activa" : "Inactiva"}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          Rendimiento: {r.yieldQty}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          data-testid={`switch-recipe-active-${r.id}`}
                          checked={r.isActive}
                          onCheckedChange={(checked) =>
                            toggleActiveMutation.mutate({ recipeId: r.id, isActive: checked })
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    </CardHeader>
                    {expandedRecipeId === r.id && (
                      <CardContent>
                        <RecipeLines
                          recipeId={r.id}
                          invItems={invItems || []}
                          onAddLine={() => {
                            setLineForm({ invItemId: "", qtyBasePerMenuUnit: "", wastePct: "0" });
                            setAddLineOpen(true);
                          }}
                          onEditLine={(line) => {
                            setEditLine(line);
                            setLineForm({
                              invItemId: String(line.invItemId),
                              qtyBasePerMenuUnit: line.qtyBasePerMenuUnit,
                              wastePct: line.wastePct,
                            });
                          }}
                          onDeleteLine={(lineId) => deleteLineMutation.mutate(lineId)}
                        />
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" data-testid="text-no-recipes">
                No hay recetas para este producto.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={newRecipeOpen} onOpenChange={setNewRecipeOpen}>
        <DialogContent data-testid="dialog-new-recipe">
          <DialogHeader>
            <DialogTitle>Nueva Receta</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Producto: <strong>{selectedProduct?.name}</strong>
            </p>
            <div className="space-y-1">
              <Label htmlFor="yield-qty">Rendimiento (unidades menú)</Label>
              <Input
                id="yield-qty"
                data-testid="input-yield-qty"
                type="number"
                step="0.01"
                value={newYieldQty}
                onChange={(e) => setNewYieldQty(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              data-testid="button-submit-new-recipe"
              onClick={() => createRecipeMutation.mutate()}
              disabled={createRecipeMutation.isPending}
            >
              {createRecipeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addLineOpen || editLine !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddLineOpen(false);
            setEditLine(null);
          }
        }}
      >
        <DialogContent data-testid="dialog-recipe-line">
          <DialogHeader>
            <DialogTitle>{editLine ? "Editar Línea" : "Agregar Línea"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!editLine && (
              <div className="space-y-1">
                <Label>Ítem de Inventario</Label>
                <Select
                  value={lineForm.invItemId}
                  onValueChange={(v) => setLineForm({ ...lineForm, invItemId: v })}
                >
                  <SelectTrigger data-testid="select-inv-item-trigger">
                    <SelectValue placeholder="Seleccionar ítem" />
                  </SelectTrigger>
                  <SelectContent>
                    {(invItems || []).map((item) => (
                      <SelectItem key={item.id} value={String(item.id)} data-testid={`select-inv-item-${item.id}`}>
                        {item.name} ({item.baseUom})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
          <DialogFooter>
            <Button
              data-testid="button-submit-recipe-line"
              onClick={() => (editLine ? editLineMutation.mutate() : addLineMutation.mutate())}
              disabled={addLineMutation.isPending || editLineMutation.isPending}
            >
              {(addLineMutation.isPending || editLineMutation.isPending) && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {editLine ? "Guardar" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RecipeLines({
  recipeId,
  invItems,
  onAddLine,
  onEditLine,
  onDeleteLine,
}: {
  recipeId: number;
  invItems: InvItem[];
  onAddLine: () => void;
  onEditLine: (line: RecipeLine) => void;
  onDeleteLine: (lineId: number) => void;
}) {
  const { data: lines, isLoading } = useQuery<RecipeLine[]>({
    queryKey: ["/api/inv/recipes", recipeId, "lines"],
  });

  const itemMap = new Map(invItems.map((i) => [i.id, i]));

  if (isLoading) {
    return (
      <div className="flex justify-center p-4" data-testid="loading-recipe-lines">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" data-testid="button-add-recipe-line" onClick={onAddLine}>
          <Plus className="mr-2 h-4 w-4" />
          Agregar Línea
        </Button>
      </div>
      {lines && lines.length > 0 ? (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ítem</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Qty / Unidad</TableHead>
                <TableHead className="text-right">% Desperdicio</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => {
                const item = itemMap.get(line.invItemId);
                return (
                  <TableRow key={line.id} data-testid={`row-recipe-line-${line.id}`}>
                    <TableCell data-testid={`text-recipe-line-item-${line.id}`}>
                      {line.itemName || item?.name || `Ítem #${line.invItemId}`}
                    </TableCell>
                    <TableCell data-testid={`text-recipe-line-uom-${line.id}`}>
                      {line.itemBaseUom || item?.baseUom || "-"}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-recipe-line-qty-${line.id}`}>
                      {parseFloat(line.qtyBasePerMenuUnit).toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-recipe-line-waste-${line.id}`}>
                      {parseFloat(line.wastePct).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          data-testid={`button-edit-recipe-line-${line.id}`}
                          onClick={() => onEditLine(line)}
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
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="text-no-recipe-lines">
          No hay ingredientes en esta receta.
        </p>
      )}
    </div>
  );
}
