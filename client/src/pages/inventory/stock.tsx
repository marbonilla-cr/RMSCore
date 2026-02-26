import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, Pencil } from "lucide-react";

type StockRow = {
  id: number;
  invItemId: number;
  locationId: number;
  organizationId: number;
  qtyOnHand: string;
  updatedAt: string | null;
  itemName: string;
  itemSku: string;
  baseUom: string;
};

type InvItem = {
  id: number;
  sku: string;
  name: string;
  itemType: string;
  baseUom: string;
};

export default function StockPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("ap");
  const [adjustDialog, setAdjustDialog] = useState<{ open: boolean; type: "ap" | "ep"; invItemId?: number; itemName?: string }>({ open: false, type: "ap" });
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string>("");

  const { data: stockAp, isLoading: loadingAp } = useQuery<StockRow[]>({
    queryKey: ["/api/inv/stock/ap"],
  });

  const { data: stockEp, isLoading: loadingEp } = useQuery<StockRow[]>({
    queryKey: ["/api/inv/stock/ep"],
  });

  const { data: apItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items", { type: "AP" }],
    queryFn: async () => {
      const res = await fetch("/api/inv/items?type=AP");
      return res.json();
    },
  });

  const { data: epItems } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items", { type: "EP" }],
    queryFn: async () => {
      const res = await fetch("/api/inv/items?type=EP");
      return res.json();
    },
  });

  const adjustMutation = useMutation({
    mutationFn: async (data: { type: "ap" | "ep"; invItemId: number; qtyDelta: string; reason: string }) => {
      const url = data.type === "ap" ? "/api/inv/stock/ap/adjust" : "/api/inv/stock/ep/adjust";
      const res = await apiRequest("POST", url, {
        invItemId: data.invItemId,
        qtyDelta: data.qtyDelta,
        reason: data.reason,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/stock/ap"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inv/stock/ep"] });
      toast({ title: "Ajuste aplicado" });
      closeAdjustDialog();
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openAdjustDialog = (type: "ap" | "ep", invItemId?: number, itemName?: string) => {
    setAdjustDialog({ open: true, type, invItemId, itemName });
    setAdjustQty("");
    setAdjustReason("");
    setSelectedItemId(invItemId ? String(invItemId) : "");
  };

  const closeAdjustDialog = () => {
    setAdjustDialog({ open: false, type: "ap" });
    setAdjustQty("");
    setAdjustReason("");
    setSelectedItemId("");
  };

  const handleAdjust = () => {
    const itemId = adjustDialog.invItemId || Number(selectedItemId);
    if (!itemId || !adjustQty || Number(adjustQty) === 0) return;
    adjustMutation.mutate({
      type: adjustDialog.type,
      invItemId: itemId,
      qtyDelta: adjustQty,
      reason: adjustReason,
    });
  };

  const renderStockTable = (data: StockRow[] | undefined, loading: boolean, type: "ap" | "ep") => {
    if (loading) {
      return (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      );
    }
    if (!data || data.length === 0) {
      return (
        <Card className="p-6 text-center">
          <Package className="w-10 h-10 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground" data-testid={`text-empty-stock-${type}`}>
            No hay stock {type.toUpperCase()} registrado
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => openAdjustDialog(type)}
            data-testid={`button-adjust-${type}-empty`}
          >
            Ajustar Stock
          </Button>
        </Card>
      );
    }
    return (
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Insumo</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>UOM</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Actualizado</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(row => (
              <TableRow key={row.id} data-testid={`row-stock-${type}-${row.invItemId}`}>
                <TableCell className="font-medium" data-testid={`text-stock-name-${type}-${row.invItemId}`}>
                  {row.itemName}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">{row.itemSku}</TableCell>
                <TableCell>{row.baseUom}</TableCell>
                <TableCell className="text-right font-mono" data-testid={`text-stock-qty-${type}-${row.invItemId}`}>
                  {Number(row.qtyOnHand).toFixed(2)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.updatedAt ? new Date(row.updatedAt).toLocaleString("es-CR", { dateStyle: "short", timeStyle: "short" }) : "-"}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openAdjustDialog(type, row.invItemId, row.itemName)}
                    data-testid={`button-adjust-${type}-${row.invItemId}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  };

  const itemsList = adjustDialog.type === "ap" ? apItems : epItems;

  return (
    <div style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h1 style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--f-disp)" }} data-testid="text-page-title">
          Stock
        </h1>
        <Button
          variant="outline"
          onClick={() => openAdjustDialog(activeTab as "ap" | "ep")}
          data-testid="button-adjust-stock"
        >
          <Pencil className="w-4 h-4 mr-1" /> Ajustar
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="ap" data-testid="tab-stock-ap">Stock AP</TabsTrigger>
          <TabsTrigger value="ep" data-testid="tab-stock-ep">Stock EP</TabsTrigger>
        </TabsList>
        <TabsContent value="ap">
          {renderStockTable(stockAp, loadingAp, "ap")}
        </TabsContent>
        <TabsContent value="ep">
          {renderStockTable(stockEp, loadingEp, "ep")}
        </TabsContent>
      </Tabs>

      <Dialog open={adjustDialog.open} onOpenChange={v => !v && closeAdjustDialog()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ajuste de Stock {adjustDialog.type.toUpperCase()}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {adjustDialog.invItemId ? (
              <div>
                <Label>Insumo</Label>
                <p className="text-sm font-medium" data-testid="text-adjust-item-name">{adjustDialog.itemName}</p>
              </div>
            ) : (
              <div>
                <Label>Seleccionar Insumo</Label>
                <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                  <SelectTrigger data-testid="select-adjust-item">
                    <SelectValue placeholder="Seleccionar..." />
                  </SelectTrigger>
                  <SelectContent>
                    {itemsList?.map(item => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {item.name} ({item.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Delta de cantidad (+ o -)</Label>
              <Input
                type="number"
                step="0.01"
                value={adjustQty}
                onChange={e => setAdjustQty(e.target.value)}
                placeholder="Ej: 5 o -3"
                data-testid="input-adjust-qty"
              />
            </div>
            <div>
              <Label>Razón</Label>
              <Textarea
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="Razón del ajuste..."
                data-testid="input-adjust-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAdjustDialog} data-testid="button-cancel-adjust">
              Cancelar
            </Button>
            <Button
              onClick={handleAdjust}
              disabled={(!adjustDialog.invItemId && !selectedItemId) || !adjustQty || Number(adjustQty) === 0 || adjustMutation.isPending}
              data-testid="button-confirm-adjust"
            >
              {adjustMutation.isPending ? "Procesando..." : "Aplicar Ajuste"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
