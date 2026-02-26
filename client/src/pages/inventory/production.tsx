import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Factory, ArrowRight } from "lucide-react";

type BatchOutput = {
  id: number;
  batchId: number;
  epItemId: number;
  qtyEpGenerated: string;
  epItemName: string;
};

type Batch = {
  id: number;
  conversionId: number;
  apItemId: number;
  apQtyUsed: string;
  status: string;
  createdByUserId: number | null;
  createdAt: string;
  conversionName: string;
  apItemName: string;
  outputs: BatchOutput[];
};

type ConvOutput = {
  epItemId: number;
  outputPct: string;
  epItemName?: string;
};

type Conversion = {
  id: number;
  apItemId: number;
  name: string;
  mermaPct: string;
  cookFactor: string;
  extraLossPct: string;
  isActive: boolean;
  apItemName: string;
  outputs: ConvOutput[];
};

export default function ProductionPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedConversionId, setSelectedConversionId] = useState<string>("");
  const [apQtyUsed, setApQtyUsed] = useState("");

  const { data: batches, isLoading: batchesLoading } = useQuery<Batch[]>({
    queryKey: ["/api/inv/production-batches"],
  });

  const { data: conversions, isLoading: convsLoading } = useQuery<Conversion[]>({
    queryKey: ["/api/inv/conversions"],
  });

  const activeConversions = conversions?.filter(c => c.isActive) || [];

  const selectedConversion = activeConversions.find(c => c.id === Number(selectedConversionId));

  const apQty = Number(apQtyUsed) || 0;
  let usableQty = 0;
  let epOutputPreview: Array<{ epItemName: string; qty: number }> = [];
  if (selectedConversion && apQty > 0) {
    const merma = Number(selectedConversion.mermaPct);
    const cook = Number(selectedConversion.cookFactor);
    const extra = Number(selectedConversion.extraLossPct);
    usableQty = apQty * (1 - merma / 100) * cook * (1 - extra / 100);
    epOutputPreview = selectedConversion.outputs.map(o => ({
      epItemName: o.epItemName || `EP #${o.epItemId}`,
      qty: usableQty * (Number(o.outputPct) / 100),
    }));
  }

  const createMutation = useMutation({
    mutationFn: async (data: { conversionId: number; apQtyUsed: string }) => {
      const res = await apiRequest("POST", "/api/inv/production-batches", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/production-batches"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/stock/ap"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/stock/ep"] });
      toast({ title: "Producción completada" });
      setDialogOpen(false);
      setSelectedConversionId("");
      setApQtyUsed("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleCreate = () => {
    if (!selectedConversionId || !apQtyUsed || apQty <= 0) return;
    createMutation.mutate({
      conversionId: Number(selectedConversionId),
      apQtyUsed: apQty.toFixed(4),
    });
  };

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--f-disp)" }} data-testid="text-page-title">
          Producción (Batches)
        </h1>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-new-batch">
          <Plus className="w-4 h-4 mr-1" /> Nueva Producción
        </Button>
      </div>

      {batchesLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !batches || batches.length === 0 ? (
        <Card className="p-6 text-center">
          <Factory className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground" data-testid="text-empty-batches">No hay producciones registradas</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {batches.map(batch => (
            <Card key={batch.id} className="p-4" data-testid={`card-batch-${batch.id}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold" data-testid={`text-batch-name-${batch.id}`}>
                      {batch.conversionName}
                    </span>
                    <Badge variant="secondary" data-testid={`badge-batch-status-${batch.id}`}>
                      {batch.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    AP: {batch.apItemName} — {Number(batch.apQtyUsed).toFixed(2)} usado
                  </p>
                  <div className="flex items-center gap-1 flex-wrap mt-1">
                    {batch.outputs.map(o => (
                      <Badge key={o.id} variant="outline" className="text-xs">
                        {o.epItemName}: {Number(o.qtyEpGenerated).toFixed(2)}
                      </Badge>
                    ))}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap" data-testid={`text-batch-date-${batch.id}`}>
                  {batch.createdAt ? new Date(batch.createdAt).toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" }) : ""}
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva Producción</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Conversión AP→EP</Label>
              {convsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={selectedConversionId} onValueChange={setSelectedConversionId}>
                  <SelectTrigger data-testid="select-conversion">
                    <SelectValue placeholder="Seleccionar conversión..." />
                  </SelectTrigger>
                  <SelectContent>
                    {activeConversions.map(c => (
                      <SelectItem key={c.id} value={String(c.id)} data-testid={`option-conversion-${c.id}`}>
                        {c.name} ({c.apItemName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedConversion && (
              <>
                <div>
                  <Label>Insumo AP: {selectedConversion.apItemName}</Label>
                  <p className="text-xs text-muted-foreground">
                    Merma: {selectedConversion.mermaPct}% | Cook: {selectedConversion.cookFactor}x | Extra: {selectedConversion.extraLossPct}%
                  </p>
                </div>
                <div>
                  <Label>Cantidad AP a usar</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={apQtyUsed}
                    onChange={e => setApQtyUsed(e.target.value)}
                    placeholder="Ej: 10"
                    data-testid="input-ap-qty"
                  />
                </div>

                {apQty > 0 && epOutputPreview.length > 0 && (
                  <Card className="p-3 bg-muted/50">
                    <p className="text-sm font-medium mb-2">Resultado estimado:</p>
                    <p className="text-xs text-muted-foreground mb-1">Qty útil: {usableQty.toFixed(4)}</p>
                    {epOutputPreview.map((ep, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                        <span data-testid={`text-preview-ep-${i}`}>{ep.epItemName}: <strong>{ep.qty.toFixed(4)}</strong></span>
                      </div>
                    ))}
                  </Card>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-batch">
              Cancelar
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!selectedConversionId || apQty <= 0 || createMutation.isPending}
              data-testid="button-confirm-batch"
            >
              {createMutation.isPending ? "Procesando..." : "Producir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
