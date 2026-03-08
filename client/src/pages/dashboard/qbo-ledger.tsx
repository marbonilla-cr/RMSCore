import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Download, RefreshCw, CheckCircle2, XCircle, Clock,
  MinusCircle, Search, FileSpreadsheet
} from "lucide-react";

interface LedgerRow {
  paymentId: number;
  orderId: number;
  globalNumber: string;
  businessDate: string;
  paidAt: string;
  tableName: string;
  amount: string;
  paymentMethod: string;
  categories: string;
  qboStatus: string;
  qboSyncedAt: string | null;
  qboError: string | null;
  qboSyncLogId: number | null;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString("es-CR", { timeZone: "America/Costa_Rica" });
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Costa_Rica" });
}

function formatCurrency(v: string | number) {
  return `₡${Number(v).toLocaleString("es-CR", { minimumFractionDigits: 0 })}`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "SUCCESS":
      return <Badge variant="default" className="bg-green-600 text-xs" data-testid={`badge-status-${status}`}><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>;
    case "PENDING":
      return <Badge variant="secondary" className="bg-yellow-500 text-white text-xs" data-testid={`badge-status-${status}`}><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>;
    case "FAILED":
    case "ABANDONED":
      return <Badge variant="destructive" className="text-xs" data-testid={`badge-status-${status}`}><XCircle className="h-3 w-3 mr-1" />{status === "ABANDONED" ? "Abandonado" : "Error"}</Badge>;
    case "SKIPPED":
      return <Badge variant="secondary" className="text-xs" data-testid={`badge-status-${status}`}><MinusCircle className="h-3 w-3 mr-1" />Omitido</Badge>;
    case "VOIDED":
      return <Badge variant="outline" className="text-xs" data-testid={`badge-status-${status}`}>Anulado</Badge>;
    default:
      return <Badge variant="outline" className="text-xs text-muted-foreground" data-testid={`badge-status-${status}`}><MinusCircle className="h-3 w-3 mr-1" />Sin sync</Badge>;
  }
}

function todayStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
}

export default function QboLedgerPage() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(todayStr());

  const ledgerQuery = useQuery<LedgerRow[]>({
    queryKey: ["/api/reports/qbo-ledger", dateFrom, dateTo],
    queryFn: async () => {
      const res = await fetch(`/api/reports/qbo-ledger?date_from=${dateFrom}&date_to=${dateTo}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error cargando ledger");
      return res.json();
    },
  });

  const retryMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/qbo/retry-pending"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/reports/qbo-ledger"] });
      toast({ title: "Reintentos", description: `${data.processed} pagos procesados` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rows = ledgerQuery.data || [];

  const counts = useMemo(() => {
    const c = { SUCCESS: 0, PENDING: 0, FAILED: 0, NOT_SYNCED: 0, OTHER: 0 };
    rows.forEach(r => {
      if (r.qboStatus === "SUCCESS") c.SUCCESS++;
      else if (r.qboStatus === "PENDING") c.PENDING++;
      else if (r.qboStatus === "FAILED" || r.qboStatus === "ABANDONED") c.FAILED++;
      else if (r.qboStatus === "NOT_SYNCED") c.NOT_SYNCED++;
      else c.OTHER++;
    });
    return c;
  }, [rows]);

  function exportCsv() {
    if (rows.length === 0) return;
    const headers = ["# Global", "Fecha", "Hora", "Mesa", "Monto", "Método", "Categorías", "Status QBO", "Sincronizado a", "Error"];
    const csvRows = rows.map(r => [
      r.globalNumber,
      r.businessDate,
      r.paidAt ? formatTime(r.paidAt) : "",
      r.tableName,
      Number(r.amount),
      r.paymentMethod,
      `"${r.categories}"`,
      r.qboStatus,
      r.qboSyncedAt ? new Date(r.qboSyncedAt).toLocaleString("es-CR", { timeZone: "America/Costa_Rica" }) : "",
      `"${(r.qboError || "").replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(","), ...csvRows.map(r => r.join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qbo-ledger-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4" data-testid="page-qbo-ledger">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <FileSpreadsheet className="h-5 w-5" />
          Ledger QBO
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="w-40"
            data-testid="input-date-from"
          />
          <span className="text-sm text-muted-foreground">a</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="w-40"
            data-testid="input-date-to"
          />
          <Button variant="outline" size="sm" onClick={() => ledgerQuery.refetch()} disabled={ledgerQuery.isFetching} data-testid="button-refresh">
            {ledgerQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card data-testid="card-count-success">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{counts.SUCCESS}</div>
            <div className="text-xs text-muted-foreground">Sincronizados</div>
          </CardContent>
        </Card>
        <Card data-testid="card-count-pending">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-yellow-500">{counts.PENDING}</div>
            <div className="text-xs text-muted-foreground">Pendientes</div>
          </CardContent>
        </Card>
        <Card data-testid="card-count-failed">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-red-500">{counts.FAILED}</div>
            <div className="text-xs text-muted-foreground">Fallidos</div>
          </CardContent>
        </Card>
        <Card data-testid="card-count-notsync">
          <CardContent className="p-3 text-center">
            <div className="text-2xl font-bold text-gray-400">{counts.NOT_SYNCED}</div>
            <div className="text-xs text-muted-foreground">Sin Sync</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => retryMut.mutate()}
          disabled={retryMut.isPending || counts.FAILED === 0}
          data-testid="button-retry-failed"
        >
          {retryMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Reintentar fallidos
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={rows.length === 0}
          data-testid="button-export-csv"
        >
          <Download className="h-4 w-4 mr-1" />
          Exportar CSV
        </Button>
        <span className="text-sm text-muted-foreground ml-auto" data-testid="text-total-count">
          {rows.length} pagos
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {ledgerQuery.isLoading ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="text-center p-8 text-muted-foreground" data-testid="text-empty">Sin pagos en este rango.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-qbo-ledger">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium"># Global</th>
                    <th className="text-left p-2 font-medium">Fecha</th>
                    <th className="text-left p-2 font-medium">Hora</th>
                    <th className="text-left p-2 font-medium">Mesa</th>
                    <th className="text-right p-2 font-medium">Monto</th>
                    <th className="text-left p-2 font-medium">Método</th>
                    <th className="text-left p-2 font-medium hidden md:table-cell">Categorías</th>
                    <th className="text-center p-2 font-medium">Status QBO</th>
                    <th className="text-left p-2 font-medium hidden sm:table-cell">Sincronizado</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr
                      key={row.paymentId}
                      className="border-b hover:bg-muted/30"
                      data-testid={`row-payment-${row.paymentId}`}
                      title={row.qboError || undefined}
                    >
                      <td className="p-2 font-mono text-xs">{row.globalNumber}</td>
                      <td className="p-2 text-xs">{row.businessDate}</td>
                      <td className="p-2 text-xs">{row.paidAt ? formatTime(row.paidAt) : "-"}</td>
                      <td className="p-2 text-xs">{row.tableName}</td>
                      <td className="p-2 text-right font-mono text-xs">{formatCurrency(row.amount)}</td>
                      <td className="p-2 text-xs">{row.paymentMethod}</td>
                      <td className="p-2 text-xs hidden md:table-cell max-w-[200px] truncate" title={row.categories}>{row.categories}</td>
                      <td className="p-2 text-center"><StatusBadge status={row.qboStatus} /></td>
                      <td className="p-2 text-xs hidden sm:table-cell">
                        {row.qboSyncedAt ? new Date(row.qboSyncedAt).toLocaleString("es-CR", { timeZone: "America/Costa_Rica", hour: "2-digit", minute: "2-digit" }) : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
