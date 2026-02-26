import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { wsManager } from "@/lib/ws";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Minus,
  Infinity,
  Power,
  PowerOff,
  Loader2,
  HelpCircle,
  Package,
  Hash,
} from "lucide-react";

type BasicItem = {
  id: number;
  name: string;
  productCode: string;
  categoryId: number;
  categoryName: string | null;
  parentCategoryCode: string | null;
  availablePortions: number | null;
  active: boolean;
  price: string;
  status: "ILIMITADO" | "DISPONIBLE" | "AGOTADO";
};

export default function InventoryBasicPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [setQtyDialog, setSetQtyDialog] = useState<BasicItem | null>(null);
  const [qtyInput, setQtyInput] = useState("");

  useEffect(() => {
    const unsub = wsManager.on("product_availability_changed", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/basic"] });
    });
    return unsub;
  }, []);

  const { data: items = [], isLoading } = useQuery<BasicItem[]>({
    queryKey: ["/api/inventory/basic"],
  });

  const mutation = useMutation({
    mutationFn: async (body: { productId: number; action: string; value?: number }) => {
      const res = await apiRequest("POST", "/api/inventory/basic/update", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/basic"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach(i => { if (i.categoryName) cats.add(i.categoryName); });
    return Array.from(cats).sort();
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter(item => {
      if (search) {
        const q = search.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !item.productCode.toLowerCase().includes(q)) return false;
      }
      if (categoryFilter !== "ALL" && item.categoryName !== categoryFilter) return false;
      if (statusFilter === "ILIMITADO" && item.status !== "ILIMITADO") return false;
      if (statusFilter === "DISPONIBLE" && item.status !== "DISPONIBLE") return false;
      if (statusFilter === "AGOTADO" && item.status !== "AGOTADO") return false;
      if (statusFilter === "INACTIVO" && item.active) return false;
      return true;
    });
  }, [items, search, categoryFilter, statusFilter]);

  const handleAction = (productId: number, action: string, value?: number) => {
    mutation.mutate({ productId, action, value });
  };

  const handleSetQty = () => {
    if (!setQtyDialog) return;
    const qty = parseInt(qtyInput);
    if (isNaN(qty) || qty < 0) {
      toast({ title: "Error", description: "Ingrese un número válido", variant: "destructive" });
      return;
    }
    handleAction(setQtyDialog.id, "SET", qty);
    setSetQtyDialog(null);
    setQtyInput("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusBadge = (item: BasicItem) => {
    if (item.status === "ILIMITADO") {
      return <Badge data-testid={`badge-status-${item.id}`} className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-xs"><Infinity size={12} className="mr-1" />Ilimitado</Badge>;
    }
    if (item.status === "AGOTADO") {
      return <Badge data-testid={`badge-status-${item.id}`} variant="destructive" className="text-xs">Agotado</Badge>;
    }
    return <Badge data-testid={`badge-status-${item.id}`} className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0 text-xs">{item.availablePortions}</Badge>;
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Package size={22} style={{ color: "var(--acc)" }} />
        <h1 style={{ fontFamily: "var(--f-disp)", fontSize: 20, fontWeight: 800, color: "var(--text)" }}>
          Inventario Básico
        </h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle size={16} className="text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[260px] text-sm">
            <p className="font-semibold mb-1">Control de porciones</p>
            <p>• <strong>Vacío</strong> = Ilimitado (nunca se agota)</p>
            <p>• Cantidad se descuenta automáticamente al enviar a cocina</p>
            <p>• Cuando llega a 0, el producto se desactiva y desaparece del menú QR</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 180px", minWidth: 150 }}>
          <Search size={16} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text3)" }} />
          <Input
            data-testid="input-search"
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger data-testid="select-category" className="w-[160px]">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas</SelectItem>
            {categories.map(c => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger data-testid="select-status" className="w-[140px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos</SelectItem>
            <SelectItem value="ILIMITADO">Ilimitados</SelectItem>
            <SelectItem value="DISPONIBLE">Disponibles</SelectItem>
            <SelectItem value="AGOTADO">Agotados</SelectItem>
            <SelectItem value="INACTIVO">Inactivos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
        {filtered.length} producto{filtered.length !== 1 ? "s" : ""}
      </div>

      <div className="rounded-lg border overflow-hidden" style={{ background: "var(--card)" }}>
        <div className="hidden sm:grid" style={{
          gridTemplateColumns: "1fr 120px 100px 200px",
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--text3)",
        }}>
          <span>Producto</span>
          <span style={{ textAlign: "center" }}>Cantidad</span>
          <span style={{ textAlign: "center" }}>Estado</span>
          <span style={{ textAlign: "center" }}>Acciones</span>
        </div>

        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: "var(--text3)", fontSize: 14 }}>
            No se encontraron productos
          </div>
        )}

        {filtered.map(item => (
          <div
            key={item.id}
            data-testid={`row-product-${item.id}`}
            className="sm:grid"
            style={{
              gridTemplateColumns: "1fr 120px 100px 200px",
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              alignItems: "center",
              opacity: item.active ? 1 : 0.5,
            }}
          >
            <div style={{ marginBottom: 8 }} className="sm:mb-0">
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "var(--f-body)" }}>
                {item.name}
              </div>
              <div style={{ fontSize: 11, color: "var(--text3)" }}>
                {item.categoryName || "Sin categoría"} • ₡{Number(item.price).toLocaleString()}
              </div>
            </div>

            <div style={{ textAlign: "center", marginBottom: 8 }} className="sm:mb-0">
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--f-mono)", color: "var(--text)" }}>
                {item.availablePortions === null ? "∞" : item.availablePortions}
              </span>
            </div>

            <div style={{ textAlign: "center", marginBottom: 8 }} className="sm:mb-0">
              {statusBadge(item)}
              {!item.active && item.status !== "AGOTADO" && (
                <Badge variant="outline" className="text-xs ml-1">Inactivo</Badge>
              )}
            </div>

            <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid={`button-set-${item.id}`}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => { setSetQtyDialog(item); setQtyInput(item.availablePortions?.toString() || ""); }}
                  >
                    <Hash size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Establecer cantidad</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid={`button-plus-${item.id}`}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      if (item.availablePortions === null) {
                        toast({ title: "Info", description: "Producto ilimitado. Establezca una cantidad primero." });
                        return;
                      }
                      handleAction(item.id, "ADJUST", 1);
                    }}
                  >
                    <Plus size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>+1 porción</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid={`button-minus-${item.id}`}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      if (item.availablePortions === null) {
                        toast({ title: "Info", description: "Producto ilimitado. Establezca una cantidad primero." });
                        return;
                      }
                      handleAction(item.id, "ADJUST", -1);
                    }}
                  >
                    <Minus size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>-1 porción</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid={`button-clear-${item.id}`}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleAction(item.id, "CLEAR")}
                  >
                    <Infinity size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Limpiar → Ilimitado</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid={`button-toggle-${item.id}`}
                    variant={item.active ? "outline" : "default"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleAction(item.id, item.active ? "DISABLE" : "ENABLE")}
                  >
                    {item.active ? <PowerOff size={14} /> : <Power size={14} />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{item.active ? "Desactivar" : "Activar"}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!setQtyDialog} onOpenChange={v => { if (!v) setSetQtyDialog(null); }}>
        <DialogContent className="max-w-[340px]">
          <DialogHeader>
            <DialogTitle>Establecer cantidad</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            {setQtyDialog?.name}
          </p>
          <Input
            data-testid="input-set-qty"
            type="number"
            min={0}
            value={qtyInput}
            onChange={e => setQtyInput(e.target.value)}
            placeholder="Cantidad de porciones"
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") handleSetQty(); }}
          />
          <p className="text-xs text-muted-foreground">
            Ingrese 0 para marcar como agotado. Deje vacío y use "Limpiar" para volver a ilimitado.
          </p>
          <DialogFooter>
            <Button data-testid="button-cancel-qty" variant="outline" onClick={() => setSetQtyDialog(null)}>Cancelar</Button>
            <Button data-testid="button-confirm-qty" onClick={handleSetQty} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
