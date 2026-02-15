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
import { Loader2, Plus, ChevronDown, ChevronRight } from "lucide-react";

interface PhysicalCount {
  id: number;
  status: string;
  scope: string;
  categoryFilter: string | null;
  createdByEmployeeId: number;
  finalizedByEmployeeId: number | null;
  createdAt: string;
  finalizedAt: string | null;
  note: string | null;
  createdByName?: string;
}

interface CountLine {
  id: number;
  physicalCountId: number;
  invItemId: number;
  systemQtyBase: string;
  countedQtyBase: string | null;
  deltaQtyBase: string | null;
  adjustmentReason: string | null;
  itemName?: string;
  itemBaseUom?: string;
}

interface InvItem {
  id: number;
  name: string;
  category: string;
  baseUom: string;
}

export default function PhysicalCountsPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [scope, setScope] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [finalizeId, setFinalizeId] = useState<number | null>(null);

  const { data: counts, isLoading } = useQuery<PhysicalCount[]>({
    queryKey: ["/api/inv/physical-counts"],
  });

  const { data: items } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const categories = Array.from(new Set((items || []).map((i) => i.category))).sort();

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/inv/physical-counts", {
        scope,
        categoryFilter: scope === "CATEGORY" ? categoryFilter : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/physical-counts"] });
      toast({ title: "Conteo creado" });
      setCreateOpen(false);
      setScope("ALL");
      setCategoryFilter("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/inv/physical-counts/${id}/finalize`);
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/physical-counts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/physical-counts", id] });
      toast({ title: "Conteo finalizado" });
      setFinalizeId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setFinalizeId(null);
    },
  });

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-bold" data-testid="text-physical-counts-title">
          Conteos Físicos
        </h1>
        <Button data-testid="button-new-count" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Conteo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8" data-testid="loading-counts">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : counts && counts.length > 0 ? (
        <div className="space-y-2">
          {counts.map((c) => (
            <Card key={c.id} data-testid={`card-count-${c.id}`}>
              <CardHeader
                className="flex flex-row items-center justify-between gap-2 cursor-pointer py-3"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                data-testid={`button-expand-count-${c.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {expandedId === c.id ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  <span className="font-semibold">#{c.id}</span>
                  <Badge
                    variant={c.status === "FINALIZED" ? "default" : "secondary"}
                    className={
                      c.status === "FINALIZED"
                        ? "bg-green-600 text-white"
                        : "bg-yellow-500 text-black"
                    }
                    data-testid={`badge-count-status-${c.id}`}
                  >
                    {c.status}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {c.scope === "CATEGORY" ? `Categoría: ${c.categoryFilter}` : "Todos"}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-muted-foreground" data-testid={`text-count-date-${c.id}`}>
                    {new Date(c.createdAt).toLocaleDateString("es-CR")}
                  </span>
                  {c.status === "DRAFT" && (
                    <Button
                      variant="outline"
                      data-testid={`button-finalize-count-${c.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setFinalizeId(c.id);
                      }}
                    >
                      Finalizar
                    </Button>
                  )}
                </div>
              </CardHeader>
              {expandedId === c.id && (
                <CardContent>
                  <CountDetail
                    countId={c.id}
                    isFinalized={c.status === "FINALIZED"}
                  />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="text-no-counts">
          No hay conteos físicos registrados.
        </p>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="dialog-new-count">
          <DialogHeader>
            <DialogTitle>Nuevo Conteo Físico</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Alcance</Label>
              <Select value={scope} onValueChange={setScope} data-testid="select-scope">
                <SelectTrigger data-testid="select-scope-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL" data-testid="select-scope-all">Todos los ítems</SelectItem>
                  <SelectItem value="CATEGORY" data-testid="select-scope-category">Por categoría</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "CATEGORY" && (
              <div className="space-y-1">
                <Label>Categoría</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter} data-testid="select-category-filter">
                  <SelectTrigger data-testid="select-category-filter-trigger">
                    <SelectValue placeholder="Seleccionar categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat} data-testid={`select-category-${cat}`}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              data-testid="button-submit-new-count"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || (scope === "CATEGORY" && !categoryFilter)}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={finalizeId !== null} onOpenChange={() => setFinalizeId(null)}>
        <AlertDialogContent data-testid="dialog-confirm-finalize">
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar Conteo</AlertDialogTitle>
            <AlertDialogDescription>
              Al finalizar se ajustará el inventario con las diferencias encontradas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-finalize">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-finalize"
              onClick={() => finalizeId && finalizeMutation.mutate(finalizeId)}
              disabled={finalizeMutation.isPending}
            >
              {finalizeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CountDetail({ countId, isFinalized }: { countId: number; isFinalized: boolean }) {
  const { toast } = useToast();

  const { data: countData, isLoading } = useQuery<{ lines: CountLine[] }>({
    queryKey: ["/api/inv/physical-counts", countId],
  });

  const updateLineMutation = useMutation({
    mutationFn: async ({
      lineId,
      countedQtyBase,
      adjustmentReason,
    }: {
      lineId: number;
      countedQtyBase: string;
      adjustmentReason: string;
    }) => {
      await apiRequest("PATCH", `/api/inv/physical-count-lines/${lineId}`, {
        countedQtyBase,
        adjustmentReason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/physical-counts", countId] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-4" data-testid="loading-count-detail">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const lines = countData?.lines || (Array.isArray(countData) ? countData : []);

  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="text-no-lines">
        No hay líneas en este conteo.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ítem</TableHead>
            <TableHead>UOM</TableHead>
            <TableHead className="text-right">Qty Sistema</TableHead>
            <TableHead className="text-right">Qty Contada</TableHead>
            <TableHead className="text-right">Delta</TableHead>
            <TableHead>Razón Ajuste</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const systemQty = parseFloat(line.systemQtyBase);
            const countedQty = line.countedQtyBase != null ? parseFloat(line.countedQtyBase) : null;
            const delta = countedQty != null ? countedQty - systemQty : null;

            return (
              <TableRow key={line.id} data-testid={`row-count-line-${line.id}`}>
                <TableCell data-testid={`text-line-item-${line.id}`}>
                  {line.itemName || `Ítem #${line.invItemId}`}
                </TableCell>
                <TableCell data-testid={`text-line-uom-${line.id}`}>
                  {line.itemBaseUom || "-"}
                </TableCell>
                <TableCell className="text-right" data-testid={`text-line-system-qty-${line.id}`}>
                  {systemQty.toFixed(2)}
                </TableCell>
                <TableCell className="text-right">
                  {isFinalized ? (
                    <span data-testid={`text-line-counted-qty-${line.id}`}>
                      {countedQty != null ? countedQty.toFixed(2) : "-"}
                    </span>
                  ) : (
                    <Input
                      data-testid={`input-counted-qty-${line.id}`}
                      type="number"
                      step="0.01"
                      className="w-24 text-right"
                      defaultValue={line.countedQtyBase ?? ""}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val !== (line.countedQtyBase ?? "")) {
                          updateLineMutation.mutate({
                            lineId: line.id,
                            countedQtyBase: val,
                            adjustmentReason: line.adjustmentReason || "",
                          });
                        }
                      }}
                    />
                  )}
                </TableCell>
                <TableCell
                  className={`text-right font-semibold ${
                    delta != null
                      ? delta < 0
                        ? "text-red-600"
                        : delta > 0
                          ? "text-green-600"
                          : ""
                      : ""
                  }`}
                  data-testid={`text-line-delta-${line.id}`}
                >
                  {delta != null ? (delta > 0 ? "+" : "") + delta.toFixed(2) : "-"}
                </TableCell>
                <TableCell>
                  {isFinalized ? (
                    <span data-testid={`text-line-reason-${line.id}`}>
                      {line.adjustmentReason || "-"}
                    </span>
                  ) : (
                    <Input
                      data-testid={`input-reason-${line.id}`}
                      placeholder="Razón..."
                      className="w-40"
                      defaultValue={line.adjustmentReason || ""}
                      onBlur={(e) => {
                        const val = e.target.value;
                        if (val !== (line.adjustmentReason || "")) {
                          updateLineMutation.mutate({
                            lineId: line.id,
                            countedQtyBase: line.countedQtyBase || "0",
                            adjustmentReason: val,
                          });
                        }
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
