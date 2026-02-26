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
  AlertTriangle,
  Bell,
} from "lucide-react";

type BasicItem = {
  id: number;
  name: string;
  productCode: string;
  categoryId: number;
  categoryName: string | null;
  parentCategoryCode: string | null;
  availablePortions: number | null;
  reorderPoint: number | null;
  reorderAlert: boolean;
  active: boolean;
  price: string;
  status: "ILIMITADO" | "DISPONIBLE" | "AGOTADO";
};

type DialogMode = "qty" | "reorder";

export default function InventoryBasicPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dialogItem, setDialogItem] = useState<BasicItem | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>("qty");
  const [dialogInput, setDialogInput] = useState("");

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
    mutationFn: async (body: { productId: number; action: string; value?: number | null }) => {
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

  const reorderCount = useMemo(() => items.filter(i => i.reorderAlert).length, [items]);

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
      if (statusFilter === "REPONER" && !item.reorderAlert) return false;
      return true;
    });
  }, [items, search, categoryFilter, statusFilter]);

  const handleAction = (productId: number, action: string, value?: number | null) => {
    mutation.mutate({ productId, action, value });
  };

  const handleDialogConfirm = () => {
    if (!dialogItem) return;
    if (dialogMode === "qty") {
      const qty = parseInt(dialogInput);
      if (isNaN(qty) || qty < 0) {
        toast({ title: "Error", description: "Ingrese un número válido", variant: "destructive" });
        return;
      }
      handleAction(dialogItem.id, "SET", qty);
    } else {
      if (dialogInput.trim() === "") {
        handleAction(dialogItem.id, "SET_REORDER", null);
      } else {
        const rp = parseInt(dialogInput);
        if (isNaN(rp) || rp < 0) {
          toast({ title: "Error", description: "Ingrese un número válido", variant: "destructive" });
          return;
        }
        handleAction(dialogItem.id, "SET_REORDER", rp);
      }
    }
    setDialogItem(null);
    setDialogInput("");
  };

  const openQtyDialog = (item: BasicItem) => {
    setDialogItem(item);
    setDialogMode("qty");
    setDialogInput(item.availablePortions?.toString() || "");
  };

  const openReorderDialog = (item: BasicItem) => {
    setDialogItem(item);
    setDialogMode("reorder");
    setDialogInput(item.reorderPoint?.toString() || "");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const statusBadge = (item: BasicItem) => {
    const badges = [];
    if (item.status === "ILIMITADO") {
      badges.push(<Badge key="s" data-testid={`badge-status-${item.id}`} className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 text-xs"><Infinity size={12} className="mr-1" />Ilimitado</Badge>);
    } else if (item.status === "AGOTADO") {
      badges.push(<Badge key="s" data-testid={`badge-status-${item.id}`} variant="destructive" className="text-xs">Agotado</Badge>);
    } else {
      badges.push(<Badge key="s" data-testid={`badge-status-${item.id}`} className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0 text-xs">{item.availablePortions}</Badge>);
    }
    if (item.reorderAlert && item.status !== "AGOTADO") {
      badges.push(<Badge key="r" data-testid={`badge-reorder-${item.id}`} className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-xs ml-1"><AlertTriangle size={10} className="mr-1" />Reponer</Badge>);
    }
    if (!item.active && item.status !== "AGOTADO") {
      badges.push(<Badge key="i" variant="outline" className="text-xs ml-1">Inactivo</Badge>);
    }
    return <>{badges}</>;
  };

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "16px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <Package size={22} style={{ color: "var(--acc)" }} />
        <h1 data-testid="text-page-title" style={{ fontFamily: "var(--f-disp)", fontSize: 20, fontWeight: 800, color: "var(--text)" }}>
          Inventario Básico
        </h1>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle size={16} className="text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[280px] text-sm">
            <p className="font-semibold mb-1">Control de porciones</p>
            <p>• <strong>Vacío</strong> = Ilimitado (nunca se agota)</p>
            <p>• Se descuenta al enviar a cocina (status SENT)</p>
            <p>• Cuando llega a 0, se desactiva y desaparece del menú QR</p>
            <p>• <strong>Punto de reorden</strong>: alerta cuando las porciones bajan del mínimo</p>
          </TooltipContent>
        </Tooltip>
        {reorderCount > 0 && (
          <Button
            data-testid="button-filter-reorder"
            variant={statusFilter === "REPONER" ? "default" : "outline"}
            size="sm"
            className="ml-auto h-8 gap-1"
            onClick={() => setStatusFilter(statusFilter === "REPONER" ? "ALL" : "REPONER")}
          >
            <AlertTriangle size={14} />
            Reponer ({reorderCount})
          </Button>
        )}
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
          <SelectTrigger data-testid="select-status" className="w-[150px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos</SelectItem>
            <SelectItem value="ILIMITADO">Ilimitados</SelectItem>
            <SelectItem value="DISPONIBLE">Disponibles</SelectItem>
            <SelectItem value="AGOTADO">Agotados</SelectItem>
            <SelectItem value="REPONER">Reponer</SelectItem>
            <SelectItem value="INACTIVO">Inactivos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>
        {filtered.length} producto{filtered.length !== 1 ? "s" : ""}
      </div>

      <div className="rounded-lg border overflow-hidden" style={{ background: "var(--card)" }}>
        <div className="hidden sm:grid" style={{
          gridTemplateColumns: "1fr 90px 80px 120px 220px",
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span style={{ textAlign: "center", cursor: "help" }}>Reorden</span>
            </TooltipTrigger>
            <TooltipContent>Punto mínimo para alerta de reposición</TooltipContent>
          </Tooltip>
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
              gridTemplateColumns: "1fr 90px 80px 120px 220px",
              padding: "12px 16px",
              borderBottom: "1px solid var(--border)",
              alignItems: "center",
              opacity: item.active ? 1 : 0.5,
              background: item.reorderAlert ? "var(--destructive-bg, rgba(245,158,11,0.04))" : undefined,
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
              <span
                data-testid={`text-reorder-${item.id}`}
                style={{
                  fontSize: 13,
                  fontFamily: "var(--f-mono)",
                  color: item.reorderPoint !== null ? "var(--text2)" : "var(--text3)",
                  cursor: "pointer",
                }}
                onClick={() => openReorderDialog(item)}
              >
                {item.reorderPoint !== null ? item.reorderPoint : "—"}
              </span>
            </div>

            <div style={{ textAlign: "center", marginBottom: 8 }} className="sm:mb-0">
              {statusBadge(item)}
            </div>

            <div style={{ display: "flex", gap: 4, justifyContent: "center", flexWrap: "wrap" }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid={`button-set-${item.id}`}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openQtyDialog(item)}
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
                    data-testid={`button-reorder-${item.id}`}
                    variant={item.reorderPoint !== null ? "outline" : "ghost"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openReorderDialog(item)}
                  >
                    <Bell size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Punto de reorden</TooltipContent>
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

      <Dialog open={!!dialogItem} onOpenChange={v => { if (!v) setDialogItem(null); }}>
        <DialogContent className="max-w-[340px]">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "qty" ? "Establecer cantidad" : "Punto de reorden"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            {dialogItem?.name}
          </p>
          <Input
            data-testid="input-dialog-value"
            type="number"
            min={0}
            value={dialogInput}
            onChange={e => setDialogInput(e.target.value)}
            placeholder={dialogMode === "qty" ? "Cantidad de porciones" : "Mínimo para alerta (vacío = sin alerta)"}
            autoFocus
            onKeyDown={e => { if (e.key === "Enter") handleDialogConfirm(); }}
          />
          <p className="text-xs text-muted-foreground">
            {dialogMode === "qty"
              ? "Ingrese 0 para marcar como agotado. Use \"Limpiar\" para volver a ilimitado."
              : "Cuando las porciones disponibles bajen de este número, se mostrará alerta \"Reponer\". Dejar vacío para quitar la alerta."
            }
          </p>
          <DialogFooter>
            <Button data-testid="button-cancel-dialog" variant="outline" onClick={() => setDialogItem(null)}>Cancelar</Button>
            <Button data-testid="button-confirm-dialog" onClick={handleDialogConfirm} disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
