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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, Calculator, X, Info, Pencil } from "lucide-react";

const EP_UOM_OPTIONS = [
  { value: "G", label: "G - Gramo" },
  { value: "ML", label: "ML - Mililitro" },
  { value: "UNIT", label: "UNIT - Unidad" },
  { value: "PORTION", label: "PORTION - Porción" },
];

type ConvOutputEnriched = {
  id?: number;
  epItemId: number;
  outputPct: string;
  portionSize?: string | null;
  label?: string | null;
  epItemName?: string;
  epItemSku?: string;
  epBaseUom?: string;
  epUnitCost?: number | null;
  portionCost?: number | null;
  epQtySmall?: number | null;
  smallUom?: string;
  costWarning?: string | null;
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
  apBaseUom?: string;
  apCostPerBaseUom?: number | null;
  apCalcBasisLabel?: string;
  usableQtyBase?: number;
  usableQtySmall?: number;
  smallUom?: string;
  convCostWarning?: string | null;
  outputs: ConvOutputEnriched[];
};

type InvItem = {
  id: number;
  sku: string;
  name: string;
  itemType: string;
  baseUom: string;
  isActive: boolean;
};

type FormOutput = {
  epItemId: number;
  outputPct: string;
  portionSize: string;
  label: string;
  epItemName?: string;
  creatingNew?: boolean;
  newEpName?: string;
  newEpUom?: string;
};

function calcUsable(merma: number, cook: number, extraLoss: number) {
  return 1 * (1 - merma / 100) * cook * (1 - extraLoss / 100);
}

export default function ConversionsPage() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [calcOpen, setCalcOpen] = useState<number | null>(null);
  const [calcQty, setCalcQty] = useState("1");

  const [formName, setFormName] = useState("");
  const [formApItemId, setFormApItemId] = useState("");
  const [formMerma, setFormMerma] = useState("0");
  const [formCook, setFormCook] = useState("1");
  const [formExtraLoss, setFormExtraLoss] = useState("0");
  const [formNotes, setFormNotes] = useState("");
  const [formOutputs, setFormOutputs] = useState<FormOutput[]>([]);

  const { data: conversions, isLoading } = useQuery<Conversion[]>({
    queryKey: ["/api/inv/conversions"],
  });

  const { data: apItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items?type=AP"],
  });

  const { data: epItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items?type=EP"],
  });

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/inv/conversions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/conversions"] });
      toast({ title: "Conversión creada" });
      closeForm();
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
      closeForm();
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deactivateMut = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/inv/conversions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/conversions"] });
      toast({ title: "Conversión desactivada" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const quickEpMut = useMutation({
    mutationFn: async (data: { name: string; baseUom: string }) => {
      const res = await apiRequest("POST", "/api/inv/items/quick-ep", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items?type=EP"] });
    },
    onError: (err: any) => toast({ title: "Error creando EP", description: err.message, variant: "destructive" }),
  });

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setFormName("");
    setFormApItemId("");
    setFormMerma("0");
    setFormCook("1");
    setFormExtraLoss("0");
    setFormNotes("");
    setFormOutputs([]);
  }

  function openCreate() {
    closeForm();
    setShowForm(true);
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
      outputPct: o.outputPct || "",
      portionSize: o.portionSize || "",
      label: o.label || "",
      epItemName: o.epItemName,
    })));
    setShowForm(true);
  }

  function handleSubmit() {
    if (!formName.trim()) { toast({ title: "Nombre requerido", variant: "destructive" }); return; }
    if (!formApItemId) { toast({ title: "Seleccione insumo AP", variant: "destructive" }); return; }
    if (formOutputs.length === 0) { toast({ title: "Agregue al menos una salida", variant: "destructive" }); return; }
    if (formOutputs.some(o => !o.epItemId)) { toast({ title: "Seleccione item EP en todas las salidas", variant: "destructive" }); return; }
    if (formOutputs.some(o => o.creatingNew)) { toast({ title: "Termine de crear los items EP nuevos", variant: "destructive" }); return; }

    if (formOutputs.length > 1 && formOutputs.some(o => !o.outputPct || o.outputPct.trim() === "")) {
      toast({ title: "Cada salida debe tener % asignado cuando hay múltiples salidas", variant: "destructive" });
      return;
    }

    const outputPctSum = formOutputs.reduce((s, o) => s + (Number(o.outputPct) || 0), 0);
    if (outputPctSum > 100) {
      toast({ title: "La suma de % de salida no puede superar 100%", variant: "destructive" });
      return;
    }

    const payload = {
      apItemId: parseInt(formApItemId),
      name: formName.trim(),
      mermaPct: formMerma,
      cookFactor: formCook,
      extraLossPct: formExtraLoss,
      notes: formNotes || null,
      outputs: formOutputs.map(o => ({
        epItemId: o.epItemId,
        outputPct: o.outputPct || (formOutputs.length === 1 ? "100" : "0"),
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
    setFormOutputs([...formOutputs, { epItemId: 0, outputPct: formOutputs.length === 0 ? "100" : "", portionSize: "", label: "" }]);
  }

  function removeOutput(idx: number) {
    setFormOutputs(formOutputs.filter((_, i) => i !== idx));
  }

  function updateOutput(idx: number, field: string, value: any) {
    const updated = [...formOutputs];
    (updated[idx] as any)[field] = value;
    setFormOutputs(updated);
  }

  async function handleCreateQuickEp(idx: number) {
    const out = formOutputs[idx];
    if (!out.newEpName?.trim()) { toast({ title: "Nombre EP requerido", variant: "destructive" }); return; }
    if (!out.newEpUom) { toast({ title: "UOM requerida", variant: "destructive" }); return; }

    try {
      const res = await apiRequest("POST", "/api/inv/items/quick-ep", {
        name: out.newEpName.trim(),
        baseUom: out.newEpUom,
      });
      const newItem = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items?type=EP"] });
      const updated = [...formOutputs];
      updated[idx] = {
        ...updated[idx],
        epItemId: newItem.id,
        epItemName: newItem.name,
        creatingNew: false,
        newEpName: undefined,
        newEpUom: undefined,
      };
      setFormOutputs(updated);
      toast({ title: `EP "${newItem.name}" creado` });
    } catch (err: any) {
      toast({ title: "Error creando EP", description: err.message, variant: "destructive" });
    }
  }

  function handleEpSelectChange(idx: number, value: string) {
    if (value === "__create_new__") {
      updateOutput(idx, "creatingNew", true);
      updateOutput(idx, "epItemId", 0);
    } else {
      const updated = [...formOutputs];
      const item = activeEpItems.find(i => i.id === parseInt(value));
      updated[idx] = {
        ...updated[idx],
        epItemId: parseInt(value),
        epItemName: item?.name || "",
        creatingNew: false,
        newEpName: undefined,
        newEpUom: undefined,
      };
      setFormOutputs(updated);
    }
  }

  const outputPctSum = formOutputs.reduce((s, o) => s + (Number(o.outputPct) || 0), 0);
  const pctOver100 = outputPctSum > 100;
  const pctUnder100 = outputPctSum > 0 && outputPctSum < 100;

  const activeApItems = (apItems || []).filter(i => i.isActive);
  const activeEpItems = (epItems || []).filter(i => i.isActive);

  return (
    <TooltipProvider>
      <div className="p-4 max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-xl font-bold" data-testid="text-page-title">Conversiones AP → EP</h1>
          {!showForm && (
            <Button onClick={openCreate} data-testid="button-create-conversion">
              <Plus className="w-4 h-4 mr-1" /> Nueva Conversión
            </Button>
          )}
        </div>

        {showForm && (
          <Card className="p-4 border-2 border-primary/30" data-testid="card-conversion-form">
            <h2 className="text-lg font-semibold mb-3" data-testid="text-form-title">
              {editingId ? "Editar Conversión" : "Nueva Conversión"}
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                          {item.name} ({item.baseUom})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Merma %</Label>
                  <Input type="number" step="0.01" min="0" max="100" value={formMerma} onChange={e => setFormMerma(e.target.value)} data-testid="input-merma" />
                </div>
                <div>
                  <Label>Factor cocción</Label>
                  <Input type="number" step="0.001" min="0" value={formCook} onChange={e => setFormCook(e.target.value)} data-testid="input-cook-factor" />
                </div>
                <div>
                  <Label>Pérdida extra %</Label>
                  <Input type="number" step="0.01" min="0" max="100" value={formExtraLoss} onChange={e => setFormExtraLoss(e.target.value)} data-testid="input-extra-loss" />
                </div>
              </div>

              <div>
                <Label>Notas</Label>
                <Textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} data-testid="input-notes" rows={2} />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Label className="mb-0">Salidas EP</Label>
                  <div className="flex items-center gap-2">
                    {formOutputs.length > 0 && (
                      <span className={`text-xs font-mono ${pctOver100 ? "text-destructive font-bold" : pctUnder100 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} data-testid="text-output-pct-sum">
                        Total: {outputPctSum.toFixed(1)}%
                        {pctUnder100 && ` (resto ${(100 - outputPctSum).toFixed(1)}% sin asignar)`}
                      </span>
                    )}
                    <Button variant="outline" size="sm" onClick={addOutput} data-testid="button-add-output">
                      <Plus className="w-3 h-3 mr-1" /> Agregar salida
                    </Button>
                  </div>
                </div>

                {formOutputs.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-3 border border-dashed rounded">
                    Agregue al menos una salida EP
                  </p>
                )}

                <div className="space-y-2">
                  {formOutputs.map((out, idx) => (
                    <div key={idx} className="border rounded p-3 space-y-2" data-testid={`form-output-${idx}`}>
                      {out.creatingNew ? (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-primary">Crear nuevo EP</p>
                          <div className="flex items-end gap-2 flex-wrap">
                            <div className="flex-1 min-w-[140px]">
                              <Label className="text-xs">Nombre EP</Label>
                              <Input
                                value={out.newEpName || ""}
                                onChange={e => { const u = [...formOutputs]; u[idx] = { ...u[idx], newEpName: e.target.value }; setFormOutputs(u); }}
                                placeholder="Ej: Arroz cocido"
                                data-testid={`input-new-ep-name-${idx}`}
                              />
                            </div>
                            <div className="w-40">
                              <Label className="text-xs">UOM</Label>
                              <Select
                                value={out.newEpUom || ""}
                                onValueChange={v => { const u = [...formOutputs]; u[idx] = { ...u[idx], newEpUom: v }; setFormOutputs(u); }}
                              >
                                <SelectTrigger data-testid={`select-new-ep-uom-${idx}`}>
                                  <SelectValue placeholder="UOM" />
                                </SelectTrigger>
                                <SelectContent>
                                  {EP_UOM_OPTIONS.map(o => (
                                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button size="sm" onClick={() => handleCreateQuickEp(idx)} disabled={quickEpMut.isPending} data-testid={`button-create-ep-${idx}`}>
                              {quickEpMut.isPending ? "Creando..." : "Crear"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { const u = [...formOutputs]; u[idx] = { ...u[idx], creatingNew: false, newEpName: undefined, newEpUom: undefined }; setFormOutputs(u); }}>
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-end gap-2 flex-wrap">
                          <div className="flex-1 min-w-[140px]">
                            <Label className="text-xs">Item EP</Label>
                            <Select
                              value={out.epItemId ? String(out.epItemId) : ""}
                              onValueChange={v => handleEpSelectChange(idx, v)}
                            >
                              <SelectTrigger data-testid={`select-ep-item-${idx}`}>
                                <SelectValue placeholder="Seleccionar EP" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__create_new__">
                                  <span className="text-primary font-semibold">+ Crear EP nuevo</span>
                                </SelectItem>
                                {activeEpItems.map(item => (
                                  <SelectItem key={item.id} value={String(item.id)}>
                                    {item.name} ({item.baseUom})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="w-20">
                            <Label className="text-xs">% salida</Label>
                            <Input type="number" step="0.01" min="0" max="100" value={out.outputPct} onChange={e => updateOutput(idx, "outputPct", e.target.value)} data-testid={`input-output-pct-${idx}`} />
                          </div>
                          <div className="w-24">
                            <Label className="text-xs">Porción</Label>
                            <Input type="number" step="0.01" min="0" value={out.portionSize} onChange={e => updateOutput(idx, "portionSize", e.target.value)} placeholder="g/ml" data-testid={`input-portion-size-${idx}`} />
                          </div>
                          <div className="w-24">
                            <Label className="text-xs">Etiqueta</Label>
                            <Input value={out.label} onChange={e => updateOutput(idx, "label", e.target.value)} placeholder="Ej: Lomo" data-testid={`input-output-label-${idx}`} />
                          </div>
                          <Button variant="ghost" size="icon" onClick={() => removeOutput(idx)} data-testid={`button-remove-output-${idx}`}>
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={closeForm} data-testid="button-cancel">
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={createMut.isPending || updateMut.isPending}
                  data-testid="button-save-conversion"
                >
                  {(createMut.isPending || updateMut.isPending) ? "Guardando..." : "Guardar"}
                </Button>
              </div>
            </div>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : !conversions || conversions.length === 0 ? (
          <Card className="p-6 text-center text-muted-foreground" data-testid="text-empty-state">
            No hay conversiones configuradas
          </Card>
        ) : (
          <div className="space-y-3">
            {conversions.map(conv => (
              <div key={conv.id}>
                <Card className={`p-4 ${!conv.isActive ? "opacity-60" : ""}`} data-testid={`card-conversion-${conv.id}`}>
                  <div className="flex items-start justify-between gap-2 flex-wrap mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-base" data-testid={`text-conversion-name-${conv.id}`}>{conv.name}</span>
                        {!conv.isActive && <Badge variant="secondary">Inactiva</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1" data-testid={`text-conversion-ap-${conv.id}`}>
                        AP: {conv.apItemName} {conv.apCalcBasisLabel && <span className="text-xs">({conv.apCalcBasisLabel})</span>}
                      </div>
                      <div className="text-sm text-muted-foreground flex gap-3 flex-wrap mt-1">
                        <span>Merma: {conv.mermaPct}%</span>
                        <span>Factor: {conv.cookFactor}</span>
                        <span>Extra: {conv.extraLossPct}%</span>
                        {conv.apCostPerBaseUom != null && conv.apCostPerBaseUom > 0 && (
                          <span className="font-medium">Costo AP: ₡{conv.apCostPerBaseUom.toFixed(2)}</span>
                        )}
                      </div>
                      {conv.convCostWarning && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid={`text-conv-warning-${conv.id}`}>
                          ⚠ {conv.convCostWarning}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setCalcOpen(calcOpen === conv.id ? null : conv.id); setCalcQty("1"); }}
                        data-testid={`button-calc-${conv.id}`}
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
                        <Pencil className="w-3 h-3 mr-1" /> Editar
                      </Button>
                      {conv.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => deactivateMut.mutate(conv.id)}
                          data-testid={`button-deactivate-${conv.id}`}
                        >
                          Desactivar
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" data-testid={`table-outputs-${conv.id}`}>
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-1 pr-2 font-medium">EP Item</th>
                          <th className="py-1 pr-2 font-medium text-right">% Salida</th>
                          <th className="py-1 pr-2 font-medium text-right">Porción</th>
                          <th className="py-1 pr-2 font-medium">Etiqueta</th>
                          <th className="py-1 pr-2 font-medium text-right">Costo Unit</th>
                          <th className="py-1 font-medium text-right">Costo Porción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {conv.outputs.map((out, oi) => (
                          <tr key={out.id || oi} className="border-b last:border-b-0" data-testid={`row-output-${conv.id}-${oi}`}>
                            <td className="py-1.5 pr-2">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex items-center gap-1 cursor-help">
                                    {out.epItemName || `EP #${out.epItemId}`}
                                    <Info className="w-3 h-3 text-muted-foreground" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="right" className="max-w-xs text-xs space-y-1 p-3">
                                  <p className="font-semibold">Base de cálculo: 1 {conv.apBaseUom || "?"}</p>
                                  {out.epQtySmall != null ? (
                                    <p>Rendimiento: {out.epQtySmall.toFixed(1)} {out.smallUom} {conv.apCalcBasisLabel}</p>
                                  ) : (
                                    <p className="text-amber-600">Rendimiento: N/A</p>
                                  )}
                                  {out.epUnitCost != null ? (
                                    <p>Costo: ₡{out.epUnitCost.toFixed(2)}/{out.smallUom}</p>
                                  ) : out.costWarning ? (
                                    <p className="text-amber-600">{out.costWarning}</p>
                                  ) : (
                                    <p className="text-muted-foreground">Costo: N/A</p>
                                  )}
                                  {out.portionCost != null ? (
                                    <p>Porción: ₡{out.portionCost.toFixed(2)}/porción</p>
                                  ) : out.epBaseUom === "PORTION" ? (
                                    <p className="text-muted-foreground">Porción: N/A — Para costo exacto use EP en G/ML/UNIT.</p>
                                  ) : (
                                    <p className="text-muted-foreground">Porción: N/A</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              {out.outputPct != null && out.outputPct !== "" ? `${out.outputPct}%` : (conv.outputs.length === 1 ? "100%" : "—")}
                            </td>
                            <td className="py-1.5 pr-2 text-right">
                              {out.portionSize ? `${out.portionSize}` : "—"}
                            </td>
                            <td className="py-1.5 pr-2">{out.label || "—"}</td>
                            <td className="py-1.5 pr-2 text-right">
                              {out.costWarning ? (
                                <span className="text-amber-600 dark:text-amber-400 text-xs">{out.costWarning}</span>
                              ) : out.epUnitCost != null ? (
                                <span className="font-medium">₡{out.epUnitCost.toFixed(2)}/{out.smallUom}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-1.5 text-right">
                              {out.epBaseUom === "PORTION" ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="text-muted-foreground cursor-help">N/A</span>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">
                                    Para costo exacto use EP en G/ML/UNIT.
                                  </TooltipContent>
                                </Tooltip>
                              ) : out.portionCost != null ? (
                                <span className="font-medium">₡{out.portionCost.toFixed(2)}/porción</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(() => {
                    const sum = conv.outputs.reduce((s, o) => s + (Number(o.outputPct) || (conv.outputs.length === 1 ? 100 : 0)), 0);
                    if (sum > 0 && sum < 100) {
                      return (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2" data-testid={`text-pct-warning-${conv.id}`}>
                          ⚠ Total salidas {sum.toFixed(1)}% (resto {(100 - sum).toFixed(1)}% sin asignar)
                        </p>
                      );
                    }
                    return null;
                  })()}
                </Card>

                {calcOpen === conv.id && (
                  <Card className="p-4 mt-1 ml-4 border-l-4 border-primary/30" data-testid={`card-calc-${conv.id}`}>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h3 className="text-sm font-semibold">Calculadora de Rendimiento</h3>
                      <Button variant="ghost" size="icon" onClick={() => setCalcOpen(null)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Label className="text-sm whitespace-nowrap">Cantidad AP ({conv.apBaseUom || "base"}):</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={calcQty}
                          onChange={e => setCalcQty(e.target.value)}
                          className="w-28"
                          data-testid="input-calc-qty"
                        />
                      </div>
                      {(() => {
                        const qty = Number(calcQty) || 0;
                        const usable = calcUsable(Number(conv.mermaPct), Number(conv.cookFactor), Number(conv.extraLossPct)) * qty;
                        return (
                          <div className="text-sm space-y-1 bg-muted/50 p-3 rounded">
                            <p>Usable: <strong data-testid="text-calc-usable">{usable.toFixed(4)}</strong> {conv.apBaseUom || "base"}</p>
                            <p className="text-xs text-muted-foreground">Merma: {conv.mermaPct}% | Factor: {conv.cookFactor} | Extra: {conv.extraLossPct}%</p>
                            <hr className="my-2" />
                            {conv.outputs.map((o, i) => {
                              const pct = Number(o.outputPct) || (conv.outputs.length === 1 ? 100 : 0);
                              const epQty = usable * pct / 100;
                              return (
                                <p key={i} data-testid={`text-calc-output-${i}`}>
                                  {o.epItemName || o.label || `Salida ${i + 1}`}: <strong>{epQty.toFixed(4)}</strong> {conv.apBaseUom || "base"} ({pct}%)
                                  {o.epUnitCost != null && qty > 0 && (
                                    <span className="text-muted-foreground ml-2">→ ₡{(o.epUnitCost * epQty * 1000).toFixed(2)} total</span>
                                  )}
                                </p>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </Card>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
