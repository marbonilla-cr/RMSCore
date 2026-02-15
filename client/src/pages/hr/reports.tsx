import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(Math.abs(totalMinutes) / 60);
  const m = Math.abs(totalMinutes) % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekAgoStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

interface OvertimeRow {
  employeeId: number;
  employeeName: string;
  totalWorkedMinutes: number;
  overtimeMinutes: number;
  lateDays: number;
  lateMinutes: number;
  punchCount: number;
}

interface OvertimeReport {
  rows: OvertimeRow[];
  weeklyThresholdHours: number;
}

interface ServiceChargeLedgerEntry {
  id: number;
  employeeId: number;
  employeeName: string;
  amount: number;
  orderId: number;
  createdAt: string;
}

interface ServicePayout {
  id: number;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  createdAt: string;
}

export default function HrReportsPage() {
  const [activeTab, setActiveTab] = useState<"overtime" | "service">("overtime");

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold" data-testid="text-reports-title">Reportes HR</h1>

      <div className="flex gap-2">
        <Button
          variant={activeTab === "overtime" ? "default" : "outline"}
          data-testid="button-tab-overtime"
          onClick={() => setActiveTab("overtime")}
        >
          Horas Extra
        </Button>
        <Button
          variant={activeTab === "service" ? "default" : "outline"}
          data-testid="button-tab-service"
          onClick={() => setActiveTab("service")}
        >
          Cargo por Servicio
        </Button>
      </div>

      {activeTab === "overtime" ? <OvertimeTab /> : <ServiceChargeTab />}
    </div>
  );
}

function OvertimeTab() {
  const [dateFrom, setDateFrom] = useState(weekAgoStr());
  const [dateTo, setDateTo] = useState(todayStr());

  const { data, isLoading } = useQuery<OvertimeReport>({
    queryKey: ["/api/hr/overtime-report", `?dateFrom=${dateFrom}&dateTo=${dateTo}`],
    enabled: !!dateFrom && !!dateTo,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporte de Horas Extra</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-4 flex-wrap items-end">
          <div className="space-y-1">
            <Label htmlFor="ot-dateFrom">Desde</Label>
            <Input
              id="ot-dateFrom"
              data-testid="input-overtime-dateFrom"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ot-dateTo">Hasta</Label>
            <Input
              id="ot-dateTo"
              data-testid="input-overtime-dateTo"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>

        {data?.weeklyThresholdHours != null && (
          <p className="text-sm text-muted-foreground" data-testid="text-weekly-threshold">
            Umbral semanal: {data.weeklyThresholdHours} horas
          </p>
        )}

        {isLoading ? (
          <div className="flex justify-center p-4" data-testid="loading-overtime">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : data?.rows && data.rows.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Horas Trabajadas</TableHead>
                  <TableHead>Horas Extra</TableHead>
                  <TableHead>Días Tarde</TableHead>
                  <TableHead>Min Tarde</TableHead>
                  <TableHead>Marcas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow key={row.employeeId} data-testid={`row-overtime-${row.employeeId}`}>
                    <TableCell data-testid={`text-employee-name-${row.employeeId}`}>
                      {row.employeeName}
                    </TableCell>
                    <TableCell data-testid={`text-worked-${row.employeeId}`}>
                      {formatMinutes(row.totalWorkedMinutes)}
                    </TableCell>
                    <TableCell data-testid={`text-overtime-${row.employeeId}`}>
                      {formatMinutes(row.overtimeMinutes)}
                    </TableCell>
                    <TableCell data-testid={`text-late-days-${row.employeeId}`}>
                      {row.lateDays}
                    </TableCell>
                    <TableCell data-testid={`text-late-minutes-${row.employeeId}`}>
                      {formatMinutes(row.lateMinutes)}
                    </TableCell>
                    <TableCell data-testid={`text-punches-${row.employeeId}`}>
                      {row.punchCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-overtime-data">
            No hay datos para el rango seleccionado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ServiceChargeTab() {
  const { toast } = useToast();
  const [dateFrom, setDateFrom] = useState(weekAgoStr());
  const [dateTo, setDateTo] = useState(todayStr());

  const { data: ledger, isLoading: ledgerLoading } = useQuery<ServiceChargeLedgerEntry[]>({
    queryKey: ["/api/hr/service-charges", `?dateFrom=${dateFrom}&dateTo=${dateTo}`],
    enabled: !!dateFrom && !!dateTo,
  });

  const { data: payouts, isLoading: payoutsLoading } = useQuery<ServicePayout[]>({
    queryKey: ["/api/hr/service-payouts", `?periodStart=${dateFrom}&periodEnd=${dateTo}`],
    enabled: !!dateFrom && !!dateTo,
  });

  const grouped = useMemo(() => {
    if (!ledger) return [];
    const map = new Map<number, { employeeId: number; employeeName: string; total: number }>();
    for (const entry of ledger) {
      const existing = map.get(entry.employeeId);
      if (existing) {
        existing.total += entry.amount;
      } else {
        map.set(entry.employeeId, {
          employeeId: entry.employeeId,
          employeeName: entry.employeeName,
          total: entry.amount,
        });
      }
    }
    return Array.from(map.values());
  }, [ledger]);

  const grandTotal = useMemo(() => grouped.reduce((s, g) => s + g.total, 0), [grouped]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/hr/service-payouts/generate", {
        periodStart: dateFrom,
        periodEnd: dateTo,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/service-payouts"] });
      toast({ title: "Liquidación generada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/hr/service-payouts/finalize", {
        periodStart: dateFrom,
        periodEnd: dateTo,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/service-payouts"] });
      toast({ title: "Liquidación finalizada" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isActionPending = generateMutation.isPending || finalizeMutation.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Cargo por Servicio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 flex-wrap items-end">
            <div className="space-y-1">
              <Label htmlFor="sc-dateFrom">Desde</Label>
              <Input
                id="sc-dateFrom"
                data-testid="input-service-dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sc-dateTo">Hasta</Label>
              <Input
                id="sc-dateTo"
                data-testid="input-service-dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {ledgerLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-service-charges">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : grouped.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empleado</TableHead>
                      <TableHead className="text-right">Total Cargo Servicio</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grouped.map((g) => (
                      <TableRow key={g.employeeId} data-testid={`row-service-${g.employeeId}`}>
                        <TableCell data-testid={`text-service-employee-${g.employeeId}`}>
                          {g.employeeName}
                        </TableCell>
                        <TableCell
                          className="text-right"
                          data-testid={`text-service-total-${g.employeeId}`}
                        >
                          ₡{g.total.toLocaleString("es-CR", { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="text-right font-bold" data-testid="text-grand-total">
                Total: ₡{grandTotal.toLocaleString("es-CR", { minimumFractionDigits: 2 })}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-service-data">
              No hay cargos por servicio en el rango seleccionado.
            </p>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button
              data-testid="button-generate-payout"
              onClick={() => generateMutation.mutate()}
              disabled={isActionPending}
            >
              {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generar Liquidación
            </Button>
            <Button
              variant="outline"
              data-testid="button-finalize-payout"
              onClick={() => finalizeMutation.mutate()}
              disabled={isActionPending}
            >
              {finalizeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Finalizar Liquidación
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Liquidaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {payoutsLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-payouts">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : payouts && payouts.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Período</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Monto Total</TableHead>
                    <TableHead>Creado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.map((p) => (
                    <TableRow key={p.id} data-testid={`row-payout-${p.id}`}>
                      <TableCell data-testid={`text-payout-period-${p.id}`}>
                        {p.periodStart} — {p.periodEnd}
                      </TableCell>
                      <TableCell data-testid={`badge-payout-status-${p.id}`}>
                        <Badge
                          variant={p.status === "FINALIZED" ? "default" : "secondary"}
                          className={
                            p.status === "FINALIZED"
                              ? "bg-green-600 text-white"
                              : "bg-yellow-500 text-black"
                          }
                        >
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-right"
                        data-testid={`text-payout-amount-${p.id}`}
                      >
                        ₡{p.totalAmount.toLocaleString("es-CR", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell data-testid={`text-payout-created-${p.id}`}>
                        {new Date(p.createdAt).toLocaleDateString("es-CR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-no-payouts">
              No hay liquidaciones para este período.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
