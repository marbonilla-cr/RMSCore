import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Grid3x3, Clock, ChefHat, AlertCircle, Users, DollarSign, Timer } from "lucide-react";
import { wsManager } from "@/lib/ws";

interface TableView {
  id: number;
  tableCode: string;
  tableName: string;
  active: boolean;
  hasOpenOrder: boolean;
  orderId: number | null;
  orderStatus: string | null;
  responsibleWaiterName: string | null;
  openedAt: string | null;
  pendingQrCount: number;
  itemCount: number;
  totalAmount: string | null;
  lastSentToKitchenAt: string | null;
}

function formatElapsed(dateStr: string | null) {
  if (!dateStr) return "--";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

type ColumnKey = "waiter" | "items" | "amount" | "time";

const COLUMN_OPTIONS: { key: ColumnKey; label: string }[] = [
  { key: "waiter", label: "Salonero" },
  { key: "items", label: "Items" },
  { key: "amount", label: "Monto" },
  { key: "time", label: "Tiempo" },
];

export default function TablesPage() {
  const { toast } = useToast();
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    () => new Set<ColumnKey>(["waiter", "items", "amount", "time"])
  );

  const { data: tables = [], isLoading } = useQuery<TableView[]>({
    queryKey: ["/api/waiter/tables"],
    refetchInterval: 15000,
  });

  useEffect(() => {
    wsManager.connect();
    const unsubs = [
      wsManager.on("table_status_changed", () => {
        queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      }),
      wsManager.on("qr_submission_created", (p: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
        toast({
          title: "Nueva orden QR",
          description: p?.tableName ? `Nueva orden QR en ${p.tableName}` : "Un cliente ha enviado un pedido QR",
        });
      }),
      wsManager.on("order_updated", () => {
        queryClient.invalidateQueries({ queryKey: ["/api/waiter/tables"] });
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [toast]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getStatusColor = (t: TableView) => {
    if (t.pendingQrCount > 0) return "ring-2 ring-orange-500";
    if (t.orderStatus === "IN_KITCHEN") return "ring-2 ring-blue-500";
    if (t.hasOpenOrder) return "ring-2 ring-green-500";
    return "";
  };

  const getStatusLabel = (t: TableView) => {
    if (t.pendingQrCount > 0) return "QR Pendiente";
    if (!t.hasOpenOrder) return "Libre";
    return t.orderStatus || "Abierta";
  };

  const getStatusVariant = (t: TableView): "default" | "secondary" | "destructive" => {
    if (t.pendingQrCount > 0) return "destructive";
    if (!t.hasOpenOrder) return "secondary";
    return "default";
  };

  if (isLoading) {
    return (
      <div className="p-3 md:p-6">
        <h1 className="text-lg md:text-2xl font-bold mb-4 flex items-center gap-2">
          <Grid3x3 className="w-5 h-5" /> Mesas
        </h1>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-20 md:h-28 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 md:p-6">
      <div className="mb-4">
        <h1 className="text-lg md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <Grid3x3 className="w-5 h-5 md:w-6 md:h-6" /> Mesas
        </h1>
        <p className="text-xs md:text-sm text-muted-foreground mt-1">
          {tables.filter((t) => t.hasOpenOrder).length} de {tables.length} mesas ocupadas
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="column-selector">
        <span className="text-xs md:text-sm text-muted-foreground mr-1">Mostrar:</span>
        {COLUMN_OPTIONS.map((col) => (
          <Button
            key={col.key}
            variant={visibleColumns.has(col.key) ? "default" : "outline"}
            size="sm"
            onClick={() => toggleColumn(col.key)}
            className="toggle-elevate"
            data-testid={`toggle-column-${col.key}`}
          >
            {col.label}
          </Button>
        ))}
      </div>

      {tables.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Grid3x3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay mesas configuradas. Configure mesas en Admin.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
          {tables.filter(t => t.active).map((table) => (
            <Link key={table.id} href={`/tables/${table.id}`}>
              <Card
                className={`hover-elevate cursor-pointer transition-colors ${getStatusColor(table)}`}
                data-testid={`card-table-${table.id}`}
              >
                <CardContent className="p-2.5 md:p-4">
                  <div className="flex items-start justify-between gap-1 mb-1.5 md:mb-3">
                    <h3 className="font-bold text-sm md:text-lg truncate" data-testid={`text-table-name-${table.id}`}>
                      {table.tableName}
                    </h3>
                    <Badge variant={getStatusVariant(table)} className="text-[10px] md:text-xs shrink-0" data-testid={`badge-status-${table.id}`}>
                      {table.pendingQrCount > 0 && <AlertCircle className="w-2.5 h-2.5 mr-0.5" />}
                      {getStatusLabel(table)}
                    </Badge>
                  </div>

                  {table.hasOpenOrder ? (
                    <div className="space-y-1 md:space-y-2">
                      {visibleColumns.has("waiter") && table.responsibleWaiterName && (
                        <div className="flex items-center justify-between text-xs md:text-sm" data-testid={`text-waiter-${table.id}`}>
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            <span className="hidden sm:inline">Salonero</span>
                          </span>
                          <span className="font-medium truncate ml-1">{table.responsibleWaiterName}</span>
                        </div>
                      )}

                      {visibleColumns.has("items") && (
                        <div className="flex items-center justify-between text-xs md:text-sm" data-testid={`text-items-${table.id}`}>
                          <span className="text-muted-foreground flex items-center gap-1">
                            <ChefHat className="w-3 h-3" />
                            <span className="hidden sm:inline">Items</span>
                          </span>
                          <span className="font-medium">{table.itemCount}</span>
                        </div>
                      )}

                      {visibleColumns.has("time") && (
                        <>
                          <div className="flex items-center justify-between text-xs md:text-sm" data-testid={`text-time-open-${table.id}`}>
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span className="hidden sm:inline">T. abierta</span>
                            </span>
                            <span className="font-medium">{formatElapsed(table.openedAt)}</span>
                          </div>
                          <div className="flex items-center justify-between text-xs md:text-sm" data-testid={`text-time-kitchen-${table.id}`}>
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Timer className="w-3 h-3" />
                              <span className="hidden sm:inline">T. cocina</span>
                            </span>
                            <span className="font-medium">{formatElapsed(table.lastSentToKitchenAt)}</span>
                          </div>
                        </>
                      )}

                      {visibleColumns.has("amount") && table.totalAmount && (
                        <div className="pt-1 md:pt-2 border-t">
                          <div className="flex items-center justify-between" data-testid={`text-amount-${table.id}`}>
                            <span className="text-xs text-muted-foreground">Total</span>
                            <span className="font-bold text-xs md:text-sm">₡{Number(table.totalAmount).toLocaleString()}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs md:text-sm text-muted-foreground">Disponible</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
