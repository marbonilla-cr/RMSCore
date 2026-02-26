import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Plus, Trash2, Calculator, X } from "lucide-react";

type ConvOutput = {
  id?: number;
  epItemId: number;
  outputPct: string;
  portionSize?: string | null;
  label?: string | null;
  epItemName?: string;
};

type Conversion = {
  id: number;
  apItemId: number;
  name: string;
  mermaPct: string;
  cookFactor: string;
  extraLossPct: string;
  notes: string | null;
  isActive: boolean;
  apItemName: string;
  apItemSku: string;
  outputs: ConvOutput[];
};

type InvItem = {
  id: number;
  sku: string;
  name: string;
  itemType: string;
  isActive: boolean;
};

function calcUsable(apQty: number, merma: number, cook: number, extraLoss: number) {
  return apQty * (1 - merma / 100) * cook * (1 - extraLoss / 100);
}

export default function ConversionsPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewConv, setPreviewConv] = useState<Conversion | null>(null);
  const [previewQty, setPreviewQty] = useState("1");

  const [formName, setFormName] = useState("");
  const [formApItemId, setFormApItemId] = useState<string>("");
  const [formMerma, setFormMerma] = useState("0");
  const [formCook, setFormCook] = useState("1");
  const [formExtraLoss, setFormExtraLoss] = useState("0");
  const [formNotes, setFormNotes] = useState("");
  const [formOutputs, setFormOutputs] = useState<ConvOutput[]>([]);

  const { data: conversions, isLoading } = useQuery<Conversion[]>({
    queryKey: ["/api/inv/conversions"],
  });

  const { data: apItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items", "?type=AP"],
  });

  const { data: epItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items", "?type=EP"],
  });

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/inv/conversions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/conversions"] });
      toast({ title: "Conversión creada" });
      setDialogOpen(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PATCH", `/api/inv/conversions/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/conversions"] });
      toast({ title: "Conversión actualizada" });
      setDialogOpen(false);
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/inv/conversions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/conversions"] });
      toast({ title: "Conversión desactivada" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function resetForm() {
    setFormName("");
    setFormApItemId("");
    setFormMerma("0");
    setFormCook("1");
    setFormExtraLoss("0");
    setFormNotes("");
    setFormOutputs([]);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(conv: Conversion) {
    setEditingId(conv.id);
    setFormName(conv.name);
    setFormApItemId(String(conv.apItemId));
    setFormMerma(conv.mermaPct);
    setFormCook(conv.cookFactor);
    setFormExtraLoss(conv.extraLossPct);
    setFormNotes(conv.notes || "");
    setFormOutputs(conv.outputs.map(o => ({
      epItemId: o.epItemId,
      outputPct: o.outputPct,
      portionSize: o.portionSize,
      label: o.label,
      epItemName: o.epItemName,
    })));
    setDialogOpen(true);
  }

  function handleSubmit() {
    const payload = {
      apItemId: parseInt(formApItemId),
      name: formName,
      mermaPct: formMerma,
      cookFactor: formCook,
      extraLossPct: formExtraLoss,
      notes: formNotes || null,
      outputs: formOutputs.map(o => ({
        epItemId: o.epItemId,
        outputPct: o.outputPct,
        portionSize: o.portionSize || null,
        label: o.label || null,
      })),
    };
    if (editingId) {
      updateMut.mutate({ id: editingId, data: payload });
    } else {
      createMut.mutate(payload);
    }
  }

  function addOutput() {
    setFormOutputs([...formOutputs, { epItemId: 0, outputPct: "100", portionSize: null, label: null }]);
  }

  function removeOutput(idx: number) {
    setFormOutputs(formOutputs.filter((_, i) => i !== idx));
  }

  function updateOutput(idx: number, field: string, value: any) {
    const updated = [...formOutputs];
    (updated[idx] as any)[field] = value;
    setFormOutputs(updated);
  }

  const outputPctSum = formOutputs.reduce((s, o) => s + Number(o.outputPct || 0), 0);
  const pctValid = outputPctSum <= 100;

  const activeApItems = (apItems || []).filter(i => i.isActive);
  const activeEpItems = (epItems || []).filter(i => i.isActive);

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold" data-testid="text-page-title">Conversiones AP → EP</h1>
        <Button onClick={openCreate} data-testid="button-create-conversion">
          <Plus className="w-4 h-4 mr-1" /> Nueva Conversión
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : !conversions || conversions.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground" data-testid="text-empty-state">
          No hay conversiones configuradas
        </Card>
      ) : (
        <div className="space-y-2">
          {conversions.map(conv => (
            <Card key={conv.id} className="p-4" data-testid={`card-conversion-${conv.id}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold" data-testid={`text-conversion-name-${conv.id}`}>{conv.name}</span>
                    {!conv.isActive && <Badge variant="secondary">Inactiva</Badge>}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1" data-testid={`text-conversion-ap-${conv.id}`}>
                    AP: {conv.apItemName}
                  </div>
                  <div className="text-sm text-muted-foreground flex gap-3 flex-wrap mt-1">
                    <span>Merma: {conv.mermaPct}%</span>
                    <span>Factor cocción: {conv.cookFactor}</span>
                    <span>Pérdida extra: {conv.extraLossPct}%</span>
                    <span>{conv.outputs.length} salida(s)</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => { setPreviewConv(conv); setPreviewQty("1"); setPreviewOpen(true); }}
                    data-testid={`button-preview-${conv.id}`}
                    title="Calculadora"
                  >
                    <Calculator className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEdit(conv)}
                    data-testid={`button-edit-conversion-${conv.id}`}
                  >
                    Editar
                  </Button>
                  {conv.isActive && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteMut.mutate(conv.id)}
                      data-testid={`button-delete-conversion-${conv.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              {editingId ? "Editar Conversión" : "Nueva Conversión"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Nombre</Label>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Ej: Res entera → cortes"
                data-testid="input-conversion-name"
              />
            </div>

            <div>
              <Label>Insumo AP (materia prima)</Label>
              <Select value={formApItemId} onValueChange={setFormApItemId}>
                <SelectTrigger data-testid="select-ap-item">
                  <SelectValue placeholder="Seleccionar insumo AP" />
                </SelectTrigger>
                <SelectContent>
                  {activeApItems.map(item => (
                    <SelectItem key={item.id} value={String(item.id)}>
                      {item.name} ({item.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Merma %</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formMerma}
                  onChange={e => setFormMerma(e.target.value)}
                  data-testid="input-merma"
                />
              </div>
              <div>
                <Label>Factor cocción</Label>
                <Input
                  type="number"
                  step="0.001"
                  min="0"
                  value={formCook}
                  onChange={e => setFormCook(e.target.value)}
                  data-testid="input-cook-factor"
                />
              </div>
              <div>
                <Label>Pérdida extra %</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={formExtraLoss}
                  onChange={e => setFormExtraLoss(e.target.value)}
                  data-testid="input-extra-loss"
                />
              </div>
            </div>

            <div>
              <Label>Notas</Label>
              <Textarea
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                data-testid="input-notes"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <Label className="mb-0">Salidas EP</Label>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-mono ${pctValid ? "text-muted-foreground" : "text-destructive font-bold"}`} data-testid="text-output-pct-sum">
                    Total: {outputPctSum.toFixed(1)}%
                  </span>
                  <Button variant="outline" size="sm" onClick={addOutput} data-testid="button-add-output">
                    <Plus className="w-3 h-3 mr-1" /> Agregar
                  </Button>
                </div>
              </div>

              {formOutputs.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">
                  Agregue al menos una salida EP
                </p>
              )}

              {formOutputs.map((out, idx) => (
                <div key={idx} className="flex items-end gap-2 mb-2 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <Label className="text-xs">Item EP</Label>
                    <Select
                      value={out.epItemId ? String(out.epItemId) : ""}
                      onValueChange={v => updateOutput(idx, "epItemId", parseInt(v))}
                    >
                      <SelectTrigger data-testid={`select-ep-item-${idx}`}>
                        <SelectValue placeholder="Seleccionar EP" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeEpItems.map(item => (
                          <SelectItem key={item.id} value={String(item.id)}>
                            {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-20">
                    <Label className="text-xs">% salida</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={out.outputPct}
                      onChange={e => updateOutput(idx, "outputPct", e.target.value)}
                      data-testid={`input-output-pct-${idx}`}
                    />
                  </div>
                  <div className="w-24">
                    <Label className="text-xs">Porción</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={out.portionSize || ""}
                      onChange={e => updateOutput(idx, "portionSize", e.target.value || null)}
                      placeholder="g/ml"
                      data-testid={`input-portion-size-${idx}`}
                    />
                  </div>
                  <div className="w-24">
                    <Label className="text-xs">Etiqueta</Label>
                    <Input
                      value={out.label || ""}
                      onChange={e => updateOutput(idx, "label", e.target.value || null)}
                      placeholder="Ej: Lomo"
                      data-testid={`input-output-label-${idx}`}
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeOutput(idx)} data-testid={`button-remove-output-${idx}`}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            {formOutputs.length > 0 && formApItemId && (
              <Card className="p-3 bg-muted/50">
                <p className="text-xs font-semibold mb-1">Vista previa (1 kg AP)</p>
                {(() => {
                  const usable = calcUsable(1, Number(formMerma), Number(formCook), Number(formExtraLoss));
                  return (
                    <div className="text-xs space-y-1">
                      <p>Usable: <strong>{usable.toFixed(4)} kg</strong></p>
                      {formOutputs.map((o, i) => (
                        <p key={i}>
                          {o.label || `Salida ${i + 1}`}: {(usable * Number(o.outputPct || 0) / 100).toFixed(4)} kg ({o.outputPct}%)
                        </p>
                      ))}
                    </div>
                  );
                })()}
              </Card>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formName || !formApItemId || formOutputs.length === 0 || !pctValid || formOutputs.some(o => !o.epItemId) || createMut.isPending || updateMut.isPending}
              data-testid="button-save-conversion"
            >
              {(createMut.isPending || updateMut.isPending) ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle data-testid="text-preview-title">Calculadora de Rendimiento</DialogTitle>
          </DialogHeader>
          {previewConv && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">{previewConv.name}</p>
              <p className="text-sm text-muted-foreground">AP: {previewConv.apItemName}</p>
              <div>
                <Label>Cantidad AP (kg)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={previewQty}
                  onChange={e => setPreviewQty(e.target.value)}
                  data-testid="input-preview-qty"
                />
              </div>
              {(() => {
                const qty = Number(previewQty) || 0;
                const usable = calcUsable(qty, Number(previewConv.mermaPct), Number(previewConv.cookFactor), Number(previewConv.extraLossPct));
                return (
                  <Card className="p-3 bg-muted/50">
                    <div className="text-sm space-y-1">
                      <p>Usable: <strong data-testid="text-preview-usable">{usable.toFixed(4)}</strong> kg</p>
                      <p className="text-xs text-muted-foreground">
                        Merma: {previewConv.mermaPct}% | Factor: {previewConv.cookFactor} | Extra: {previewConv.extraLossPct}%
                      </p>
                      <hr className="my-2" />
                      {previewConv.outputs.map((o, i) => {
                        const epQty = usable * Number(o.outputPct) / 100;
                        return (
                          <p key={i} data-testid={`text-preview-output-${i}`}>
                            {o.epItemName || o.label || `Salida ${i + 1}`}: <strong>{epQty.toFixed(4)}</strong> kg ({o.outputPct}%)
                          </p>
                        );
                      })}
                    </div>
                  </Card>
                );
              })()}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
