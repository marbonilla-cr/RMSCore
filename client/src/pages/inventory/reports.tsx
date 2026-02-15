import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ValueItem {
  sku: string;
  name: string;
  category: string;
  onHand: number;
  baseUom: string;
  avgCost: number;
  totalValue: number;
}

interface LowStockItem {
  sku: string;
  name: string;
  category: string;
  onHand: number;
  reorderPoint: number;
  baseUom: string;
}

function fmt(n: number): string {
  return "₡" + n.toLocaleString("es-CR", { minimumFractionDigits: 2 });
}

export default function InventoryReportsPage() {
  const [activeTab, setActiveTab] = useState<"value" | "lowstock">("value");

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold" data-testid="text-inv-reports-title">Reportes de Inventario</h1>

      <div className="flex gap-2">
        <Button
          variant={activeTab === "value" ? "default" : "outline"}
          data-testid="button-tab-value"
          onClick={() => setActiveTab("value")}
        >
          Valoración
        </Button>
        <Button
          variant={activeTab === "lowstock" ? "default" : "outline"}
          data-testid="button-tab-lowstock"
          onClick={() => setActiveTab("lowstock")}
        >
          Stock Bajo
        </Button>
      </div>

      {activeTab === "value" ? <ValueTab /> : <LowStockTab />}
    </div>
  );
}

function ValueTab() {
  const { data, isLoading } = useQuery<ValueItem[]>({
    queryKey: ["/api/inv/reports/value"],
  });

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [data]);

  const grouped = useMemo(() => {
    const map = new Map<string, { items: ValueItem[]; subtotal: number }>();
    for (const item of sorted) {
      const g = map.get(item.category);
      if (g) {
        g.items.push(item);
        g.subtotal += item.totalValue;
      } else {
        map.set(item.category, { items: [item], subtotal: item.totalValue });
      }
    }
    return map;
  }, [sorted]);

  const grandTotal = useMemo(() => sorted.reduce((s, i) => s + i.totalValue, 0), [sorted]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Valor Total del Inventario</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-value">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <p className="text-3xl font-bold" data-testid="text-grand-total-value">{fmt(grandTotal)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detalle por Categoría</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-value-table">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : sorted.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead className="text-right">Existencia</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Costo Prom.</TableHead>
                    <TableHead className="text-right">Valor Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from(grouped.entries()).map(([category, group]) => (
                    <>
                      {group.items.map((item) => (
                        <TableRow key={item.sku} data-testid={`row-value-${item.sku}`}>
                          <TableCell data-testid={`text-sku-${item.sku}`}>{item.sku}</TableCell>
                          <TableCell data-testid={`text-name-${item.sku}`}>{item.name}</TableCell>
                          <TableCell data-testid={`text-category-${item.sku}`}>{item.category}</TableCell>
                          <TableCell className="text-right" data-testid={`text-onhand-${item.sku}`}>
                            {item.onHand.toLocaleString("es-CR")}
                          </TableCell>
                          <TableCell data-testid={`text-uom-${item.sku}`}>{item.baseUom}</TableCell>
                          <TableCell className="text-right" data-testid={`text-avgcost-${item.sku}`}>
                            {fmt(item.avgCost)}
                          </TableCell>
                          <TableCell className="text-right" data-testid={`text-totalvalue-${item.sku}`}>
                            {fmt(item.totalValue)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow key={`subtotal-${category}`} className="bg-muted/50 font-semibold">
                        <TableCell colSpan={6} className="text-right" data-testid={`text-subtotal-label-${category}`}>
                          Subtotal {category}
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-subtotal-${category}`}>
                          {fmt(group.subtotal)}
                        </TableCell>
                      </TableRow>
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-value-data">
              No hay datos de valoración disponibles.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LowStockTab() {
  const { data, isLoading } = useQuery<LowStockItem[]>({
    queryKey: ["/api/inv/reports/low-stock"],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Artículos con Stock Bajo</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center p-4" data-testid="loading-lowstock">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : data && data.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Stock Actual</TableHead>
                  <TableHead className="text-right">Punto Reorden</TableHead>
                  <TableHead className="text-right">Déficit</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Severidad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((item) => {
                  const deficit = item.reorderPoint - item.onHand;
                  const isZero = item.onHand <= 0;
                  return (
                    <TableRow key={item.sku} data-testid={`row-lowstock-${item.sku}`}>
                      <TableCell data-testid={`text-ls-sku-${item.sku}`}>{item.sku}</TableCell>
                      <TableCell data-testid={`text-ls-name-${item.sku}`}>{item.name}</TableCell>
                      <TableCell data-testid={`text-ls-category-${item.sku}`}>{item.category}</TableCell>
                      <TableCell className="text-right" data-testid={`text-ls-onhand-${item.sku}`}>
                        {item.onHand.toLocaleString("es-CR")}
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-ls-reorder-${item.sku}`}>
                        {item.reorderPoint.toLocaleString("es-CR")}
                      </TableCell>
                      <TableCell className="text-right" data-testid={`text-ls-deficit-${item.sku}`}>
                        {deficit.toLocaleString("es-CR")}
                      </TableCell>
                      <TableCell data-testid={`text-ls-uom-${item.sku}`}>{item.baseUom}</TableCell>
                      <TableCell data-testid={`badge-ls-severity-${item.sku}`}>
                        <Badge
                          variant="secondary"
                          className={isZero ? "bg-red-600 text-white" : "bg-yellow-500 text-black"}
                        >
                          {isZero ? "Sin Stock" : "Bajo"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-lowstock-data">
            No hay artículos con stock bajo.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
