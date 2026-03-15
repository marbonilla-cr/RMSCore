import { useState, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronDown, ChevronRight, Plus, Trash2, Info, AlertTriangle, Clock, Check, X, RotateCcw } from "lucide-react";

function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(Math.abs(totalMinutes) / 60);
  const m = Math.abs(totalMinutes) % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function fmtMin(min: number): string {
  return min > 0 ? `${min} min` : "—";
}

function fmtHrsOrDash(min: number): string {
  return min > 0 ? formatMinutes(min) : "—";
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
  return (
    <div className="admin-page full-width">
      <h1 className="admin-page-title" data-testid="text-reports-title">Reportes HR</h1>
      <PayrollTab />
    </div>
  );
}

function getMondayStr(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().slice(0, 10);
}

function getSundayStr(mondayStr: string): string {
  const d = new Date(mondayStr + "T12:00:00");
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

function formatColones(n: number | null | undefined): string {
  if (n == null) return "₡0.00";
  return "₡" + n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface PayrollEmployee {
  employeeId: number;
  name: string;
  role: string;
  hourlyRate: number;
  daysScheduled: number;
  daysPresent: number;
  daysNoShow: number;
  totalNormalMin: number;
  totalOvertimeCalcMin: number;
  totalOvertimePaidMin: number;
  totalOvertimeMin: number;
  totalUnpaidBreakMin?: number;
  totalLateMin: number;
  lateCount: number;
  normalPay: number;
  overtimePay: number;
  basePayTotal: number;
  extrasEarnings: number;
  extrasDeductions: number;
  extrasNet: number;
  servicePayTotal: number;
  ccssBase: number;
  ccssEmployee: number;
  ccssEmployer: number;
  grossPay: number;
  netPay: number;
  employerCost: number;
  grandTotalPay: number;
  operatedAsWaiter?: boolean;
  dailyBreakdown: {
    date: string;
    workedMinutes: number;
    normalMinutes: number;
    overtimeMinutes: number;
    overtimeCalculatedMinutes: number;
    overtimePaidMinutes: number;
    unpaidBreakMinutes?: number;
    tardyMinutes: number;
    basePay: number;
    extras: { id: number; typeCode: string; amount: number; note: string | null; kind: string }[];
    servicePayDay: number;
    scheduledStartTime: string | null;
    scheduledEndTime: string | null;
    flags: string[];
  }[];
}

interface PayrollReport {
  planillaRange?: { from: string; to: string };
  serviceRange?: { from: string; to: string };
  serviceMode?: "BOLSA" | "VENTA_MESERO";
  serviceDistributionPctUsed?: number;
  serviceUnassignedTotal?: number;
  hrConfigSnapshot: {
    jornadaOrdinariaHorasPorDia: number;
    multiplicadorHoraExtra: number;
    servicePercentDefault: number;
    latenessGraceMinutes: number;
    paidStartPolicy?: string;
    overtimeRequiresApproval?: boolean;
    breakDeductEnabled?: boolean;
    breakThresholdMinutes?: number;
    breakDeductMinutes?: number;
    socialChargesEnabled?: boolean;
    ccssEmployeeRate?: number;
    ccssEmployerRate?: number;
    ccssIncludeService?: boolean;
    roundingRule: string;
  };
  hrConfigSnapshotWarnings?: string[];
  employees: PayrollEmployee[];
}

interface ExtraType {
  typeCode: string;
  name: string;
  kind: string;
  isActive: boolean;
}

function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function PayrollTab() {
  const { toast } = useToast();
  const [mode, setMode] = useState<"weekly" | "range">("weekly");
  const [weekStart, setWeekStart] = useState(getMondayStr());
  const [dateFrom, setDateFrom] = useState(weekAgoStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [expandedEmp, setExpandedEmp] = useState<number | null>(null);
  const [useDefaultService, setUseDefaultService] = useState(true);
  const [customServiceFrom, setCustomServiceFrom] = useState("");
  const [customServiceTo, setCustomServiceTo] = useState("");
  const [serviceMode, setServiceMode] = useState<"BOLSA" | "VENTA_MESERO">("BOLSA");

  const actualFrom = mode === "weekly" ? weekStart : dateFrom;
  const actualTo = mode === "weekly" ? getSundayStr(weekStart) : dateTo;

  const defaultServiceFrom = addDaysStr(actualFrom, -14);
  const defaultServiceTo = addDaysStr(defaultServiceFrom, 6);
  const serviceFrom = useDefaultService ? defaultServiceFrom : customServiceFrom;
  const serviceTo = useDefaultService ? defaultServiceTo : customServiceTo;

  const queryParams = `?dateFrom=${actualFrom}&dateTo=${actualTo}&serviceFrom=${serviceFrom}&serviceTo=${serviceTo}&serviceMode=${serviceMode}`;
  const { data, isFetching, refetch } = useQuery<PayrollReport>({
    queryKey: ["/api/hr/payroll-report", queryParams],
    enabled: false,
    staleTime: Infinity,
  });

  const { data: extraTypes } = useQuery<ExtraType[]>({
    queryKey: ["/api/hr/extra-types"],
  });

  const { data: approvals, refetch: refetchApprovals } = useQuery<any[]>({
    queryKey: ["/api/hr/overtime-approvals", actualFrom, actualTo],
    queryFn: () =>
      fetch(`/api/hr/overtime-approvals?dateFrom=${actualFrom}&dateTo=${actualTo}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: false,
    staleTime: Infinity,
  });

  const approvalsMap = useMemo(() => {
    const map: Record<string, { status: string; rejectionReason?: string }> = {};
    for (const a of (approvals || [])) {
      map[`${a.employeeId}_${a.businessDate}`] = a;
    }
    return map;
  }, [approvals]);

  const [rejectDialog, setRejectDialog] = useState<{ employeeId: number; businessDate?: string; overtimeMinutes?: number; bulk?: boolean; days?: any[] } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function handleApproveDay(employeeId: number, businessDate: string, overtimeMinutes: number) {
    try {
      await apiRequest("POST", "/api/hr/overtime-approvals", { employeeId, businessDate, status: "APPROVED", overtimeMinutes });
      refetchApprovals();
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll-report"] });
      toast({ title: "Horas extra aprobadas" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  async function handleRevertDay(employeeId: number, businessDate: string, overtimeMinutes: number) {
    try {
      await apiRequest("POST", "/api/hr/overtime-approvals", { employeeId, businessDate, status: "PENDING", overtimeMinutes });
      refetchApprovals();
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll-report"] });
      toast({ title: "Aprobación revertida" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  async function confirmReject() {
    if (!rejectDialog || !rejectReason.trim()) return;
    try {
      if (rejectDialog.bulk && rejectDialog.days) {
        await apiRequest("POST", "/api/hr/overtime-approvals/bulk", {
          employeeId: rejectDialog.employeeId,
          dateFrom: actualFrom, dateTo: actualTo,
          status: "REJECTED",
          rejectionReason: rejectReason.trim(),
          days: rejectDialog.days,
        });
      } else {
        await apiRequest("POST", "/api/hr/overtime-approvals", {
          employeeId: rejectDialog.employeeId,
          businessDate: rejectDialog.businessDate,
          status: "REJECTED",
          overtimeMinutes: rejectDialog.overtimeMinutes,
          rejectionReason: rejectReason.trim(),
        });
      }
      refetchApprovals();
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll-report"] });
      toast({ title: "Horas extra rechazadas" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setRejectDialog(null);
    setRejectReason("");
  }

  async function handleBulkApprove(employeeId: number, days: { businessDate: string; overtimeMinutes: number }[]) {
    try {
      await apiRequest("POST", "/api/hr/overtime-approvals/bulk", {
        employeeId,
        dateFrom: actualFrom, dateTo: actualTo,
        status: "APPROVED",
        days,
      });
      refetchApprovals();
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll-report"] });
      toast({ title: `${days.length} días de extras aprobados` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }

  const [addingExtraFor, setAddingExtraFor] = useState<{ empId: number; date: string } | null>(null);
  const [newExtraType, setNewExtraType] = useState("");
  const [newExtraAmount, setNewExtraAmount] = useState("");
  const [newExtraNote, setNewExtraNote] = useState("");

  const [chargesFilter, setChargesFilter] = useState<"pending" | "settled">("pending");
  const { data: employeeCharges = [], refetch: refetchCharges, isFetching: chargesLoading } = useQuery<any[]>({
    queryKey: ["/api/hr/employee-charges", chargesFilter],
    queryFn: () =>
      fetch(`/api/hr/employee-charges?settled=${chargesFilter === "settled"}`, { credentials: "include" })
        .then(r => r.json()),
    staleTime: 30_000,
  });

  const settleChargeMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/hr/employee-charges/${id}/settle`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/employee-charges"] });
      toast({ title: "Cargo liquidado" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createExtraMutation = useMutation({
    mutationFn: async (body: { employeeId: number; appliesToDate: string; typeCode: string; amount: number; note: string }) => {
      await apiRequest("POST", "/api/hr/payroll-extras", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll-report"] });
      setAddingExtraFor(null);
      setNewExtraType("");
      setNewExtraAmount("");
      setNewExtraNote("");
      toast({ title: "Extra agregado" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteExtraMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/hr/payroll-extras/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/hr/payroll-report"] });
      toast({ title: "Extra eliminado" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const needsNote = ["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PRESTAMO_DEDUCCION"].includes(newExtraType);

  const showCCSS = data?.hrConfigSnapshot?.socialChargesEnabled === true;

  const totals = useMemo(() => {
    if (!data?.employees) return null;
    return data.employees.reduce(
      (acc, e) => ({
        basePayTotal: acc.basePayTotal + e.basePayTotal,
        extrasNet: acc.extrasNet + e.extrasNet,
        servicePayTotal: acc.servicePayTotal + e.servicePayTotal,
        ccssEmployee: acc.ccssEmployee + (e.ccssEmployee || 0),
        ccssEmployer: acc.ccssEmployer + (e.ccssEmployer || 0),
        grossPay: acc.grossPay + (e.grossPay || 0),
        netPay: acc.netPay + (e.netPay || 0),
        employerCost: acc.employerCost + (e.employerCost || 0),
        grandTotalPay: acc.grandTotalPay + e.grandTotalPay,
      }),
      { basePayTotal: 0, extrasNet: 0, servicePayTotal: 0, ccssEmployee: 0, ccssEmployer: 0, grossPay: 0, netPay: 0, employerCost: 0, grandTotalPay: 0 }
    );
  }, [data]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg mr-2">Planilla</CardTitle>
          <Button size="sm" variant={mode === "weekly" ? "default" : "outline"} onClick={() => setMode("weekly")} className="h-7 text-xs" data-testid="button-mode-weekly">Semanal</Button>
          <Button size="sm" variant={mode === "range" ? "default" : "outline"} onClick={() => setMode("range")} className="h-7 text-xs" data-testid="button-mode-range">Rango</Button>
          {mode === "weekly" ? (
            <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className="h-7 text-xs w-36" data-testid="input-payroll-weekStart" />
          ) : (
            <>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-7 text-xs w-36" data-testid="input-payroll-dateFrom" />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-7 text-xs w-36" data-testid="input-payroll-dateTo" />
            </>
          )}
          <span className="text-muted-foreground text-xs">|</span>
          <div className="flex items-center gap-1">
            <Checkbox
              id="use-default-service"
              checked={useDefaultService}
              onCheckedChange={(checked) => {
                setUseDefaultService(!!checked);
                if (!checked) {
                  setCustomServiceFrom(defaultServiceFrom);
                  setCustomServiceTo(defaultServiceTo);
                }
              }}
              className="h-3.5 w-3.5"
              data-testid="checkbox-default-service"
            />
            <Label htmlFor="use-default-service" className="text-xs">2sem fondo</Label>
          </div>
          {!useDefaultService && (
            <>
              <Input type="date" value={customServiceFrom} onChange={(e) => setCustomServiceFrom(e.target.value)} className="h-7 text-xs w-36" data-testid="input-service-from" />
              <Input type="date" value={customServiceTo} onChange={(e) => setCustomServiceTo(e.target.value)} className="h-7 text-xs w-36" data-testid="input-service-to" />
            </>
          )}
          <span className="text-muted-foreground text-xs">|</span>
          <Button
            size="sm"
            variant={serviceMode === "BOLSA" ? "default" : "outline"}
            onClick={() => setServiceMode("BOLSA")}
            className="h-7 text-xs px-2"
            data-testid="button-service-mode-bolsa"
          >
            Bolsa
          </Button>
          <Button
            size="sm"
            variant={serviceMode === "VENTA_MESERO" ? "default" : "outline"}
            onClick={() => setServiceMode("VENTA_MESERO")}
            className="h-7 text-xs px-2"
            data-testid="button-service-mode-venta"
          >
            Venta por Mesero
          </Button>
          <span className="text-muted-foreground text-xs">|</span>
          <Button
            size="sm"
            onClick={() => { refetch(); refetchApprovals(); }}
            disabled={isFetching || !actualFrom || !actualTo || !serviceFrom || !serviceTo}
            className="h-7 text-xs px-3"
            data-testid="button-generate-report"
          >
            {isFetching ? (
              <><Loader2 className="h-3 w-3 animate-spin mr-1" />Generando...</>
            ) : (
              "Generar reporte"
            )}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
          <span data-testid="text-planilla-range">Salarios: <strong>{actualFrom}</strong> → <strong>{actualTo}</strong></span>
          <span data-testid="text-service-range">
            Servicio: <strong>{serviceFrom}</strong> → <strong>{serviceTo}</strong>
            {(() => {
              const diffDays = Math.round((new Date(serviceTo + "T12:00:00").getTime() - new Date(serviceFrom + "T12:00:00").getTime()) / 86400000) + 1;
              return diffDays !== 7 ? (
                <span className="inline-flex items-center gap-0.5 ml-1 text-amber-600">
                  <AlertTriangle className="h-3 w-3" /> ({diffDays}d)
                </span>
              ) : null;
            })()}
          </span>
          {data && (
            <>
              <span data-testid="text-service-context">
                {data.serviceMode === "VENTA_MESERO" ? "Venta/Mesero" : "Bolsa"} al {data.serviceDistributionPctUsed?.toFixed(0) ?? "—"}%
              </span>
              {(data.serviceUnassignedTotal ?? 0) > 0 && (
                <span className="text-amber-600" data-testid="text-service-unassigned">
                  No asignado: ₡{(data.serviceUnassignedTotal ?? 0).toLocaleString("es-CR", { minimumFractionDigits: 2 })}
                </span>
              )}
            </>
          )}
          {data?.hrConfigSnapshot && (
            <span className="flex items-center gap-0.5" data-testid="badge-hr-config">
              <Info className="h-3 w-3" />
              Jornada: {data.hrConfigSnapshot.jornadaOrdinariaHorasPorDia}h | ×{data.hrConfigSnapshot.multiplicadorHoraExtra}
              {data.hrConfigSnapshot.overtimeRequiresApproval ? " (aprob.)" : ""}
              {" | "}Gracia: {data.hrConfigSnapshot.latenessGraceMinutes}min
              {showCCSS && ` | CCSS: ${data.hrConfigSnapshot.ccssEmployeeRate}%/${data.hrConfigSnapshot.ccssEmployerRate}%`}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">

        {isFetching ? (
          <div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : data?.employees && data.employees.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead className="whitespace-nowrap">Empleado</TableHead>
                  <TableHead className="text-right whitespace-nowrap">₡/hr</TableHead>
                  <TableHead className="text-center whitespace-nowrap">D.Prog</TableHead>
                  <TableHead className="text-center whitespace-nowrap">D.Pres</TableHead>
                  <TableHead className="text-center whitespace-nowrap">No Show</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Hrs Norm</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Extra (Calc)</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Extra (Pag)</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Desc.</TableHead>
                  <TableHead className="text-center whitespace-nowrap">Tardías</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Min Tarde</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Pago Base</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Extras</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Servicio</TableHead>
                  {showCCSS && <TableHead className="text-right whitespace-nowrap">CCSS Empl.</TableHead>}
                  {showCCSS && <TableHead className="text-right whitespace-nowrap">CCSS Patr.</TableHead>}
                  <TableHead className="text-right whitespace-nowrap font-bold">{showCCSS ? "Neto" : "Total"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.employees.filter(e => e.daysScheduled > 0 || e.daysPresent > 0 || e.grandTotalPay !== 0).map((emp) => {
                  const isExpanded = expandedEmp === emp.employeeId;
                  return (
                    <Fragment key={emp.employeeId}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedEmp(isExpanded ? null : emp.employeeId)}
                        data-testid={`row-payroll-${emp.employeeId}`}
                      >
                        <TableCell className="w-8">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                        <TableCell>
                          <div className="font-medium">{emp.name}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            {emp.role}
                            {emp.operatedAsWaiter && emp.role !== "WAITER" && emp.role !== "SALONERO" && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 leading-tight" data-testid={`badge-waiter-${emp.employeeId}`}>Mesero</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-xs text-muted-foreground">{formatColones(emp.hourlyRate)}</TableCell>
                        <TableCell className="text-center">{emp.daysScheduled}</TableCell>
                        <TableCell className="text-center">{emp.daysPresent}</TableCell>
                        <TableCell className="text-center">{emp.daysNoShow > 0 ? <Badge variant="destructive" className="text-xs">{emp.daysNoShow}</Badge> : "0"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{fmtHrsOrDash(emp.totalNormalMin)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {(emp.totalOvertimeCalcMin || 0) > 0 ? (
                            <span className="text-amber-600 font-medium">
                              {formatMinutes(emp.totalOvertimeCalcMin)}
                              {emp.totalOvertimeCalcMin > 0 && emp.totalOvertimePaidMin === 0 && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 text-amber-600 border-amber-300">Pendiente</Badge>
                              )}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {(emp.totalOvertimePaidMin || 0) > 0 ? (
                            <span className="text-green-600 font-medium">{formatMinutes(emp.totalOvertimePaidMin)}</span>
                          ) : "—"}
                        </TableCell>
                        <TooltipProvider>
                          <TableCell className="text-right whitespace-nowrap">
                            {(emp.totalUnpaidBreakMin || 0) > 0 ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-orange-500 cursor-help">{fmtMin(emp.totalUnpaidBreakMin || 0)}</span>
                                </TooltipTrigger>
                                <TooltipContent>Descanso no pagado aplicado</TooltipContent>
                              </Tooltip>
                            ) : "—"}
                          </TableCell>
                        </TooltipProvider>
                        <TableCell className="text-center whitespace-nowrap">{emp.lateCount > 0 ? <Badge variant="secondary" className="text-xs">{emp.lateCount}</Badge> : "0"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{fmtMin(emp.totalLateMin)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{formatColones(emp.basePayTotal)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{emp.extrasNet !== 0 ? <span className={emp.extrasNet > 0 ? "text-green-600" : "text-red-600"}>{formatColones(emp.extrasNet)}</span> : "—"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{emp.servicePayTotal > 0 || emp.operatedAsWaiter ? formatColones(emp.servicePayTotal) : "—"}</TableCell>
                        {showCCSS && <TableCell className="text-right whitespace-nowrap text-xs">{emp.ccssEmployee > 0 ? formatColones(emp.ccssEmployee) : "—"}</TableCell>}
                        {showCCSS && <TableCell className="text-right whitespace-nowrap text-xs">{emp.ccssEmployer > 0 ? formatColones(emp.ccssEmployer) : "—"}</TableCell>}
                        <TableCell className="text-right whitespace-nowrap font-bold">{formatColones(showCCSS ? emp.netPay : emp.grandTotalPay)}</TableCell>
                      </TableRow>
                      {isExpanded && (() => {
                        const pendingOvertimeDays = emp.dailyBreakdown
                          .filter((d: any) => {
                            if ((d.overtimeCalculatedMinutes || 0) <= 0) return false;
                            const st = approvalsMap[`${emp.employeeId}_${d.date}`]?.status;
                            return !st || st === "PENDING";
                          })
                          .map((d: any) => ({ businessDate: d.date, overtimeMinutes: d.overtimeCalculatedMinutes }));
                        return (
                        <TableRow key={`${emp.employeeId}-detail`}>
                          <TableCell colSpan={showCCSS ? 20 : 18} className="p-0">
                            <div className="bg-muted/30 p-3">
                              {pendingOvertimeDays.length > 0 && data.hrConfigSnapshot?.overtimeRequiresApproval && (
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-xs text-muted-foreground">Horas extra pendientes: {pendingOvertimeDays.length} día(s)</span>
                                  <Button size="sm" variant="outline" className="h-6 text-xs text-green-600 border-green-300" onClick={(e) => { e.stopPropagation(); handleBulkApprove(emp.employeeId, pendingOvertimeDays); }} data-testid={`button-bulk-approve-${emp.employeeId}`}>
                                    <Check className="h-3 w-3 mr-1" /> Aprobar todas ({pendingOvertimeDays.length})
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-6 text-xs text-red-600 border-red-300" onClick={(e) => { e.stopPropagation(); setRejectDialog({ employeeId: emp.employeeId, bulk: true, days: pendingOvertimeDays }); }} data-testid={`button-bulk-reject-${emp.employeeId}`}>
                                    <X className="h-3 w-3 mr-1" /> Rechazar todas
                                  </Button>
                                </div>
                              )}
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Horario</TableHead>
                                    <TableHead className="text-right">Normal</TableHead>
                                    <TableHead className="text-right">Extra (Calc)</TableHead>
                                    <TableHead className="text-right">Extra (Pag)</TableHead>
                                    <TableHead className="text-right">Desc.</TableHead>
                                    <TableHead className="text-right">Tardía</TableHead>
                                    <TableHead className="text-right">Pago Base</TableHead>
                                    <TableHead>Extras</TableHead>
                                    <TableHead className="text-right">Servicio</TableHead>
                                    <TableHead>Flags</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {emp.dailyBreakdown.filter(d => d.workedMinutes > 0 || (d.flags && d.flags.includes("NO_SHOW")) || d.extras.length > 0).map((day) => (
                                    <TableRow key={day.date} data-testid={`row-daily-${emp.employeeId}-${day.date}`}>
                                      <TableCell className="font-mono text-sm">{day.date}</TableCell>
                                      <TableCell className="text-xs whitespace-nowrap">
                                        {day.scheduledStartTime && day.scheduledEndTime
                                          ? `${day.scheduledStartTime}–${day.scheduledEndTime}`
                                          : <span className="text-muted-foreground">—</span>}
                                      </TableCell>
                                      <TableCell className="text-right">{fmtHrsOrDash(day.normalMinutes)}</TableCell>
                                      <TableCell className="text-right">
                                        {(day.overtimeCalculatedMinutes || 0) > 0 ? (
                                          <span className="text-amber-600">
                                            {formatMinutes(day.overtimeCalculatedMinutes)}
                                            {day.overtimeCalculatedMinutes > 0 && (day.overtimePaidMinutes || 0) === 0 && (
                                              <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 text-amber-600 border-amber-300">Pend.</Badge>
                                            )}
                                          </span>
                                        ) : "—"}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {(day.overtimePaidMinutes || 0) > 0 ? (
                                          <span className="text-green-600">{formatMinutes(day.overtimePaidMinutes)}</span>
                                        ) : "—"}
                                      </TableCell>
                                      <TooltipProvider>
                                        <TableCell className="text-right">
                                          {(day.unpaidBreakMinutes || 0) > 0 ? (
                                            <Tooltip>
                                              <TooltipTrigger asChild>
                                                <span className="text-orange-500 cursor-help">{fmtMin(day.unpaidBreakMinutes || 0)}</span>
                                              </TooltipTrigger>
                                              <TooltipContent>Descanso no pagado aplicado</TooltipContent>
                                            </Tooltip>
                                          ) : "—"}
                                        </TableCell>
                                      </TooltipProvider>
                                      <TableCell className="text-right">{day.tardyMinutes > 0 ? <span className="text-red-500">{fmtMin(day.tardyMinutes)}</span> : "—"}</TableCell>
                                      <TableCell className="text-right">{formatColones(day.basePay)}</TableCell>
                                      <TableCell>
                                        <div className="space-y-1">
                                          {day.extras.map((ex) => (
                                            <div key={ex.id} className="flex items-center gap-1 text-xs">
                                              <span className={ex.kind === "EARNING" ? "text-green-600" : "text-red-600"}>
                                                {ex.kind === "EARNING" ? "+" : ""}{formatColones(ex.amount)}
                                              </span>
                                              <span className="text-muted-foreground">{ex.typeCode}</span>
                                              {ex.note && <span className="text-muted-foreground italic truncate max-w-[100px]" title={ex.note}>({ex.note})</span>}
                                              <button onClick={(e) => { e.stopPropagation(); deleteExtraMutation.mutate(ex.id); }} className="text-red-400 hover:text-red-600" data-testid={`button-delete-extra-${ex.id}`}>
                                                <Trash2 className="h-3 w-3" />
                                              </button>
                                            </div>
                                          ))}
                                          {addingExtraFor?.empId === emp.employeeId && addingExtraFor?.date === day.date ? (
                                            <div className="flex flex-col gap-1 p-2 border rounded bg-background" onClick={(e) => e.stopPropagation()}>
                                              <Select value={newExtraType} onValueChange={setNewExtraType}>
                                                <SelectTrigger className="h-7 text-xs" data-testid="select-extra-type">
                                                  <SelectValue placeholder="Tipo" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {extraTypes?.map((t) => (
                                                    <SelectItem key={t.typeCode} value={t.typeCode}>{t.name} ({t.kind === "EARNING" ? "+" : "-"})</SelectItem>
                                                  ))}
                                                </SelectContent>
                                              </Select>
                                              <Input type="number" placeholder="Monto ₡" className="h-7 text-xs" value={newExtraAmount} onChange={(e) => setNewExtraAmount(e.target.value)} data-testid="input-extra-amount" />
                                              <Input placeholder={needsNote ? "Nota (requerida)" : "Nota (opcional)"} className="h-7 text-xs" value={newExtraNote} onChange={(e) => setNewExtraNote(e.target.value)} data-testid="input-extra-note" />
                                              <div className="flex gap-1">
                                                <Button size="sm" className="h-6 text-xs" disabled={!newExtraType || !newExtraAmount || (needsNote && !newExtraNote.trim()) || createExtraMutation.isPending}
                                                  onClick={() => createExtraMutation.mutate({ employeeId: emp.employeeId, appliesToDate: day.date, typeCode: newExtraType, amount: Number(newExtraAmount), note: newExtraNote })} data-testid="button-save-extra">
                                                  Guardar
                                                </Button>
                                                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setAddingExtraFor(null)} data-testid="button-cancel-extra">Cancelar</Button>
                                              </div>
                                            </div>
                                          ) : (
                                            <button onClick={(e) => { e.stopPropagation(); setAddingExtraFor({ empId: emp.employeeId, date: day.date }); }} className="text-xs text-primary flex items-center gap-0.5 hover:underline" data-testid={`button-add-extra-${emp.employeeId}-${day.date}`}>
                                              <Plus className="h-3 w-3" /> Extra
                                            </button>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell className="text-right">{(emp.servicePayTotal > 0 || emp.operatedAsWaiter) ? formatColones(day.servicePayDay) : "—"}</TableCell>
                                      <TableCell>
                                        <div className="flex gap-1 flex-wrap">
                                          {Array.isArray(day.flags) ? (
                                            <>
                                              {day.flags.includes("NO_SHOW") && <Badge variant="destructive" className="text-[10px] px-1">No Show</Badge>}
                                              {day.flags.includes("TARDE") && <Badge variant="secondary" className="text-[10px] px-1">Tarde</Badge>}
                                              {day.flags.includes("AUTO_OUT") && <Badge variant="outline" className="text-[10px] px-1">Auto</Badge>}
                                              {day.flags.includes("AUTO_NO_SCHEDULE") && <Badge variant="outline" className="text-[10px] px-1">Auto (sin horario)</Badge>}
                                              {day.flags.includes("SIN_HORARIO") && <Badge variant="outline" className="text-[10px] px-1">Sin horario</Badge>}
                                              {day.flags.includes("DIA_LIBRE") && <Badge variant="outline" className="text-[10px] px-1">Día libre</Badge>}
                                              {day.flags.includes("PUNCH_BASURA_FILTRADO") && <Badge variant="outline" className="text-[10px] px-1 text-orange-500 border-orange-300">Basura filtrada</Badge>}
                                              {day.flags.includes("OVERTIME_PENDIENTE_APROBACION") && (() => {
                                                const approvalKey = `${emp.employeeId}_${day.date}`;
                                                const approval = approvalsMap[approvalKey];
                                                const st = approval?.status;
                                                if (st === "APPROVED") return (
                                                  <span className="inline-flex items-center gap-1">
                                                    <Badge className="text-[10px] px-1 bg-green-600 text-white">OT Aprobada</Badge>
                                                    <button onClick={(e) => { e.stopPropagation(); handleRevertDay(emp.employeeId, day.date, day.overtimeCalculatedMinutes); }} className="text-muted-foreground hover:text-foreground" title="Revertir" data-testid={`button-revert-ot-${emp.employeeId}-${day.date}`}>
                                                      <RotateCcw className="h-3 w-3" />
                                                    </button>
                                                  </span>
                                                );
                                                if (st === "REJECTED") return (
                                                  <TooltipProvider>
                                                    <span className="inline-flex items-center gap-1">
                                                      <Tooltip>
                                                        <TooltipTrigger asChild>
                                                          <Badge variant="destructive" className="text-[10px] px-1 cursor-help">OT Rechazada</Badge>
                                                        </TooltipTrigger>
                                                        <TooltipContent>{approval.rejectionReason || "Sin razón"}</TooltipContent>
                                                      </Tooltip>
                                                      <button onClick={(e) => { e.stopPropagation(); handleRevertDay(emp.employeeId, day.date, day.overtimeCalculatedMinutes); }} className="text-muted-foreground hover:text-foreground" title="Revertir" data-testid={`button-revert-ot-${emp.employeeId}-${day.date}`}>
                                                        <RotateCcw className="h-3 w-3" />
                                                      </button>
                                                    </span>
                                                  </TooltipProvider>
                                                );
                                                return (
                                                  <span className="inline-flex items-center gap-1">
                                                    <Badge variant="outline" className="text-[10px] px-1 text-amber-600 border-amber-300">OT pendiente</Badge>
                                                    <button onClick={(e) => { e.stopPropagation(); handleApproveDay(emp.employeeId, day.date, day.overtimeCalculatedMinutes); }} className="text-green-600 hover:text-green-800" title="Aprobar" data-testid={`button-approve-ot-${emp.employeeId}-${day.date}`}>
                                                      <Check className="h-3.5 w-3.5" />
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); setRejectDialog({ employeeId: emp.employeeId, businessDate: day.date, overtimeMinutes: day.overtimeCalculatedMinutes }); }} className="text-red-600 hover:text-red-800" title="Rechazar" data-testid={`button-reject-ot-${emp.employeeId}-${day.date}`}>
                                                      <X className="h-3.5 w-3.5" />
                                                    </button>
                                                  </span>
                                                );
                                              })()}
                                              {day.flags.includes("PUNCHES_MULTIPLES") && <Badge variant="outline" className="text-[10px] px-1">Múlt. marcas</Badge>}
                                            </>
                                          ) : (
                                            <>
                                              {(day.flags as any)?.noShow && <Badge variant="destructive" className="text-[10px] px-1">No Show</Badge>}
                                              {(day.flags as any)?.late && <Badge variant="secondary" className="text-[10px] px-1">Tarde</Badge>}
                                              {(day.flags as any)?.autoCheckout && <Badge variant="outline" className="text-[10px] px-1">Auto</Badge>}
                                            </>
                                          )}
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </TableCell>
                        </TableRow>
                        );
                      })()}
                    </Fragment>
                  );
                })}
                {totals && (
                  <TableRow className="font-bold border-t-2" data-testid="row-payroll-totals">
                    <TableCell colSpan={12} className="text-right">TOTALES</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatColones(totals.basePayTotal)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{totals.extrasNet !== 0 ? formatColones(totals.extrasNet) : "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{formatColones(totals.servicePayTotal)}</TableCell>
                    {showCCSS && <TableCell className="text-right whitespace-nowrap">{formatColones(totals.ccssEmployee)}</TableCell>}
                    {showCCSS && <TableCell className="text-right whitespace-nowrap">{formatColones(totals.ccssEmployer)}</TableCell>}
                    <TableCell className="text-right whitespace-nowrap">{formatColones(showCCSS ? totals.netPay : totals.grandTotalPay)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="text-no-payroll-data">No hay datos para el rango seleccionado.</p>
        )}
      </CardContent>

      <Dialog open={!!rejectDialog} onOpenChange={(open) => { if (!open) { setRejectDialog(null); setRejectReason(""); } }}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle data-testid="text-reject-dialog-title">
              {rejectDialog?.bulk
                ? `Rechazar ${rejectDialog.days?.length || 0} día(s) de horas extra`
                : `Rechazar horas extra del ${rejectDialog?.businessDate || ""}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Razón del rechazo (obligatorio)</label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Escriba la razón del rechazo..."
                data-testid="input-reject-reason"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setRejectDialog(null); setRejectReason(""); }} data-testid="button-cancel-reject">
                Cancelar
              </Button>
              <Button variant="destructive" disabled={!rejectReason.trim()} onClick={confirmReject} data-testid="button-confirm-reject">
                Confirmar rechazo
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
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
                          style={{
                            background: p.status === "FINALIZED" ? 'var(--sage)' : 'var(--amber)',
                            color: p.status === "FINALIZED" ? 'white' : 'black'
                          }}
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle>Cargos a Empleados</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={chargesFilter === "pending" ? "default" : "outline"}
                onClick={() => setChargesFilter("pending")}
                data-testid="charges-filter-pending"
              >
                Pendientes
              </Button>
              <Button
                size="sm"
                variant={chargesFilter === "settled" ? "default" : "outline"}
                onClick={() => setChargesFilter("settled")}
                data-testid="charges-filter-settled"
              >
                Liquidados
              </Button>
              <Button size="sm" variant="outline" onClick={() => refetchCharges()} data-testid="charges-refresh">
                ↺ Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {chargesLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-charges">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : employeeCharges.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-charges">
              {chargesFilter === "pending" ? "No hay cargos pendientes." : "No hay cargos liquidados."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Descripción</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    {chargesFilter === "pending" && <TableHead className="text-center">Acción</TableHead>}
                    {chargesFilter === "settled" && <TableHead>Liquidado</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeCharges.map((c: any) => (
                    <TableRow key={c.id} data-testid={`row-charge-${c.id}`}>
                      <TableCell data-testid={`text-charge-employee-${c.id}`}>{c.employeeName ?? `#${c.employeeId}`}</TableCell>
                      <TableCell data-testid={`text-charge-date-${c.id}`}>{c.businessDate}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs truncate" data-testid={`text-charge-desc-${c.id}`}>
                        {c.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-charge-amount-${c.id}`}>
                        ₡{Number(c.amount).toLocaleString("es-CR", { minimumFractionDigits: 2 })}
                      </TableCell>
                      {chargesFilter === "pending" && (
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => settleChargeMutation.mutate(c.id)}
                            disabled={settleChargeMutation.isPending}
                            data-testid={`button-settle-charge-${c.id}`}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Liquidar
                          </Button>
                        </TableCell>
                      )}
                      {chargesFilter === "settled" && (
                        <TableCell data-testid={`text-charge-settled-at-${c.id}`} className="text-sm text-muted-foreground">
                          {c.settledAt ? new Date(c.settledAt).toLocaleDateString("es-CR") : "—"}
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
    </div>
  );
}
