import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Search, Upload } from "lucide-react";

interface InvItem {
  id: number;
  sku: string;
  name: string;
  category: string;
  baseUom: string;
  onHandQtyBase: string;
  reorderPointQtyBase: string;
  parLevelQtyBase: string;
  isActive: boolean;
  isPerishable: boolean;
  notes: string | null;
  avgCostPerBaseUom: string;
  lastCostPerBaseUom: string;
}

const formSchema = z.object({
  sku: z.string().min(1, "SKU requerido"),
  name: z.string().min(1, "Nombre requerido"),
  category: z.string().min(1, "Categoría requerida"),
  baseUom: z.string().min(1, "UOM requerida"),
  reorderPointQtyBase: z.string().default("0"),
  parLevelQtyBase: z.string().default("0"),
  isPerishable: z.boolean().default(false),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function stockBadge(onHand: string, reorderPoint: string) {
  const qty = parseFloat(onHand);
  const reorder = parseFloat(reorderPoint);
  if (qty <= 0) return <Badge variant="destructive" data-testid="badge-stock-red">Sin stock</Badge>;
  if (qty <= reorder) return <Badge className="bg-yellow-500 text-white" data-testid="badge-stock-yellow">Bajo</Badge>;
  return <Badge className="bg-green-600 text-white" data-testid="badge-stock-green">OK</Badge>;
}

function parseImportText(text: string) {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length === 0) return [];

  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes("sku") || firstLine.includes("nombre") || firstLine.includes("name");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map(line => {
    const parts = line.split("\t").length > 1 ? line.split("\t") : line.split(",");
    return {
      sku: (parts[0] || "").trim(),
      name: (parts[1] || "").trim(),
      category: (parts[2] || "General").trim(),
      baseUom: (parts[3] || "UNIT").trim(),
      reorderPointQtyBase: (parts[4] || "0").trim(),
      parLevelQtyBase: (parts[5] || "0").trim(),
      isPerishable: (parts[6] || "").trim().toLowerCase() === "true" || (parts[6] || "").trim() === "1",
    };
  }).filter(item => item.sku && item.name);
}

export default function InventoryItems() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importResults, setImportResults] = useState<{created: number; skipped: number; errors: string[]} | null>(null);

  const { data: items, isLoading } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sku: "",
      name: "",
      category: "General",
      baseUom: "UNIT",
      reorderPointQtyBase: "0",
      parLevelQtyBase: "0",
      isPerishable: false,
      notes: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      await apiRequest("POST", "/api/inv/items", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: "Insumo creado" });
      setDialogOpen(false);
      form.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (importItems: any[]) => {
      const res = await apiRequest("POST", "/api/inv/items/bulk-import", { items: importItems });
      return res.json();
    },
    onSuccess: (data: any) => {
      setImportResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: `Importación completada: ${data.created} creados, ${data.skipped} omitidos` });
    },
    onError: (err: Error) => {
      toast({ title: "Error en importación", description: err.message, variant: "destructive" });
    },
  });

  const categories = useMemo(() => {
    if (!items) return [];
    const set = new Set(items.map((i) => i.category));
    return Array.from(set).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    let list = items;
    if (categoryFilter !== "__all__") {
      list = list.filter((i) => i.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
      );
    }
    return list;
  }, [items, search, categoryFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 flex-wrap">
          <CardTitle className="text-lg" data-testid="text-page-title">Insumos</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => { setImportOpen(true); setImportText(""); setImportPreview([]); setImportResults(null); }} data-testid="button-import-items">
              <Upload className="h-4 w-4 mr-2" />
              Importar
            </Button>
            <Button onClick={() => setDialogOpen(true)} data-testid="button-create-item">
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Insumo
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                data-testid="input-search"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]" data-testid="select-category-filter">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas las categorías</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden md:block overflow-x-auto">
            <Table data-testid="table-items">
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead className="text-right">En Mano</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/inventory/items/${item.id}`)}
                    data-testid={`row-item-${item.id}`}
                  >
                    <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.category}</TableCell>
                    <TableCell>{item.baseUom}</TableCell>
                    <TableCell className="text-right">{parseFloat(item.onHandQtyBase).toFixed(2)}</TableCell>
                    <TableCell className="text-center">
                      {stockBadge(item.onHandQtyBase, item.reorderPointQtyBase)}
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No se encontraron insumos
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-2">
            {filtered.map((item) => (
              <Card
                key={item.id}
                className="cursor-pointer hover-elevate"
                onClick={() => navigate(`/inventory/items/${item.id}`)}
                data-testid={`card-item-${item.id}`}
              >
                <CardContent className="p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">{item.name}</span>
                    {stockBadge(item.onHandQtyBase, item.reorderPointQtyBase)}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{item.sku} · {item.category}</span>
                    <span>{parseFloat(item.onHandQtyBase).toFixed(2)} {item.baseUom}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-8" data-testid="text-empty">
                No se encontraron insumos
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">Nuevo Insumo</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-3">
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-sku" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-name" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Categoría</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-category" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="baseUom"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidad Base (UOM)</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-base-uom" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="reorderPointQtyBase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Punto Reorden</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-reorder-point" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="parLevelQtyBase"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nivel Par</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} data-testid="input-par-level" />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="isPerishable"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-perishable" />
                    </FormControl>
                    <FormLabel className="!mt-0">Perecedero</FormLabel>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notas</FormLabel>
                    <FormControl>
                      <Textarea {...field} data-testid="input-notes" />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-save">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Guardar
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-import-dialog-title">Importar Insumos</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-import-instructions">
              Pegue datos separados por tabulador o coma. Columnas: SKU, Nombre, Categoría, UOM, Punto Reorden, Nivel Par, Perecedero (true/false)
            </p>
            <Textarea
              placeholder={"SKU\tNombre\tCategoría\tUOM\tReorden\tParLevel\tPerecederol\nINS-001\tLeche Entera\tLácteos\tLT\t10\t20\tfalse"}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              data-testid="textarea-import-data"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => {
                  const parsed = parseImportText(importText);
                  setImportPreview(parsed);
                  setImportResults(null);
                  if (parsed.length === 0) {
                    toast({ title: "No se encontraron items válidos", variant: "destructive" });
                  }
                }}
                disabled={!importText.trim()}
                data-testid="button-analyze-import"
              >
                Analizar
              </Button>
              {importPreview.length > 0 && (
                <Button
                  onClick={() => importMutation.mutate(importPreview)}
                  disabled={importMutation.isPending}
                  data-testid="button-execute-import"
                >
                  {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Importar {importPreview.length} items
                </Button>
              )}
            </div>

            {importPreview.length > 0 && !importResults && (
              <div className="overflow-x-auto">
                <Table data-testid="table-import-preview">
                  <TableHeader>
                    <TableRow>
                      <TableHead>SKU</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Categoría</TableHead>
                      <TableHead>UOM</TableHead>
                      <TableHead>Reorden</TableHead>
                      <TableHead>Par</TableHead>
                      <TableHead>Perec.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.map((item, idx) => (
                      <TableRow key={idx} data-testid={`row-import-preview-${idx}`}>
                        <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                        <TableCell>{item.name}</TableCell>
                        <TableCell>{item.category}</TableCell>
                        <TableCell>{item.baseUom}</TableCell>
                        <TableCell>{item.reorderPointQtyBase}</TableCell>
                        <TableCell>{item.parLevelQtyBase}</TableCell>
                        <TableCell>{item.isPerishable ? "Si" : "No"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {importResults && (
              <Card data-testid="card-import-results">
                <CardContent className="p-4 space-y-2">
                  <p className="font-medium" data-testid="text-import-results-summary">
                    Creados: {importResults.created} | Omitidos: {importResults.skipped}
                  </p>
                  {importResults.errors.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-destructive">Errores:</p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {importResults.errors.map((err, idx) => (
                          <li key={idx} data-testid={`text-import-error-${idx}`}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
