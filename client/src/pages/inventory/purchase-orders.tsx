import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, ArrowLeft, Send, PackageCheck, Trash2, AlertTriangle, ShoppingCart } from "lucide-react";

interface Supplier {
  id: number;
  name: string;
  isActive: boolean;
}

interface InvItem {
  id: number;
  sku: string;
  name: string;
  baseUom: string;
}

interface PurchaseOrder {
  id: number;
  supplierId: number;
  status: string;
  createdByEmployeeId: number;
  sentAt: string | null;
  expectedDeliveryDate: string | null;
  notes: string | null;
  createdAt: string;
  supplierName?: string;
}

interface POLine {
  id: number;
  purchaseOrderId: number;
  invItemId: number;
  qtyPurchaseUom: string;
  purchaseUom: string;
  unitPricePerPurchaseUom: string;
  toBaseMultiplierSnapshot: string;
  qtyBaseExpected: string;
  qtyBaseReceived: string;
  lineStatus: string;
  itemName?: string;
  itemSku?: string;
  invItemName?: string;
}

interface ReceiveLine {
  poLineId: number;
  qtyPurchaseUomReceived: number;
  unitPricePerPurchaseUom: number;
}

interface Suggestion {
  invItemId: number;
  itemName: string;
  itemSku: string;
  baseUom: string;
  reorderPointQtyBase: string;
  stockQtyOnHand: string;
  deficit: string;
  preferredSupplier: {
    supplierId: number;
    supplierName: string;
    purchaseUom: string;
    lastPrice: string;
  } | null;
}

const statusConfig: Record<string, { label: string; variant: "secondary" | "default" | "outline" | "destructive" }> = {
  DRAFT: { label: "Borrador", variant: "secondary" },
  SENT: { label: "Enviada", variant: "default" },
  PARTIAL: { label: "Parcial", variant: "outline" },
  RECEIVED: { label: "Recibida", variant: "default" },
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "SENT": return "text-white no-default-hover-elevate";
    case "PARTIAL": return "text-white no-default-hover-elevate";
    case "RECEIVED": return "text-white no-default-hover-elevate";
    default: return "";
  }
}

function statusBadgeStyle(status: string): React.CSSProperties | undefined {
  switch (status) {
    case "SENT": return { background: 'var(--acc)' };
    case "PARTIAL": return { background: 'var(--amber)' };
    case "RECEIVED": return { background: 'var(--sage)' };
    default: return undefined;
  }
}

export default function PurchaseOrdersPage() {
  const { toast } = useToast();
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [newPo, setNewPo] = useState({ supplierId: "", notes: "", expectedDeliveryDate: "" });
  const [newLine, setNewLine] = useState({ invItemId: "", qtyPurchaseUom: "", purchaseUom: "", unitPricePerPurchaseUom: "" });
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [receiveNote, setReceiveNote] = useState("");
  const [activeTab, setActiveTab] = useState("orders");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

  const { data: orders, isLoading: ordersLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/inv/purchase-orders"],
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/inv/suppliers"],
  });

  const { data: items } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const { data: selectedPo } = useQuery<PurchaseOrder>({
    queryKey: ["/api/inv/purchase-orders", selectedPoId],
    enabled: selectedPoId !== null,
  });

  const { data: poLines, isLoading: linesLoading } = useQuery<POLine[]>({
    queryKey: ["/api/inv/purchase-orders", selectedPoId, "lines"],
    enabled: selectedPoId !== null,
  });

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery<Suggestion[]>({
    queryKey: ["/api/inv/purchase-orders/suggestions"],
  });

  const supplierMap = new Map<number, string>();
  if (suppliers) {
    for (const s of suppliers) supplierMap.set(s.id, s.name);
  }

  const itemMap = new Map<number, InvItem>();
  if (items) {
    for (const i of items) itemMap.set(i.id, i);
  }

  const createPoMutation = useMutation({
    mutationFn: async (data: { supplierId: number; notes: string; expectedDeliveryDate: string }) => {
      const res = await apiRequest("POST", "/api/inv/purchase-orders", data);
      return await res.json();
    },
    onSuccess: (data: PurchaseOrder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders"] });
      toast({ title: "Orden de compra creada" });
      setCreateOpen(false);
      setNewPo({ supplierId: "", notes: "", expectedDeliveryDate: "" });
      setSelectedPoId(data.id);
    },
    onError: (err: Error) => {
      toast({ title: "Error al crear OC", description: err.message, variant: "destructive" });
    },
  });

  const createPoFromSuggestionsMutation = useMutation({
    mutationFn: async (data: { supplierId: number; lines: Array<{ invItemId: number; qtyPurchaseUom: number; purchaseUom: string; unitPricePerPurchaseUom: number }> }) => {
      const res = await apiRequest("POST", "/api/inv/purchase-orders", { supplierId: data.supplierId, notes: "Creada desde sugerencias de reorden" });
      const po = await res.json();
      for (const line of data.lines) {
        await apiRequest("POST", `/api/inv/purchase-orders/${po.id}/lines`, line);
      }
      return po;
    },
    onSuccess: (data: PurchaseOrder) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders/suggestions"] });
      toast({ title: "OC creada desde sugerencias" });
      setSelectedSuggestions(new Set());
      setSelectedPoId(data.id);
      setActiveTab("orders");
    },
    onError: (err: Error) => {
      toast({ title: "Error al crear OC", description: err.message, variant: "destructive" });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: async (data: { invItemId: number; qtyPurchaseUom: number; purchaseUom: string; unitPricePerPurchaseUom: number }) => {
      await apiRequest("POST", `/api/inv/purchase-orders/${selectedPoId}/lines`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders", selectedPoId, "lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders"] });
      toast({ title: "Línea agregada" });
      setNewLine({ invItemId: "", qtyPurchaseUom: "", purchaseUom: "", unitPricePerPurchaseUom: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al agregar línea", description: err.message, variant: "destructive" });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: async (lineId: number) => {
      await apiRequest("DELETE", `/api/inv/po-lines/${lineId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders", selectedPoId, "lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders"] });
      toast({ title: "Línea eliminada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al eliminar línea", description: err.message, variant: "destructive" });
    },
  });

  const sendPoMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/inv/purchase-orders/${id}/send`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders", selectedPoId] });
      toast({ title: "OC enviada" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al enviar OC", description: err.message, variant: "destructive" });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: async (data: { lines: ReceiveLine[]; note?: string }) => {
      await apiRequest("POST", `/api/inv/purchase-orders/${selectedPoId}/receive`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders", selectedPoId] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders", selectedPoId, "lines"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/stock/ap"] });
      toast({ title: "Recepción registrada" });
      setReceiveOpen(false);
      setReceiveLines([]);
      setReceiveNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Error al recibir", description: err.message, variant: "destructive" });
    },
  });

  function handleCreatePo() {
    if (!newPo.supplierId) {
      toast({ title: "Seleccione proveedor", variant: "destructive" });
      return;
    }
    createPoMutation.mutate({
      supplierId: parseInt(newPo.supplierId),
      notes: newPo.notes,
      expectedDeliveryDate: newPo.expectedDeliveryDate,
    });
  }

  function handleAddLine() {
    if (!newLine.invItemId || !newLine.qtyPurchaseUom || !newLine.purchaseUom || !newLine.unitPricePerPurchaseUom) {
      toast({ title: "Complete todos los campos de la línea", variant: "destructive" });
      return;
    }
    addLineMutation.mutate({
      invItemId: parseInt(newLine.invItemId),
      qtyPurchaseUom: parseFloat(newLine.qtyPurchaseUom),
      purchaseUom: newLine.purchaseUom,
      unitPricePerPurchaseUom: parseFloat(newLine.unitPricePerPurchaseUom),
    });
  }

  function openReceiveDialog() {
    if (!poLines) return;
    const lines = poLines
      .filter((l) => l.lineStatus !== "RECEIVED")
      .map((l) => ({
        poLineId: l.id,
        qtyPurchaseUomReceived: parseFloat(l.qtyPurchaseUom) - (parseFloat(l.qtyBaseReceived) / parseFloat(l.toBaseMultiplierSnapshot)),
        unitPricePerPurchaseUom: parseFloat(l.unitPricePerPurchaseUom),
      }));
    setReceiveLines(lines);
    setReceiveNote("");
    setReceiveOpen(true);
  }

  function handleReceive() {
    receiveMutation.mutate({
      lines: receiveLines.filter((l) => l.qtyPurchaseUomReceived > 0),
      note: receiveNote || undefined,
    });
  }

  function updateReceiveLine(poLineId: number, field: keyof ReceiveLine, value: number) {
    setReceiveLines((prev) =>
      prev.map((l) => (l.poLineId === poLineId ? { ...l, [field]: value } : l))
    );
  }

  function toggleSuggestion(invItemId: number) {
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(invItemId)) {
        next.delete(invItemId);
      } else {
        next.add(invItemId);
      }
      return next;
    });
  }

  function handleCreatePoFromSuggestions() {
    if (!suggestions) return;
    const selected = suggestions.filter(s => selectedSuggestions.has(s.invItemId));
    if (selected.length === 0) {
      toast({ title: "Seleccione al menos un artículo", variant: "destructive" });
      return;
    }

    const bySupplier = new Map<number, { supplierName: string; lines: Array<{ invItemId: number; qtyPurchaseUom: number; purchaseUom: string; unitPricePerPurchaseUom: number }> }>();

    for (const s of selected) {
      const supplierId = s.preferredSupplier?.supplierId || 0;
      if (supplierId === 0) {
        toast({ title: `${s.itemName} no tiene proveedor asignado`, variant: "destructive" });
        return;
      }
      if (!bySupplier.has(supplierId)) {
        bySupplier.set(supplierId, {
          supplierName: s.preferredSupplier!.supplierName,
          lines: [],
        });
      }
      bySupplier.get(supplierId)!.lines.push({
        invItemId: s.invItemId,
        qtyPurchaseUom: Math.ceil(Number(s.deficit)),
        purchaseUom: s.preferredSupplier?.purchaseUom || s.baseUom,
        unitPricePerPurchaseUom: Number(s.preferredSupplier?.lastPrice || "0"),
      });
    }

    const entries = Array.from(bySupplier.entries());
    if (entries.length === 1) {
      const [supplierId, data] = entries[0];
      createPoFromSuggestionsMutation.mutate({ supplierId, lines: data.lines });
    } else {
      for (const [supplierId, data] of entries) {
        createPoFromSuggestionsMutation.mutate({ supplierId, lines: data.lines });
      }
    }
  }

  const poStatus = selectedPo?.status || "";
  const isDraft = poStatus === "DRAFT";

  if (selectedPoId !== null) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <Button variant="outline" data-testid="button-back-to-list" onClick={() => setSelectedPoId(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
          <h1 className="admin-page-title" data-testid="text-po-detail-title">
            OC #{selectedPoId}
          </h1>
          {selectedPo && (
            <Badge className={statusBadgeClass(selectedPo.status)} style={statusBadgeStyle(selectedPo.status)} data-testid="badge-po-status">
              {statusConfig[selectedPo.status]?.label || selectedPo.status}
            </Badge>
          )}
        </div>

        {selectedPo && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <p data-testid="text-po-supplier">
                <span className="font-medium">Proveedor:</span> {selectedPo.supplierName || supplierMap.get(selectedPo.supplierId) || `ID ${selectedPo.supplierId}`}
              </p>
              {selectedPo.expectedDeliveryDate && (
                <p data-testid="text-po-expected-date">
                  <span className="font-medium">Fecha esperada:</span> {selectedPo.expectedDeliveryDate}
                </p>
              )}
              {selectedPo.notes && (
                <p data-testid="text-po-notes">
                  <span className="font-medium">Notas:</span> {selectedPo.notes}
                </p>
              )}
              <div className="flex gap-2 flex-wrap pt-2">
                {isDraft && (
                  <Button
                    data-testid="button-send-po"
                    onClick={() => sendPoMutation.mutate(selectedPoId)}
                    disabled={sendPoMutation.isPending}
                  >
                    {sendPoMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Send className="mr-2 h-4 w-4" />
                    Enviar OC
                  </Button>
                )}
                {(poStatus === "SENT" || poStatus === "PARTIAL") && (
                  <Button
                    data-testid="button-receive-po"
                    onClick={openReceiveDialog}
                  >
                    <PackageCheck className="mr-2 h-4 w-4" />
                    Recibir
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Líneas de la OC</CardTitle>
          </CardHeader>
          <CardContent>
            {linesLoading ? (
              <div className="flex justify-center p-4" data-testid="loading-po-lines">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : !poLines || poLines.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-po-lines">Sin líneas.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table data-testid="table-po-lines">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artículo</TableHead>
                      <TableHead>Cantidad</TableHead>
                      <TableHead>UOM</TableHead>
                      <TableHead>Precio Unit.</TableHead>
                      <TableHead>Subtotal</TableHead>
                      <TableHead>Recibido</TableHead>
                      <TableHead>Estado</TableHead>
                      {isDraft && <TableHead></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poLines.map((line) => {
                      const qty = parseFloat(line.qtyPurchaseUom);
                      const price = parseFloat(line.unitPricePerPurchaseUom);
                      const received = parseFloat(line.qtyBaseReceived);
                      return (
                        <TableRow key={line.id} data-testid={`row-po-line-${line.id}`}>
                          <TableCell data-testid={`text-line-item-${line.id}`}>
                            {line.invItemName || line.itemName || line.itemSku || itemMap.get(line.invItemId)?.name || `Item #${line.invItemId}`}
                          </TableCell>
                          <TableCell data-testid={`text-line-qty-${line.id}`}>{qty.toFixed(2)}</TableCell>
                          <TableCell data-testid={`text-line-uom-${line.id}`}>{line.purchaseUom}</TableCell>
                          <TableCell data-testid={`text-line-price-${line.id}`}>{price.toFixed(2)}</TableCell>
                          <TableCell data-testid={`text-line-subtotal-${line.id}`}>{(qty * price).toFixed(2)}</TableCell>
                          <TableCell data-testid={`text-line-received-${line.id}`}>{received.toFixed(2)}</TableCell>
                          <TableCell data-testid={`badge-line-status-${line.id}`}>
                            <Badge variant="secondary">{line.lineStatus}</Badge>
                          </TableCell>
                          {isDraft && (
                            <TableCell>
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-delete-line-${line.id}`}
                                onClick={() => deleteLineMutation.mutate(line.id)}
                                disabled={deleteLineMutation.isPending}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {isDraft && (
              <div className="mt-4 border-t pt-4">
                <h3 className="text-sm font-medium mb-2">Agregar Línea</h3>
                <div className="flex gap-2 flex-wrap items-end">
                  <div className="space-y-1 min-w-[180px]">
                    <Label>Artículo</Label>
                    <Select value={newLine.invItemId} onValueChange={(v) => {
                      const selectedItem = items?.find(i => String(i.id) === v);
                      setNewLine({ ...newLine, invItemId: v, purchaseUom: selectedItem?.baseUom || newLine.purchaseUom });
                    }}>
                      <SelectTrigger data-testid="select-line-item">
                        <SelectValue placeholder="Seleccionar artículo" />
                      </SelectTrigger>
                      <SelectContent>
                        {items?.map((item) => (
                          <SelectItem key={item.id} value={String(item.id)} data-testid={`option-item-${item.id}`}>
                            {item.sku} - {item.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 w-24">
                    <Label>Cantidad</Label>
                    <Input
                      data-testid="input-line-qty"
                      type="number"
                      step="0.01"
                      value={newLine.qtyPurchaseUom}
                      onChange={(e) => setNewLine({ ...newLine, qtyPurchaseUom: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1 w-28">
                    <Label>UOM</Label>
                    <Select value={newLine.purchaseUom} onValueChange={(v) => setNewLine({ ...newLine, purchaseUom: v })}>
                      <SelectTrigger data-testid="select-line-uom">
                        <SelectValue placeholder="Unidad" />
                      </SelectTrigger>
                      <SelectContent>
                        {["UNIT","KG","G","LB","OZ","LT","ML","GAL","BOLSA","CAJA","PAQUETE","BOTELLA","LATA"].map((u) => (
                          <SelectItem key={u} value={u}>{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 w-28">
                    <Label>Precio Unit.</Label>
                    <Input
                      data-testid="input-line-price"
                      type="number"
                      step="0.01"
                      value={newLine.unitPricePerPurchaseUom}
                      onChange={(e) => setNewLine({ ...newLine, unitPricePerPurchaseUom: e.target.value })}
                    />
                  </div>
                  <Button
                    data-testid="button-add-line"
                    onClick={handleAddLine}
                    disabled={addLineMutation.isPending}
                  >
                    {addLineMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <Plus className="mr-2 h-4 w-4" />
                    Agregar
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={receiveOpen} onOpenChange={(open) => { if (!open) setReceiveOpen(false); }}>
          <DialogContent className="max-w-2xl" data-testid="dialog-receive">
            <DialogHeader>
              <DialogTitle>Recibir OC #{selectedPoId}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <Table data-testid="table-receive-lines">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Artículo</TableHead>
                      <TableHead>Cant. Recibida</TableHead>
                      <TableHead>Precio Unit.</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiveLines.map((rl) => {
                      const line = poLines?.find((l) => l.id === rl.poLineId);
                      return (
                        <TableRow key={rl.poLineId} data-testid={`row-receive-${rl.poLineId}`}>
                          <TableCell data-testid={`text-receive-item-${rl.poLineId}`}>
                            {line?.invItemName || line?.itemName || line?.itemSku || (line ? itemMap.get(line.invItemId)?.name : "") || `Línea #${rl.poLineId}`}
                          </TableCell>
                          <TableCell>
                            <Input
                              data-testid={`input-receive-qty-${rl.poLineId}`}
                              type="number"
                              step="0.01"
                              value={rl.qtyPurchaseUomReceived}
                              onChange={(e) => updateReceiveLine(rl.poLineId, "qtyPurchaseUomReceived", parseFloat(e.target.value) || 0)}
                              className="w-28"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              data-testid={`input-receive-price-${rl.poLineId}`}
                              type="number"
                              step="0.01"
                              value={rl.unitPricePerPurchaseUom}
                              onChange={(e) => updateReceiveLine(rl.poLineId, "unitPricePerPurchaseUom", parseFloat(e.target.value) || 0)}
                              className="w-28"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-1">
                <Label>Nota (opcional)</Label>
                <Input
                  data-testid="input-receive-note"
                  value={receiveNote}
                  onChange={(e) => setReceiveNote(e.target.value)}
                  placeholder="Nota de recepción"
                />
              </div>
              <div className="flex justify-end gap-2 flex-wrap">
                <Button variant="outline" data-testid="button-cancel-receive" onClick={() => setReceiveOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  data-testid="button-confirm-receive"
                  onClick={handleReceive}
                  disabled={receiveMutation.isPending}
                >
                  {receiveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirmar Recepción
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  const suggestionsCount = suggestions?.length || 0;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title" data-testid="text-po-title">Órdenes de Compra</h1>
        <Button data-testid="button-create-po" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva OC
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-po">
          <TabsTrigger value="orders" data-testid="tab-orders">Órdenes</TabsTrigger>
          <TabsTrigger value="suggestions" data-testid="tab-suggestions" className="gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Sugeridos
            {suggestionsCount > 0 && (
              <Badge variant="destructive" className="ml-1" data-testid="badge-suggestions-count">
                {suggestionsCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Lista de Órdenes</CardTitle>
            </CardHeader>
            <CardContent>
              {ordersLoading ? (
                <div className="flex justify-center p-4" data-testid="loading-pos">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !orders || orders.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-pos">
                  No hay órdenes de compra.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="table-pos">
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Proveedor</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Entrega Esperada</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((po) => (
                        <TableRow
                          key={po.id}
                          className="cursor-pointer hover-elevate"
                          data-testid={`row-po-${po.id}`}
                          onClick={() => setSelectedPoId(po.id)}
                        >
                          <TableCell data-testid={`text-po-id-${po.id}`}>{po.id}</TableCell>
                          <TableCell data-testid={`text-po-supplier-${po.id}`}>
                            {po.supplierName || supplierMap.get(po.supplierId) || `ID ${po.supplierId}`}
                          </TableCell>
                          <TableCell data-testid={`badge-po-status-${po.id}`}>
                            <Badge className={statusBadgeClass(po.status)} style={statusBadgeStyle(po.status)}>
                              {statusConfig[po.status]?.label || po.status}
                            </Badge>
                          </TableCell>
                          <TableCell data-testid={`text-po-date-${po.id}`}>
                            {new Date(po.createdAt).toLocaleDateString("es-CR")}
                          </TableCell>
                          <TableCell data-testid={`text-po-expected-${po.id}`}>
                            {po.expectedDeliveryDate || "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suggestions">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-lg">Artículos bajo punto de reorden</CardTitle>
              {selectedSuggestions.size > 0 && (
                <Button
                  data-testid="button-create-po-from-suggestions"
                  onClick={handleCreatePoFromSuggestions}
                  disabled={createPoFromSuggestionsMutation.isPending}
                >
                  {createPoFromSuggestionsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  Crear OC ({selectedSuggestions.size})
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {suggestionsLoading ? (
                <div className="flex justify-center p-4" data-testid="loading-suggestions">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !suggestions || suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="text-no-suggestions">
                  Todos los artículos están por encima del punto de reorden.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table data-testid="table-suggestions">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"></TableHead>
                        <TableHead>Artículo</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Punto Reorden</TableHead>
                        <TableHead>Déficit</TableHead>
                        <TableHead>Proveedor</TableHead>
                        <TableHead>Últ. Precio</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {suggestions.map((s) => (
                        <TableRow key={s.invItemId} data-testid={`row-suggestion-${s.invItemId}`}>
                          <TableCell>
                            <Checkbox
                              data-testid={`checkbox-suggestion-${s.invItemId}`}
                              checked={selectedSuggestions.has(s.invItemId)}
                              onCheckedChange={() => toggleSuggestion(s.invItemId)}
                              disabled={!s.preferredSupplier}
                            />
                          </TableCell>
                          <TableCell data-testid={`text-suggestion-name-${s.invItemId}`}>{s.itemName}</TableCell>
                          <TableCell data-testid={`text-suggestion-sku-${s.invItemId}`}>{s.itemSku}</TableCell>
                          <TableCell data-testid={`text-suggestion-uom-${s.invItemId}`}>{s.baseUom}</TableCell>
                          <TableCell data-testid={`text-suggestion-stock-${s.invItemId}`}>
                            <span className="text-destructive font-medium">{Number(s.stockQtyOnHand).toFixed(2)}</span>
                          </TableCell>
                          <TableCell data-testid={`text-suggestion-reorder-${s.invItemId}`}>
                            {Number(s.reorderPointQtyBase).toFixed(2)}
                          </TableCell>
                          <TableCell data-testid={`text-suggestion-deficit-${s.invItemId}`}>
                            <span className="font-medium">{Number(s.deficit).toFixed(2)}</span>
                          </TableCell>
                          <TableCell data-testid={`text-suggestion-supplier-${s.invItemId}`}>
                            {s.preferredSupplier?.supplierName || (
                              <span className="text-muted-foreground text-xs">Sin proveedor</span>
                            )}
                          </TableCell>
                          <TableCell data-testid={`text-suggestion-price-${s.invItemId}`}>
                            {s.preferredSupplier ? Number(s.preferredSupplier.lastPrice).toFixed(2) : "-"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false); }}>
        <DialogContent data-testid="dialog-create-po">
          <DialogHeader>
            <DialogTitle>Nueva Orden de Compra</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Proveedor *</Label>
              <Select value={newPo.supplierId} onValueChange={(v) => setNewPo({ ...newPo, supplierId: v })}>
                <SelectTrigger data-testid="select-po-supplier">
                  <SelectValue placeholder="Seleccionar proveedor" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers?.filter((s) => s.isActive !== false).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)} data-testid={`option-supplier-${s.id}`}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Fecha esperada de entrega</Label>
              <Input
                data-testid="input-po-expected-date"
                type="date"
                value={newPo.expectedDeliveryDate}
                onChange={(e) => setNewPo({ ...newPo, expectedDeliveryDate: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Notas</Label>
              <Input
                data-testid="input-po-notes"
                value={newPo.notes}
                onChange={(e) => setNewPo({ ...newPo, notes: e.target.value })}
                placeholder="Notas opcionales"
              />
            </div>
            <div className="flex justify-end gap-2 flex-wrap">
              <Button variant="outline" data-testid="button-cancel-po" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button
                data-testid="button-save-po"
                onClick={handleCreatePo}
                disabled={createPoMutation.isPending}
              >
                {createPoMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Crear OC
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
