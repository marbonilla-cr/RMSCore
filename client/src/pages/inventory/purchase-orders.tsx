import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";
import { Loader2, Plus, ArrowLeft, Send, PackageCheck, Trash2, AlertTriangle, ShoppingCart, Download, FileText } from "lucide-react";

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

interface ReceiptHistoryItem {
  id: number;
  receivedAt: string;
  receivedByName: string;
  note: string | null;
  lines: {
    id: number;
    invItemName: string;
    qtyPurchaseUomReceived: string;
    unitPricePerPurchaseUom: string;
    purchaseUom: string;
    qtyBaseReceived: string;
  }[];
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
  const { role } = usePermissions();
  const canViewCosts = role === "MANAGER";
  const [selectedPoId, setSelectedPoId] = useState<number | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [newLine, setNewLine] = useState({ invItemId: "", qtyPurchaseUom: "", purchaseUom: "", unitPricePerPurchaseUom: "" });
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [receiveNote, setReceiveNote] = useState("");
  const [activeTab, setActiveTab] = useState("orders");
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

  const [creatingNew, setCreatingNew] = useState(false);
  const [poSupplierId, setPOSupplierId] = useState<number | null>(null);
  const [poDeliveryDate, setPODeliveryDate] = useState("");
  const [poMode, setPOMode] = useState<"all" | "low_stock">("low_stock");
  const [poSelectedCats, setPOSelectedCats] = useState<string[]>([]);
  const [poAvailableCats, setPOAvailableCats] = useState<string[]>([]);
  const [poItems, setPOItems] = useState<any[]>([]);
  const [poItemsLoaded, setPOItemsLoaded] = useState(false);
  const [poLoadingItems, setPOLoadingItems] = useState(false);
  const [poCreating, setPOCreating] = useState(false);

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

  const { data: receiptHistory = [] } = useQuery<ReceiptHistoryItem[]>({
    queryKey: ["/api/inv/purchase-orders", selectedPoId, "receipts"],
    queryFn: () =>
      fetch(`/api/inv/purchase-orders/${selectedPoId}/receipts`, { credentials: "include" })
        .then(r => r.json()),
    enabled: selectedPoId !== null,
  });

  const supplierMap = new Map<number, string>();
  if (suppliers) {
    for (const s of suppliers) supplierMap.set(s.id, s.name);
  }

  const itemMap = new Map<number, InvItem>();
  if (items) {
    for (const i of items) itemMap.set(i.id, i);
  }

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

  const loadPOItems = async () => {
    if (!poSupplierId) return;
    setPOLoadingItems(true);
    setPOItemsLoaded(false);
    try {
      const cats = poSelectedCats.length > 0 ? `&categories=${poSelectedCats.join(",")}` : "";
      const r = await fetch(
        `/api/inv/suppliers/${poSupplierId}/items?mode=${poMode}${cats}`,
        { credentials: "include" }
      );
      if (!r.ok) throw new Error((await r.json()).message);
      const data = await r.json();
      setPOItems(data.items.map((item: any) => ({
        ...item,
        qtyOrdered: 0,
        unitPrice: item.last_price || 0,
      })));
      setPOAvailableCats(data.categories || []);
      setPOItemsLoaded(true);
    } catch (e: any) {
      toast({ title: "Error al cargar items", description: e.message, variant: "destructive" });
    } finally {
      setPOLoadingItems(false);
    }
  };

  const submitCreatePO = async () => {
    const lines = poItems.filter(i => i.qtyOrdered > 0);
    if (!poSupplierId || !poDeliveryDate || lines.length === 0) {
      toast({ title: "Complete fecha, proveedor y al menos 1 cantidad", variant: "destructive" });
      return;
    }
    setPOCreating(true);
    try {
      const poRes = await fetch("/api/inv/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          supplierId: poSupplierId,
          expectedDeliveryDate: poDeliveryDate,
          notes: "",
        }),
      });
      const po = await poRes.json();
      if (!poRes.ok) throw new Error(po.message);

      for (const item of lines) {
        const lineRes = await fetch(`/api/inv/purchase-orders/${po.id}/lines`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            invItemId: item.id,
            qtyPurchaseUom: item.qtyOrdered,
            purchaseUom: item.purchase_uom,
            unitPricePerPurchaseUom: item.unitPrice,
          }),
        });
        if (!lineRes.ok) {
          const err = await lineRes.json();
          throw new Error(`Línea ${item.name}: ${err.message}`);
        }
      }

      toast({ title: "Orden de compra creada", description: `${lines.length} productos` });
      setCreatingNew(false);
      setPOSupplierId(null);
      setPODeliveryDate("");
      setPOItems([]);
      setPOItemsLoaded(false);
      setPOSelectedCats([]);
      setPOAvailableCats([]);
      queryClient.invalidateQueries({ queryKey: ["/api/inv/purchase-orders"] });
    } catch (e: any) {
      toast({ title: "Error al crear OC", description: e.message, variant: "destructive" });
    } finally {
      setPOCreating(false);
    }
  };

  const resetNewPOPanel = () => {
    setCreatingNew(false);
    setPOSupplierId(null);
    setPODeliveryDate("");
    setPOMode("low_stock");
    setPOItems([]);
    setPOItemsLoaded(false);
    setPOSelectedCats([]);
    setPOAvailableCats([]);
  };

  function handleAddLine() {
    if (!newLine.invItemId || !newLine.qtyPurchaseUom || !newLine.purchaseUom) {
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

  function handleDownloadCSV() {
    if (!poLines || !selectedPo) return;
    const BOM = "\uFEFF";
    const headers = [
      "Artículo", "Cantidad", "UOM compra", "Precio Unitario",
      "Subtotal", "Recibido (base UOM)", "Estado línea"
    ].join(",");

    const rows = poLines.map(line => {
      const qty = parseFloat(line.qtyPurchaseUom);
      const price = parseFloat(line.unitPricePerPurchaseUom);
      const subtotal = qty * price;
      return [
        line.invItemName || line.itemName || "",
        qty.toLocaleString("es-CR"),
        line.purchaseUom,
        price.toLocaleString("es-CR", { minimumFractionDigits: 2 }),
        subtotal.toLocaleString("es-CR", { minimumFractionDigits: 2 }),
        parseFloat(line.qtyBaseReceived).toLocaleString("es-CR"),
        line.lineStatus,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });

    const total = poLines.reduce(
      (s, l) => s + parseFloat(l.qtyPurchaseUom) * parseFloat(l.unitPricePerPurchaseUom), 0
    );
    const totalRow = [
      `"Total"`, `""`, `""`, `""`,
      `"${total.toLocaleString("es-CR", { minimumFractionDigits: 2 })}"`,
      `""`, `""`
    ].join(",");

    const csv = BOM + [headers, ...rows, totalRow].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `OC-${selectedPo.id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDownloadPDF() {
    if (!poLines || !selectedPo) return;
    const total = poLines.reduce(
      (s, l) => s + parseFloat(l.qtyPurchaseUom) * parseFloat(l.unitPricePerPurchaseUom), 0
    );

    const linesHtml = poLines.map(line => {
      const qty = parseFloat(line.qtyPurchaseUom);
      const price = parseFloat(line.unitPricePerPurchaseUom);
      const subtotal = qty * price;
      const received = parseFloat(line.qtyBaseReceived);
      return `<tr>
        <td>${line.invItemName || line.itemName || "—"}</td>
        <td style="text-align:center">${qty.toLocaleString("es-CR")}</td>
        <td style="text-align:center">${line.purchaseUom}</td>
        <td style="text-align:right">₡${price.toLocaleString("es-CR", { minimumFractionDigits: 2 })}</td>
        <td style="text-align:right">₡${subtotal.toLocaleString("es-CR", { minimumFractionDigits: 2 })}</td>
        <td style="text-align:center">${received.toLocaleString("es-CR")}</td>
        <td style="text-align:center">${line.lineStatus}</td>
      </tr>`;
    }).join("");

    const createdDate = selectedPo.createdAt
      ? new Date(selectedPo.createdAt).toLocaleDateString("es-CR", {
          day: "2-digit", month: "long", year: "numeric"
        })
      : "—";

    const html = `<!DOCTYPE html><html lang="es"><head>
      <meta charset="utf-8">
      <title>OC-${selectedPo.id}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 12px; margin: 32px; color: #111; }
        h2 { margin: 0 0 4px 0; font-size: 18px; }
        .meta { color: #555; margin-bottom: 20px; font-size: 11px; line-height: 1.8; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f3f4f6; padding: 7px 8px; text-align: left;
             border-bottom: 2px solid #d1d5db; font-size: 11px; font-weight: 600; }
        td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
        tfoot td { font-weight: bold; border-top: 2px solid #374151;
                   border-bottom: none; background: #f9fafb; }
        .print-btn { margin-top: 20px; padding: 8px 20px; background: #374151;
                     color: white; border: none; border-radius: 4px;
                     cursor: pointer; font-size: 13px; }
        @media print { .print-btn { display: none; } }
      </style>
    </head><body>
      <h2>Orden de Compra #${selectedPo.id}</h2>
      <div class="meta">
        <strong>Proveedor:</strong> ${selectedPo.supplierName || supplierMap.get(selectedPo.supplierId) || "—"}<br>
        <strong>Fecha:</strong> ${createdDate}<br>
        <strong>Estado:</strong> ${statusConfig[selectedPo.status]?.label || selectedPo.status}
        ${selectedPo.notes ? `<br><strong>Notas:</strong> ${selectedPo.notes}` : ""}
      </div>
      <table>
        <thead><tr>
          <th>Artículo</th>
          <th style="text-align:center">Cantidad</th>
          <th style="text-align:center">UOM</th>
          <th style="text-align:right">Precio Unit.</th>
          <th style="text-align:right">Subtotal</th>
          <th style="text-align:center">Recibido</th>
          <th style="text-align:center">Estado</th>
        </tr></thead>
        <tbody>${linesHtml}</tbody>
        <tfoot><tr>
          <td colspan="4" style="text-align:right">Total de la orden</td>
          <td style="text-align:right">
            ₡${total.toLocaleString("es-CR", { minimumFractionDigits: 2 })}
          </td>
          <td colspan="2"></td>
        </tr></tfoot>
      </table>
      <button class="print-btn" onclick="window.print()">
        Imprimir / Guardar como PDF
      </button>
    </body></html>`;

    const win = window.open("", "_blank", "width=960,height=720");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
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
                <Button
                  data-testid="button-receive-po"
                  onClick={openReceiveDialog}
                  disabled={isDraft || poStatus === "RECEIVED"}
                >
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Recibir
                </Button>
                <Button variant="outline" size="sm" data-testid="button-download-csv" onClick={handleDownloadCSV}>
                  <Download className="mr-2 h-4 w-4" />
                  Descargar CSV
                </Button>
                <Button variant="outline" size="sm" data-testid="button-download-pdf" onClick={handleDownloadPDF}>
                  <FileText className="mr-2 h-4 w-4" />
                  Descargar PDF
                </Button>
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
                      {canViewCosts && <TableHead>Precio Unit.</TableHead>}
                      {canViewCosts && <TableHead>Subtotal</TableHead>}
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
                          {canViewCosts && <TableCell data-testid={`text-line-price-${line.id}`}>{price.toFixed(2)}</TableCell>}
                          {canViewCosts && <TableCell data-testid={`text-line-subtotal-${line.id}`}>{(qty * price).toFixed(2)}</TableCell>}
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
                  {canViewCosts && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={4} className="text-right font-semibold text-sm">
                        Total de la orden
                      </TableCell>
                      <TableCell className="font-bold" data-testid="text-po-total">
                        ₡{poLines.reduce((s, l) => s + parseFloat(l.qtyPurchaseUom) * parseFloat(l.unitPricePerPurchaseUom), 0).toLocaleString("es-CR", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell colSpan={isDraft ? 3 : 2}></TableCell>
                    </TableRow>
                  </TableFooter>
                  )}
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
                  {canViewCosts && (
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
                  )}
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

        {receiveOpen && (
          <Card className="mt-4 border-primary/30" data-testid="card-receive-inline">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Recibir OC #{selectedPoId}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <Table data-testid="table-receive-lines">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Artículo</TableHead>
                        <TableHead>Cant. Recibida</TableHead>
                        {canViewCosts && <TableHead>Precio Unit.</TableHead>}
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
                            {canViewCosts && (
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
                            )}
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
            </CardContent>
          </Card>
        )}

        {receiptHistory.length > 0 && (
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                Historial de Recepciones
                <span className="bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full font-normal">
                  {receiptHistory.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {receiptHistory.map((receipt) => (
                  <div key={receipt.id} className="border rounded-lg overflow-hidden" data-testid={`receipt-${receipt.id}`}>
                    <div className="bg-muted/40 px-4 py-2.5 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-medium">
                          {new Date(receipt.receivedAt).toLocaleDateString("es-CR", {
                            day: "2-digit", month: "short", year: "numeric",
                          })}
                          {" "}
                          <span className="text-muted-foreground font-normal">
                            {new Date(receipt.receivedAt).toLocaleTimeString("es-CR", {
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </span>
                        </span>
                        <span className="text-muted-foreground">·</span>
                        <span className="text-muted-foreground text-xs">
                          Recibido por <span className="text-foreground font-medium">{receipt.receivedByName}</span>
                        </span>
                      </div>
                      {receipt.note && (
                        <span className="text-xs text-muted-foreground italic max-w-[200px] truncate">
                          "{receipt.note}"
                        </span>
                      )}
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Artículo</TableHead>
                          <TableHead className="text-center">Cantidad recibida</TableHead>
                          <TableHead className="text-center">UOM</TableHead>
                          {canViewCosts && <TableHead className="text-right">Precio unit.</TableHead>}
                          {canViewCosts && <TableHead className="text-right">Subtotal</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receipt.lines.map((line) => {
                          const qty = parseFloat(line.qtyPurchaseUomReceived);
                          const price = parseFloat(line.unitPricePerPurchaseUom);
                          return (
                            <TableRow key={line.id}>
                              <TableCell className="font-medium">{line.invItemName}</TableCell>
                              <TableCell className="text-center">{qty.toLocaleString("es-CR")}</TableCell>
                              <TableCell className="text-center text-muted-foreground">{line.purchaseUom ?? "—"}</TableCell>
                              {canViewCosts && (
                              <TableCell className="text-right">
                                ₡{price.toLocaleString("es-CR", { minimumFractionDigits: 2 })}
                              </TableCell>
                              )}
                              {canViewCosts && (
                              <TableCell className="text-right font-medium">
                                ₡{(qty * price).toLocaleString("es-CR", { minimumFractionDigits: 2 })}
                              </TableCell>
                              )}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    );
  }

  const suggestionsCount = suggestions?.length || 0;

  const poLinesWithQty = poItems.filter(i => i.qtyOrdered > 0);
  const poEstimatedTotal = poLinesWithQty.reduce((sum: number, i: any) => sum + (i.qtyOrdered * i.unitPrice), 0);

  if (creatingNew) {
    return (
      <div className="admin-page">
        <div className="admin-page-header">
          <Button variant="ghost" data-testid="button-po-back" onClick={resetNewPOPanel}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Volver
          </Button>
          <h1 className="admin-page-title" data-testid="text-new-po-title">Nueva Orden de Compra</h1>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Fecha de entrega *</Label>
                <Input
                  data-testid="input-newpo-date"
                  type="date"
                  value={poDeliveryDate}
                  onChange={(e) => setPODeliveryDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Proveedor *</Label>
                <Select
                  value={poSupplierId ? String(poSupplierId) : ""}
                  onValueChange={(v) => {
                    setPOSupplierId(parseInt(v));
                    setPOItems([]);
                    setPOItemsLoaded(false);
                    setPOSelectedCats([]);
                    setPOAvailableCats([]);
                  }}
                >
                  <SelectTrigger data-testid="select-newpo-supplier">
                    <SelectValue placeholder="Seleccionar proveedor" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers?.filter((s) => s.isActive !== false).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)} data-testid={`option-newpo-supplier-${s.id}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {poSupplierId && (
              <div className="space-y-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm whitespace-nowrap">Filtro:</Label>
                    <Select value={poMode} onValueChange={(v) => setPOMode(v as "all" | "low_stock")}>
                      <SelectTrigger className="w-[160px]" data-testid="select-newpo-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low_stock">Stock bajo</SelectItem>
                        <SelectItem value="all">Todos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    data-testid="button-newpo-load"
                    onClick={loadPOItems}
                    disabled={poLoadingItems}
                    size="sm"
                  >
                    {poLoadingItems && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Cargar Items
                  </Button>
                </div>

                {poAvailableCats.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {poAvailableCats.map((cat) => (
                      <label key={cat} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <Checkbox
                          data-testid={`check-cat-${cat}`}
                          checked={poSelectedCats.includes(cat)}
                          onCheckedChange={(checked) => {
                            setPOSelectedCats(prev =>
                              checked ? [...prev, cat] : prev.filter(c => c !== cat)
                            );
                          }}
                        />
                        {cat}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {poItemsLoaded && poItems.length === 0 && (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No se encontraron artículos con los filtros seleccionados.
              </p>
            )}

            {poItemsLoaded && poItems.length > 0 && (
              <div className="overflow-x-auto border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="text-right w-[80px]">Stock</TableHead>
                      <TableHead className="text-right w-[80px]">Reorden</TableHead>
                      <TableHead className="w-[100px]">UOM</TableHead>
                      <TableHead className="w-[100px]">Cantidad</TableHead>
                      {canViewCosts && <TableHead className="w-[110px]">Precio ₡</TableHead>}
                      {canViewCosts && <TableHead className="text-right w-[100px]">Subtotal</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {poItems.map((item: any, idx: number) => {
                      const isLow = item.reorder_point_qty_base != null &&
                        item.on_hand_qty_base < item.reorder_point_qty_base;
                      return (
                        <TableRow
                          key={item.id}
                          className={isLow ? "bg-amber-50 dark:bg-amber-950/30" : ""}
                          data-testid={`row-newpo-item-${item.id}`}
                        >
                          <TableCell>
                            <div className="font-medium text-sm">{item.name}</div>
                            <div className="text-xs text-muted-foreground">{item.sku} · {item.category}</div>
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {Math.round(item.on_hand_qty_base)} {item.base_uom}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {item.reorder_point_qty_base != null ? `${Math.round(item.reorder_point_qty_base)} ${item.base_uom}` : "—"}
                          </TableCell>
                          <TableCell className="text-sm">{item.purchase_uom}</TableCell>
                          <TableCell>
                            <Input
                              data-testid={`input-newpo-qty-${item.id}`}
                              type="number"
                              min="0"
                              step="1"
                              className="h-8 w-[80px]"
                              value={item.qtyOrdered || ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPOItems(prev => prev.map((p, i) =>
                                  i === idx ? { ...p, qtyOrdered: val } : p
                                ));
                              }}
                            />
                          </TableCell>
                          {canViewCosts && (
                          <TableCell>
                            <Input
                              data-testid={`input-newpo-price-${item.id}`}
                              type="number"
                              min="0"
                              step="0.01"
                              className="h-8 w-[90px]"
                              value={item.unitPrice || ""}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setPOItems(prev => prev.map((p, i) =>
                                  i === idx ? { ...p, unitPrice: val } : p
                                ));
                              }}
                            />
                          </TableCell>
                          )}
                          {canViewCosts && (
                          <TableCell className="text-right text-sm font-medium">
                            {item.qtyOrdered > 0 ? formatCurrency(item.qtyOrdered * item.unitPrice) : "—"}
                          </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {poItemsLoaded && poItems.length > 0 && (
              <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t">
                <div className="text-sm text-muted-foreground" data-testid="text-newpo-summary">
                  {poLinesWithQty.length} producto{poLinesWithQty.length !== 1 ? "s" : ""}
                  {canViewCosts && ` · Total estimado: ${formatCurrency(poEstimatedTotal)}`}
                </div>
                <Button
                  data-testid="button-newpo-submit"
                  onClick={submitCreatePO}
                  disabled={poCreating || poLinesWithQty.length === 0 || !poDeliveryDate}
                >
                  {poCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Crear OC ({poLinesWithQty.length})
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title" data-testid="text-po-title">Órdenes de Compra</h1>
        <Button data-testid="button-create-po" onClick={() => setCreatingNew(true)}>
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
                        {canViewCosts && <TableHead>Últ. Precio</TableHead>}
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
                          {canViewCosts && (
                          <TableCell data-testid={`text-suggestion-price-${s.invItemId}`}>
                            {s.preferredSupplier ? Number(s.preferredSupplier.lastPrice).toFixed(2) : "-"}
                          </TableCell>
                          )}
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

    </div>
  );
}
