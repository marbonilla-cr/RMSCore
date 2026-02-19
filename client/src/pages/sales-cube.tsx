import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3, Download, ChevronUp, ChevronDown, Filter, X,
  Calendar, Clock, Grid3X3, TrendingUp, Layers, Table2, ArrowLeft
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const WEEKDAY_LABELS_FULL = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

type PresetKey = "totals_by_product" | "product_by_day" | "product_by_month" | "product_by_hour" | "top_hours" | "heatmap" | "cube";

interface CubeRow {
  [key: string]: any;
}

interface CubeMeta {
  totalQty: number;
  totalSubtotal: number;
  totalOrders: number;
  groupBy: string[];
  rowCount: number;
}

interface CubeResponse {
  rows: CubeRow[];
  meta: CubeMeta;
}

interface FilterOptions {
  categories: string[];
  origins: string[];
  products: { id: number; name: string }[];
  waiterIds: number[];
  dateRange: { minDate: string | null; maxDate: string | null };
}

function formatCurrency(n: number): string {
  return `₡${n.toLocaleString("es-CR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function downloadCSV(rows: CubeRow[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(","),
    ...rows.map(row => headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return "";
      const str = String(val);
      return str.includes(",") || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
    }).join(","))
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SalesCubePage() {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [activePreset, setActivePreset] = useState<PresetKey>("totals_by_product");
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [hourFrom, setHourFrom] = useState<string>("");
  const [hourTo, setHourTo] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedOrigins, setSelectedOrigins] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [topN, setTopN] = useState<number>(10);
  const [showFilters, setShowFilters] = useState(false);

  const [cubeRowDim, setCubeRowDim] = useState("product");
  const [cubeColDim, setCubeColDim] = useState("business_date");
  const [cubeMetric, setCubeMetric] = useState("subtotal");

  const [sortCol, setSortCol] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [drillProduct, setDrillProduct] = useState<{ id: number | null; name: string } | null>(null);
  const [drillTab, setDrillTab] = useState<"day" | "hour">("day");

  const filterOptionsQuery = useQuery<FilterOptions>({
    queryKey: ["/api/reports/sales-cube/filter-options"],
  });

  const buildRequestBody = useCallback((presetOverride?: PresetKey, extraFilters?: any) => {
    const preset = presetOverride || activePreset;
    const filters: any = {
      dateFrom,
      dateTo,
      ...extraFilters,
    };
    if (selectedWeekdays.length > 0) filters.weekdays = selectedWeekdays;
    if (hourFrom !== "") filters.hourFrom = parseInt(hourFrom);
    if (hourTo !== "") filters.hourTo = parseInt(hourTo);
    if (selectedCategories.length > 0) filters.categories = selectedCategories;
    if (selectedOrigins.length > 0) filters.origins = selectedOrigins;
    if (selectedProducts.length > 0) filters.products = selectedProducts;

    switch (preset) {
      case "totals_by_product":
        return { ...filters, groupBy: ["product", "category"], sortBy: "subtotal", sortDir: "desc" };
      case "product_by_day":
        return { ...filters, groupBy: ["business_date", "product"], sortBy: "business_date", sortDir: "asc" };
      case "product_by_month":
        return { ...filters, groupBy: ["month", "product"], sortBy: "month", sortDir: "asc" };
      case "product_by_hour":
        return { ...filters, groupBy: ["hour", "product"], sortBy: "hour", sortDir: "asc" };
      case "top_hours":
        return { ...filters, groupBy: ["hour"], sortBy: "subtotal", sortDir: "desc", topN };
      case "heatmap":
        return { ...filters, groupBy: ["weekday", "hour"], sortBy: "weekday", sortDir: "asc" };
      case "cube":
        return { ...filters, groupBy: [cubeRowDim, cubeColDim].filter((v, i, a) => a.indexOf(v) === i), sortBy: cubeMetric === "subtotal" ? "subtotal" : cubeMetric === "qty" ? "qty" : "orders_count", sortDir: "desc" };
      default:
        return { ...filters, groupBy: ["product"], sortBy: "subtotal", sortDir: "desc" };
    }
  }, [activePreset, dateFrom, dateTo, selectedWeekdays, hourFrom, hourTo, selectedCategories, selectedOrigins, selectedProducts, topN, cubeRowDim, cubeColDim, cubeMetric]);

  const cubeQuery = useQuery<CubeResponse>({
    queryKey: ["/api/reports/sales-cube/query", activePreset, dateFrom, dateTo, selectedWeekdays, hourFrom, hourTo, selectedCategories, selectedOrigins, selectedProducts, topN, cubeRowDim, cubeColDim, cubeMetric],
    queryFn: async () => {
      const body = buildRequestBody();
      const res = await apiRequest("POST", "/api/reports/sales-cube/query", body);
      return res.json();
    },
  });

  const drillQuery = useQuery<CubeResponse>({
    queryKey: ["/api/reports/sales-cube/query", "drill", drillProduct?.id, drillProduct?.name, drillTab, dateFrom, dateTo],
    queryFn: async () => {
      if (!drillProduct) return { rows: [], meta: { totalQty: 0, totalSubtotal: 0, totalOrders: 0, groupBy: [], rowCount: 0 } };
      const filters: any = { dateFrom, dateTo };
      if (drillProduct.id) filters.products = [drillProduct.id];
      else filters.products = [drillProduct.name];
      if (selectedWeekdays.length > 0) filters.weekdays = selectedWeekdays;
      if (hourFrom !== "") filters.hourFrom = parseInt(hourFrom);
      if (hourTo !== "") filters.hourTo = parseInt(hourTo);

      const groupBy = drillTab === "day" ? ["business_date"] : ["hour"];
      const sortBy = drillTab === "day" ? "business_date" : "hour";

      const res = await apiRequest("POST", "/api/reports/sales-cube/query", {
        ...filters, groupBy, sortBy, sortDir: "asc",
      });
      return res.json();
    },
    enabled: !!drillProduct,
  });

  const data = cubeQuery.data;
  const rows = data?.rows || [];
  const meta = data?.meta;

  const sortedRows = useMemo(() => {
    if (!sortCol || !rows.length) return rows;
    return [...rows].sort((a, b) => {
      const va = a[sortCol];
      const vb = b[sortCol];
      const numA = typeof va === "number" ? va : parseFloat(va);
      const numB = typeof vb === "number" ? vb : parseFloat(vb);
      if (!isNaN(numA) && !isNaN(numB)) {
        return sortDir === "asc" ? numA - numB : numB - numA;
      }
      const strA = String(va || "");
      const strB = String(vb || "");
      return sortDir === "asc" ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [rows, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  const toggleWeekday = (wd: number) => {
    setSelectedWeekdays(prev =>
      prev.includes(wd) ? prev.filter(w => w !== wd) : [...prev, wd]
    );
  };

  const presetTabs: { key: PresetKey; label: string; icon: any }[] = [
    { key: "totals_by_product", label: "Totales", icon: BarChart3 },
    { key: "product_by_day", label: "Por Día", icon: Calendar },
    { key: "product_by_month", label: "Por Mes", icon: Calendar },
    { key: "product_by_hour", label: "Por Hora", icon: Clock },
    { key: "top_hours", label: "Top Horas", icon: TrendingUp },
    { key: "heatmap", label: "Heatmap", icon: Grid3X3 },
    { key: "cube", label: "Cubo", icon: Layers },
  ];

  const dimensionOptions = [
    { value: "product", label: "Producto" },
    { value: "category", label: "Categoría" },
    { value: "business_date", label: "Día" },
    { value: "month", label: "Mes" },
    { value: "weekday", label: "Día Semana" },
    { value: "hour", label: "Hora" },
    { value: "origin", label: "Origen" },
    { value: "waiter", label: "Mesero" },
    { value: "table", label: "Mesa" },
  ];

  return (
    <div className="flex flex-col h-full">
      {drillProduct ? (
        <DrilldownView
          product={drillProduct}
          drillTab={drillTab}
          setDrillTab={setDrillTab}
          data={drillQuery.data}
          isLoading={drillQuery.isLoading}
          onBack={() => setDrillProduct(null)}
        />
      ) : (
        <>
          <div className="sticky top-0 z-30 border-b p-3 space-y-3" style={{ background: 'var(--bg)' }}>
            <div className="admin-page-header">
              <BarChart3 className="w-5 h-5 text-muted-foreground" />
              <h1 className="admin-page-title" data-testid="text-page-title">Cubo de Ventas</h1>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters(f => !f)}
                  data-testid="button-toggle-filters"
                >
                  <Filter className="w-4 h-4 mr-1" />
                  Filtros
                  {(selectedWeekdays.length > 0 || selectedCategories.length > 0 || selectedOrigins.length > 0 || selectedProducts.length > 0 || hourFrom || hourTo) && (
                    <Badge variant="secondary" className="ml-1">{
                      [selectedWeekdays.length > 0, selectedCategories.length > 0, selectedOrigins.length > 0, selectedProducts.length > 0, hourFrom || hourTo].filter(Boolean).length
                    }</Badge>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadCSV(sortedRows, `ventas_${activePreset}`)}
                  disabled={!rows.length}
                  data-testid="button-export-csv"
                >
                  <Download className="w-4 h-4 mr-1" />
                  CSV
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="w-[140px]"
                data-testid="input-date-from"
              />
              <span className="text-muted-foreground text-sm">a</span>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="w-[140px]"
                data-testid="input-date-to"
              />
            </div>

            {showFilters && (
              <FilterPanel
                filterOptions={filterOptionsQuery.data}
                selectedWeekdays={selectedWeekdays}
                toggleWeekday={toggleWeekday}
                hourFrom={hourFrom}
                setHourFrom={setHourFrom}
                hourTo={hourTo}
                setHourTo={setHourTo}
                selectedCategories={selectedCategories}
                setSelectedCategories={setSelectedCategories}
                selectedOrigins={selectedOrigins}
                setSelectedOrigins={setSelectedOrigins}
                selectedProducts={selectedProducts}
                setSelectedProducts={setSelectedProducts}
              />
            )}

            <div className="flex gap-1 overflow-x-auto pb-1">
              {presetTabs.map(tab => (
                <Button
                  key={tab.key}
                  variant={activePreset === tab.key ? "default" : "ghost"}
                  size="sm"
                  onClick={() => { setActivePreset(tab.key); setSortCol(""); }}
                  data-testid={`button-preset-${tab.key}`}
                  className="whitespace-nowrap"
                >
                  <tab.icon className="w-4 h-4 mr-1" />
                  {tab.label}
                </Button>
              ))}
            </div>

            {activePreset === "cube" && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Filas:</span>
                <Select value={cubeRowDim} onValueChange={setCubeRowDim}>
                  <SelectTrigger className="w-[130px]" data-testid="select-cube-rows">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dimensionOptions.map(d => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">Columnas:</span>
                <Select value={cubeColDim} onValueChange={setCubeColDim}>
                  <SelectTrigger className="w-[130px]" data-testid="select-cube-cols">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dimensionOptions.map(d => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm text-muted-foreground">Métrica:</span>
                <Select value={cubeMetric} onValueChange={setCubeMetric}>
                  <SelectTrigger className="w-[130px]" data-testid="select-cube-metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="subtotal">Subtotal</SelectItem>
                    <SelectItem value="qty">Cantidad</SelectItem>
                    <SelectItem value="orders_count">Órdenes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {activePreset === "top_hours" && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Top N:</span>
                <Input
                  type="number"
                  value={topN}
                  onChange={e => setTopN(parseInt(e.target.value) || 10)}
                  className="w-[80px]"
                  min={1}
                  max={24}
                  data-testid="input-top-n"
                />
              </div>
            )}
          </div>

          {meta && (
            <div className="flex gap-3 p-3 flex-wrap">
              <Card className="flex-1 min-w-[140px]">
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Total Ventas</div>
                  <div className="text-lg font-bold" data-testid="text-meta-subtotal">
                    {formatCurrency(meta.totalSubtotal)}
                  </div>
                </CardContent>
              </Card>
              <Card className="flex-1 min-w-[140px]">
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Unidades</div>
                  <div className="text-lg font-bold" data-testid="text-meta-qty">
                    {meta.totalQty.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card className="flex-1 min-w-[140px]">
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Órdenes</div>
                  <div className="text-lg font-bold" data-testid="text-meta-orders">
                    {meta.totalOrders.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
              <Card className="flex-1 min-w-[140px]">
                <CardContent className="p-3">
                  <div className="text-xs text-muted-foreground">Filas</div>
                  <div className="text-lg font-bold" data-testid="text-meta-rows">
                    {meta.rowCount.toLocaleString()}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex-1 overflow-auto p-3">
            {cubeQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : activePreset === "heatmap" ? (
              <HeatmapView rows={rows} metric={cubeMetric} />
            ) : (
              <ResultsTable
                rows={sortedRows}
                preset={activePreset}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                onDrillProduct={activePreset === "totals_by_product" ? (row) => {
                  setDrillProduct({ id: row.product_id || null, name: row.product_name || row.product_key });
                } : undefined}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FilterPanel({
  filterOptions, selectedWeekdays, toggleWeekday,
  hourFrom, setHourFrom, hourTo, setHourTo,
  selectedCategories, setSelectedCategories,
  selectedOrigins, setSelectedOrigins,
  selectedProducts, setSelectedProducts,
}: {
  filterOptions?: FilterOptions;
  selectedWeekdays: number[];
  toggleWeekday: (wd: number) => void;
  hourFrom: string;
  setHourFrom: (v: string) => void;
  hourTo: string;
  setHourTo: (v: string) => void;
  selectedCategories: string[];
  setSelectedCategories: (v: string[]) => void;
  selectedOrigins: string[];
  setSelectedOrigins: (v: string[]) => void;
  selectedProducts: number[];
  setSelectedProducts: (v: number[]) => void;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Días de la semana</div>
          <div className="flex gap-1 flex-wrap">
            {WEEKDAY_LABELS.map((label, i) => (
              <Button
                key={i}
                variant={selectedWeekdays.includes(i) ? "default" : "outline"}
                size="sm"
                onClick={() => toggleWeekday(i)}
                data-testid={`button-weekday-${i}`}
              >
                {label}
              </Button>
            ))}
            {selectedWeekdays.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { selectedWeekdays.forEach(() => {}); setSelectedCategories([]); /* clear weekdays */ }}>
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Hora desde</div>
            <Select value={hourFrom || "__none__"} onValueChange={v => setHourFrom(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-[100px]" data-testid="select-hour-from">
                <SelectValue placeholder="--" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">--</SelectItem>
                {Array.from({ length: 24 }).map((_, h) => (
                  <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1">Hora hasta</div>
            <Select value={hourTo || "__none__"} onValueChange={v => setHourTo(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-[100px]" data-testid="select-hour-to">
                <SelectValue placeholder="--" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">--</SelectItem>
                {Array.from({ length: 24 }).map((_, h) => (
                  <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="min-w-[160px]">
            <div className="text-xs font-medium text-muted-foreground mb-1">Categoría</div>
            <Select value={selectedCategories[0] || "__all__"} onValueChange={v => setSelectedCategories(v === "__all__" ? [] : [v])}>
              <SelectTrigger data-testid="select-category-filter">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {(filterOptions?.categories || []).map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[120px]">
            <div className="text-xs font-medium text-muted-foreground mb-1">Origen</div>
            <Select value={selectedOrigins[0] || "__all__"} onValueChange={v => setSelectedOrigins(v === "__all__" ? [] : [v])}>
              <SelectTrigger data-testid="select-origin-filter">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {(filterOptions?.origins || []).map(o => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-[180px]">
            <div className="text-xs font-medium text-muted-foreground mb-1">Producto</div>
            <Select value={selectedProducts[0] ? String(selectedProducts[0]) : "__all__"} onValueChange={v => setSelectedProducts(v === "__all__" ? [] : [parseInt(v)])}>
              <SelectTrigger data-testid="select-product-filter">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                {(filterOptions?.products || []).map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultsTable({
  rows, preset, sortCol, sortDir, onSort, onDrillProduct,
}: {
  rows: CubeRow[];
  preset: PresetKey;
  sortCol: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  onDrillProduct?: (row: CubeRow) => void;
}) {
  if (!rows.length) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground" data-testid="text-no-data">
        No hay datos para los filtros seleccionados
      </div>
    );
  }

  const columns = getColumnsForPreset(preset, rows);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="table-results">
        <thead>
          <tr className="border-b">
            {columns.map(col => (
              <th
                key={col.key}
                className="text-left p-2 cursor-pointer select-none whitespace-nowrap"
                onClick={() => onSort(col.key)}
                data-testid={`th-${col.key}`}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortCol === col.key && (
                    sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr
              key={idx}
              className={`border-b ${onDrillProduct ? "cursor-pointer hover-elevate" : ""}`}
              onClick={() => onDrillProduct?.(row)}
              data-testid={`row-result-${idx}`}
            >
              {columns.map(col => (
                <td key={col.key} className="p-2 whitespace-nowrap">
                  {col.format ? col.format(row[col.key], row) : row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ColumnDef {
  key: string;
  label: string;
  format?: (val: any, row: any) => string;
}

function getColumnsForPreset(preset: PresetKey, rows: CubeRow[]): ColumnDef[] {
  switch (preset) {
    case "totals_by_product":
      return [
        { key: "product_name", label: "Producto" },
        { key: "category", label: "Categoría" },
        { key: "qty_total", label: "Cantidad", format: (v) => Number(v).toLocaleString() },
        { key: "subtotal_total", label: "Subtotal", format: (v) => formatCurrency(Number(v)) },
        { key: "orders_count", label: "Órdenes", format: (v) => Number(v).toLocaleString() },
      ];
    case "product_by_day":
      return [
        { key: "business_date", label: "Fecha" },
        { key: "product_name", label: "Producto" },
        { key: "qty_total", label: "Cantidad", format: (v) => Number(v).toLocaleString() },
        { key: "subtotal_total", label: "Subtotal", format: (v) => formatCurrency(Number(v)) },
        { key: "orders_count", label: "Órdenes", format: (v) => Number(v).toLocaleString() },
      ];
    case "product_by_month":
      return [
        { key: "month", label: "Mes" },
        { key: "product_name", label: "Producto" },
        { key: "qty_total", label: "Cantidad", format: (v) => Number(v).toLocaleString() },
        { key: "subtotal_total", label: "Subtotal", format: (v) => formatCurrency(Number(v)) },
        { key: "orders_count", label: "Órdenes", format: (v) => Number(v).toLocaleString() },
      ];
    case "product_by_hour":
      return [
        { key: "hour", label: "Hora", format: (v) => `${String(v).padStart(2, "0")}:00` },
        { key: "product_name", label: "Producto" },
        { key: "qty_total", label: "Cantidad", format: (v) => Number(v).toLocaleString() },
        { key: "subtotal_total", label: "Subtotal", format: (v) => formatCurrency(Number(v)) },
        { key: "orders_count", label: "Órdenes", format: (v) => Number(v).toLocaleString() },
      ];
    case "top_hours":
      return [
        { key: "hour", label: "Hora", format: (v) => `${String(v).padStart(2, "0")}:00` },
        { key: "subtotal_total", label: "Subtotal", format: (v) => formatCurrency(Number(v)) },
        { key: "qty_total", label: "Cantidad", format: (v) => Number(v).toLocaleString() },
        { key: "orders_count", label: "Órdenes", format: (v) => Number(v).toLocaleString() },
        { key: "share_pct", label: "% del Total", format: (v) => v !== undefined ? `${v}%` : "-" },
      ];
    case "cube":
    default: {
      if (!rows.length) return [];
      const keys = Object.keys(rows[0]);
      return keys.map(k => ({
        key: k,
        label: k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        format: k.includes("subtotal") ? (v: any) => formatCurrency(Number(v)) :
                k.includes("qty") || k.includes("count") ? (v: any) => Number(v).toLocaleString() :
                k === "hour" ? (v: any) => `${String(v).padStart(2, "0")}:00` :
                k === "weekday" ? (v: any) => WEEKDAY_LABELS_FULL[Number(v)] || String(v) :
                undefined,
      }));
    }
  }
}

function HeatmapView({ rows, metric }: { rows: CubeRow[]; metric: string }) {
  const [heatMetric, setHeatMetric] = useState<"subtotal" | "qty">("subtotal");

  const grid = useMemo(() => {
    const matrix: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let maxVal = 0;
    for (const row of rows) {
      const wd = Number(row.weekday);
      const h = Number(row.hour);
      const val = heatMetric === "subtotal" ? Number(row.subtotal_total) : Number(row.qty_total);
      if (wd >= 0 && wd < 7 && h >= 0 && h < 24) {
        matrix[wd][h] = val;
        if (val > maxVal) maxVal = val;
      }
    }
    return { matrix, maxVal };
  }, [rows, heatMetric]);

  const getColor = (val: number) => {
    if (val === 0 || grid.maxVal === 0) return { className: "bg-muted", style: {} };
    const intensity = val / grid.maxVal;
    if (intensity > 0.8) return { className: "text-white", style: { background: 'var(--red)' } };
    if (intensity > 0.6) return { className: "text-white", style: { background: 'var(--amber)' } };
    if (intensity > 0.4) return { className: "text-black dark:text-black", style: { background: 'var(--sage)' } };
    if (intensity > 0.2) return { className: "text-black dark:text-black", style: { background: 'var(--sage)', opacity: 0.6 } };
    return { className: "text-black dark:text-black", style: { background: 'var(--sage)', opacity: 0.3 } };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Métrica:</span>
        <Button
          variant={heatMetric === "subtotal" ? "default" : "outline"}
          size="sm"
          onClick={() => setHeatMetric("subtotal")}
          data-testid="button-heat-subtotal"
        >
          Subtotal
        </Button>
        <Button
          variant={heatMetric === "qty" ? "default" : "outline"}
          size="sm"
          onClick={() => setHeatMetric("qty")}
          data-testid="button-heat-qty"
        >
          Cantidad
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs" data-testid="table-heatmap">
          <thead>
            <tr>
              <th className="p-1 text-left min-w-[60px]">Día</th>
              {Array.from({ length: 24 }).map((_, h) => (
                <th key={h} className="p-1 text-center min-w-[40px]">
                  {String(h).padStart(2, "0")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_LABELS_FULL.map((dayLabel, wd) => (
              <tr key={wd}>
                <td className="p-1 font-medium whitespace-nowrap">{dayLabel}</td>
                {Array.from({ length: 24 }).map((_, h) => {
                  const val = grid.matrix[wd][h];
                  const colorObj = getColor(val);
                  return (
                    <td
                      key={h}
                      className={`p-1 text-center text-[10px] rounded-sm ${colorObj.className}`}
                      style={colorObj.style}
                      title={`${dayLabel} ${String(h).padStart(2, "0")}:00 - ${heatMetric === "subtotal" ? formatCurrency(val) : val}`}
                      data-testid={`cell-heat-${wd}-${h}`}
                    >
                      {val > 0 ? (heatMetric === "subtotal" ? (val >= 1000 ? `${Math.round(val / 1000)}k` : val) : val) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Bajo</span>
        <div className="flex gap-0.5">
          <div className="w-4 h-4 rounded-sm" style={{ background: 'var(--sage)', opacity: 0.3 }} />
          <div className="w-4 h-4 rounded-sm" style={{ background: 'var(--sage)', opacity: 0.6 }} />
          <div className="w-4 h-4 rounded-sm" style={{ background: 'var(--sage)' }} />
          <div className="w-4 h-4 rounded-sm" style={{ background: 'var(--amber)' }} />
          <div className="w-4 h-4 rounded-sm" style={{ background: 'var(--red)' }} />
        </div>
        <span>Alto</span>
      </div>
    </div>
  );
}

function DrilldownView({
  product, drillTab, setDrillTab, data, isLoading, onBack,
}: {
  product: { id: number | null; name: string };
  drillTab: "day" | "hour";
  setDrillTab: (t: "day" | "hour") => void;
  data?: CubeResponse;
  isLoading: boolean;
  onBack: () => void;
}) {
  const rows = data?.rows || [];
  const meta = data?.meta;

  return (
    <div className="flex flex-col h-full">
      <div className="sticky top-0 z-30 border-b p-3 space-y-2" style={{ background: 'var(--bg)' }}>
        <div className="admin-page-header">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-drill-back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h2 className="admin-page-title" data-testid="text-drill-title">{product.name}</h2>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => downloadCSV(rows, `detalle_${product.name}`)}
            disabled={!rows.length}
            data-testid="button-drill-csv"
          >
            <Download className="w-4 h-4 mr-1" />
            CSV
          </Button>
        </div>
        <div className="flex gap-1">
          <Button
            variant={drillTab === "day" ? "default" : "ghost"}
            size="sm"
            onClick={() => setDrillTab("day")}
            data-testid="button-drill-day"
          >
            <Calendar className="w-4 h-4 mr-1" />
            Por Día
          </Button>
          <Button
            variant={drillTab === "hour" ? "default" : "ghost"}
            size="sm"
            onClick={() => setDrillTab("hour")}
            data-testid="button-drill-hour"
          >
            <Clock className="w-4 h-4 mr-1" />
            Por Hora
          </Button>
        </div>
      </div>

      {meta && (
        <div className="flex gap-3 p-3 flex-wrap">
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Subtotal</div>
              <div className="text-lg font-bold">{formatCurrency(meta.totalSubtotal)}</div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Unidades</div>
              <div className="text-lg font-bold">{meta.totalQty.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card className="flex-1 min-w-[120px]">
            <CardContent className="p-3">
              <div className="text-xs text-muted-foreground">Órdenes</div>
              <div className="text-lg font-bold">{meta.totalOrders.toLocaleString()}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !rows.length ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">Sin datos</div>
        ) : (
          <table className="w-full text-sm" data-testid="table-drill-results">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">{drillTab === "day" ? "Fecha" : "Hora"}</th>
                <th className="text-left p-2">Cantidad</th>
                <th className="text-left p-2">Subtotal</th>
                <th className="text-left p-2">Órdenes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b" data-testid={`row-drill-${i}`}>
                  <td className="p-2">
                    {drillTab === "day"
                      ? row.business_date
                      : `${String(row.hour).padStart(2, "0")}:00`}
                  </td>
                  <td className="p-2">{Number(row.qty_total).toLocaleString()}</td>
                  <td className="p-2">{formatCurrency(Number(row.subtotal_total))}</td>
                  <td className="p-2">{Number(row.orders_count).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
