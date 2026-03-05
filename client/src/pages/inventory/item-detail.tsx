import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useRoute, useLocation } from "wouter";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
} from "@/components/ui/form";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";

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
  unitWeightG: string | null;
  default_supplier_id: number | null;
  supplierName: string | null;
}

interface Supplier {
  id: number;
  name: string;
}

interface UomConversion {
  id: number;
  invItemId: number;
  fromUom: string;
  toBaseMultiplier: string;
  isDefaultPurchaseUom: boolean;
}

interface Movement {
  id: number;
  businessDate: string;
  movementType: string;
  qtyDeltaBase: string;
  unitCostPerBaseUom: string | null;
  valueDelta: string | null;
  referenceType: string | null;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
}

const MOVEMENT_LABELS: Record<string, string> = {
  RECEIPT: "Recepción",
  CONSUMPTION: "Consumo",
  REVERSAL: "Reversión",
  ADJUSTMENT: "Ajuste",
  MANUAL: "Manual",
};

const editSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  baseUom: z.string().min(1),
  reorderPointQtyBase: z.string(),
  parLevelQtyBase: z.string(),
  lastCostPerBaseUom: z.coerce.number().min(0),
  avgCostPerBaseUom: z.coerce.number().min(0),
  unitWeightG: z.coerce.number().min(0).optional(),
  isPerishable: z.boolean(),
  notes: z.string().optional(),
  defaultSupplierId: z.coerce.number().optional(),
});

const convSchema = z.object({
  fromUom: z.string().min(1, "UOM requerida"),
  toBaseMultiplier: z.string().min(1, "Multiplicador requerido"),
  isDefaultPurchaseUom: z.boolean().default(false),
});

export default function ItemDetail() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [matched, params] = useRoute("/inventory/items/:id");
  const id = params?.id;
  const [editOpen, setEditOpen] = useState(false);
  const [convOpen, setConvOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: item, isLoading } = useQuery<InvItem>({
    queryKey: ["/api/inv/items", id],
    enabled: !!id,
  });

  const { data: movements, isLoading: movLoading } = useQuery<Movement[]>({
    queryKey: ["/api/inv/items", id, "movements"],
    enabled: !!id,
  });

  const { data: conversions, isLoading: convLoading } = useQuery<UomConversion[]>({
    queryKey: ["/api/inv/items", id, "uom-conversions"],
    enabled: !!id,
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/inv/suppliers"],
  });

  const editForm = useForm({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: "",
      category: "",
      baseUom: "",
      reorderPointQtyBase: "0",
      parLevelQtyBase: "0",
      lastCostPerBaseUom: 0,
      avgCostPerBaseUom: 0,
      unitWeightG: undefined as number | undefined,
      isPerishable: false,
      notes: "",
      defaultSupplierId: undefined as number | undefined,
    },
  });

  const convForm = useForm({
    resolver: zodResolver(convSchema),
    defaultValues: {
      fromUom: "",
      toBaseMultiplier: "",
      isDefaultPurchaseUom: false,
    },
  });

  function openEdit() {
    if (item) {
      editForm.reset({
        name: item.name,
        category: item.category,
        baseUom: item.baseUom,
        reorderPointQtyBase: item.reorderPointQtyBase,
        parLevelQtyBase: item.parLevelQtyBase,
        lastCostPerBaseUom: parseFloat(item.lastCostPerBaseUom) || 0,
        avgCostPerBaseUom: parseFloat(item.avgCostPerBaseUom) || 0,
        unitWeightG: item.unitWeightG ? parseFloat(item.unitWeightG) : undefined,
        isPerishable: item.isPerishable,
        notes: item.notes || "",
        defaultSupplierId: item.default_supplier_id || undefined,
      });
    }
    setEditOpen(true);
  }

  const editWatchBaseUom = editForm.watch("baseUom");
  const editWatchUnitWeightG = editForm.watch("unitWeightG");

  const updateMutation = useMutation({
    mutationFn: async (data: z.infer<typeof editSchema>) => {
      await apiRequest("PATCH", `/api/inv/items/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: "Insumo actualizado" });
      setEditOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addConvMutation = useMutation({
    mutationFn: async (data: z.infer<typeof convSchema>) => {
      await apiRequest("POST", `/api/inv/items/${id}/uom-conversions`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items", id, "uom-conversions"] });
      toast({ title: "Conversión agregada" });
      setConvOpen(false);
      convForm.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteConvMutation = useMutation({
    mutationFn: async (convId: number) => {
      await apiRequest("DELETE", `/api/inv/uom-conversions/${convId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items", id, "uom-conversions"] });
      toast({ title: "Conversión eliminada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/inv/items/${id}`);
      return res.json();
    },
    onSuccess: (data: { hardDeleted: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({
        title: data.hardDeleted
          ? "Insumo eliminado permanentemente"
          : "Insumo desactivado",
        description: data.hardDeleted
          ? "El insumo fue eliminado de la base de datos."
          : "El insumo tiene registros relacionados y fue desactivado.",
      });
      navigate("/inventory/items");
    },
    onError: (err: Error) => {
      toast({ title: "Error al eliminar", description: err.message, variant: "destructive" });
    },
  });

  if (!matched) return null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="admin-page">
        <p className="text-muted-foreground" data-testid="text-not-found">Insumo no encontrado</p>
      </div>
    );
  }

  const qty = parseFloat(item.onHandQtyBase);
  const reorder = parseFloat(item.reorderPointQtyBase);

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <Button variant="ghost" size="icon" onClick={() => navigate("/inventory/items")} data-testid="button-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="admin-page-title flex-1" data-testid="text-item-name">{item.name}</h1>
        <Button variant="outline" onClick={openEdit} data-testid="button-edit-item">
          <Pencil className="h-4 w-4 mr-2" />
          Editar
        </Button>
        <Button variant="ghost" onClick={() => setDeleteOpen(true)} data-testid="button-delete-item">
          <Trash2 className="h-4 w-4 mr-2" />
          Eliminar
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">SKU</span>
              <p className="font-mono font-medium" data-testid="text-sku">{item.sku}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Categoría</span>
              <p data-testid="text-category">{item.category}</p>
            </div>
            <div>
              <span className="text-muted-foreground">UOM Base</span>
              <p data-testid="text-uom">{item.baseUom}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Proveedor</span>
              <p data-testid="text-supplier">{item.supplierName || "—"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Perecedero</span>
              <p data-testid="text-perishable">{item.isPerishable ? "Sí" : "No"}</p>
            </div>
            <div>
              <span className="text-muted-foreground">En Mano</span>
              <div className="flex items-center gap-2">
                <span className="font-medium" data-testid="text-on-hand">{qty.toFixed(2)}</span>
                {qty <= 0 ? (
                  <Badge variant="destructive" data-testid="badge-stock">Sin stock</Badge>
                ) : qty <= reorder ? (
                  <Badge className="text-white" style={{ background: 'var(--amber)' }} data-testid="badge-stock">Bajo</Badge>
                ) : (
                  <Badge className="text-white" style={{ background: 'var(--sage)' }} data-testid="badge-stock">OK</Badge>
                )}
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Punto Reorden</span>
              <p data-testid="text-reorder">{reorder.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Costo Prom. (WAC)</span>
              <p data-testid="text-wac">{parseFloat(item.avgCostPerBaseUom).toFixed(4)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Último Costo</span>
              <p data-testid="text-last-cost">{parseFloat(item.lastCostPerBaseUom).toFixed(4)}</p>
            </div>
            {item.baseUom === "UNIT" && (
              <div>
                <span className="text-muted-foreground">Peso/unidad (g)</span>
                <p data-testid="text-unit-weight">{item.unitWeightG ? parseFloat(item.unitWeightG).toFixed(2) : "—"}</p>
              </div>
            )}
          </div>
          {item.notes && (
            <div className="mt-3 text-sm">
              <span className="text-muted-foreground">Notas: </span>
              <span data-testid="text-notes">{item.notes}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="kardex">
        <TabsList data-testid="tabs-list">
          <TabsTrigger value="kardex" data-testid="tab-kardex">Kardex</TabsTrigger>
          <TabsTrigger value="conversions" data-testid="tab-conversions">Conversiones UOM</TabsTrigger>
        </TabsList>

        <TabsContent value="kardex" className="mt-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-base">Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              {movLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="table-movements">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Costo Unit.</TableHead>
                        <TableHead>Referencia</TableHead>
                        <TableHead>Nota</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {movements && movements.length > 0 ? (
                        movements.map((mov) => (
                          <TableRow key={mov.id} data-testid={`row-movement-${mov.id}`}>
                            <TableCell className="text-sm">{mov.businessDate}</TableCell>
                            <TableCell>
                              <Badge variant="secondary" data-testid={`badge-type-${mov.id}`}>
                                {MOVEMENT_LABELS[mov.movementType] || mov.movementType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-mono" style={{ color: parseFloat(mov.qtyDeltaBase) >= 0 ? 'var(--sage)' : 'var(--red)' }}>
                              {parseFloat(mov.qtyDeltaBase) >= 0 ? "+" : ""}{parseFloat(mov.qtyDeltaBase).toFixed(2)}
                            </TableCell>
                            <TableCell className="text-right">
                              {mov.unitCostPerBaseUom ? parseFloat(mov.unitCostPerBaseUom).toFixed(4) : "-"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {mov.referenceType ? `${mov.referenceType} #${mov.referenceId}` : "-"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                              {mov.note || "-"}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            Sin movimientos
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conversions" className="mt-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <CardTitle className="text-base">Conversiones de Unidad</CardTitle>
              <Button onClick={() => { convForm.reset(); setConvOpen(true); }} data-testid="button-add-conversion">
                <Plus className="h-4 w-4 mr-2" />
                Agregar
              </Button>
            </CardHeader>
            <CardContent>
              {convLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table data-testid="table-conversions">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Desde UOM</TableHead>
                      <TableHead className="text-right">Multiplicador</TableHead>
                      <TableHead className="text-center">UOM Compra</TableHead>
                      <TableHead className="text-center">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conversions && conversions.length > 0 ? (
                      conversions.map((conv) => (
                        <TableRow key={conv.id} data-testid={`row-conversion-${conv.id}`}>
                          <TableCell>{conv.fromUom}</TableCell>
                          <TableCell className="text-right font-mono">{parseFloat(conv.toBaseMultiplier).toFixed(4)}</TableCell>
                          <TableCell className="text-center">
                            {conv.isDefaultPurchaseUom && <Badge variant="secondary">Sí</Badge>}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteConvMutation.mutate(conv.id)}
                              disabled={deleteConvMutation.isPending}
                              data-testid={`button-delete-conv-${conv.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          Sin conversiones
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-edit-title">Editar Insumo</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((data) => updateMutation.mutate(data))} className="space-y-3">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl><Input {...field} data-testid="input-edit-name" /></FormControl>
                </FormItem>
              )} />
              <FormField control={editForm.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <FormControl><Input {...field} data-testid="input-edit-category" /></FormControl>
                </FormItem>
              )} />
              <FormField control={editForm.control} name="baseUom" render={({ field }) => (
                <FormItem>
                  <FormLabel>UOM Base</FormLabel>
                  <FormControl><Input {...field} data-testid="input-edit-uom" /></FormControl>
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="reorderPointQtyBase" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Punto Reorden</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-edit-reorder" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="parLevelQtyBase" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nivel Par</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-edit-par" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="lastCostPerBaseUom" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Último Costo (₡/base)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))} data-testid="input-edit-last-cost" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Se usa en conversiones AP→EP</p>
                  </FormItem>
                )} />
                <FormField control={editForm.control} name="avgCostPerBaseUom" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Costo Promedio (₡/base)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))} data-testid="input-edit-avg-cost" />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">Promedio ponderado (WAC)</p>
                  </FormItem>
                )} />
              </div>
              {editWatchBaseUom === "UNIT" && (
                <>
                  <FormField control={editForm.control} name="unitWeightG" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Peso por unidad (g)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} data-testid="input-edit-unit-weight" />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">Necesario para conversiones UNIT→G</p>
                    </FormItem>
                  )} />
                  {(!editWatchUnitWeightG || editWatchUnitWeightG <= 0) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-edit-unit-weight-warning">
                      ⚠ Sin peso por unidad, las conversiones UNIT→G no podrán calcular costos
                    </p>
                  )}
                </>
              )}
              <FormField control={editForm.control} name="isPerishable" render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-edit-perishable" />
                  </FormControl>
                  <FormLabel className="!mt-0">Perecedero</FormLabel>
                </FormItem>
              )} />
              <FormField control={editForm.control} name="defaultSupplierId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor</FormLabel>
                  <Select value={field.value ? String(field.value) : "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : Number(v))}>
                    <FormControl>
                      <SelectTrigger data-testid="select-edit-supplier">
                        <SelectValue placeholder="Sin proveedor" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Sin proveedor</SelectItem>
                      {(suppliers || []).map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={editForm.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl><Textarea {...field} data-testid="input-edit-notes" /></FormControl>
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)} data-testid="button-cancel-edit">
                  Cancelar
                </Button>
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-save-edit">
                  {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Guardar
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-dialog-title">
              Eliminar {item.name}
            </AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-dialog-description">
              Si el insumo tiene registros relacionados (movimientos, conversiones, recetas, etc.) se desactivará en lugar de eliminarse permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItemMutation.mutate()}
              disabled={deleteItemMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteItemMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={convOpen} onOpenChange={setConvOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle data-testid="text-conv-title">Nueva Conversión</DialogTitle>
          </DialogHeader>
          <Form {...convForm}>
            <form onSubmit={convForm.handleSubmit((data) => addConvMutation.mutate(data))} className="space-y-3">
              <FormField control={convForm.control} name="fromUom" render={({ field }) => (
                <FormItem>
                  <FormLabel>Desde UOM</FormLabel>
                  <FormControl><Input {...field} placeholder="ej: CAJA" data-testid="input-conv-uom" /></FormControl>
                </FormItem>
              )} />
              <FormField control={convForm.control} name="toBaseMultiplier" render={({ field }) => (
                <FormItem>
                  <FormLabel>Multiplicador a Base</FormLabel>
                  <FormControl><Input type="number" step="0.0001" {...field} placeholder="ej: 12" data-testid="input-conv-multiplier" /></FormControl>
                </FormItem>
              )} />
              <FormField control={convForm.control} name="isDefaultPurchaseUom" render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-conv-default" />
                  </FormControl>
                  <FormLabel className="!mt-0">UOM de compra por defecto</FormLabel>
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setConvOpen(false)} data-testid="button-cancel-conv">
                  Cancelar
                </Button>
                <Button type="submit" disabled={addConvMutation.isPending} data-testid="button-save-conv">
                  {addConvMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Agregar
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
