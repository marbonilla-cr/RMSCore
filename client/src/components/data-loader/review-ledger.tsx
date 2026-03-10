import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Receipt, CreditCard, Users, FolderTree, ShoppingBag,
  Settings2, Armchair, ChevronDown, ChevronRight, Loader2, Package
} from "lucide-react";

interface LedgerData {
  business: any[];
  taxes: any[];
  paymentMethods: any[];
  employees: any[];
  categories: any[];
  categoryTree: Record<string, string[]>;
  products: any[];
  productsByCategory: Record<string, any[]>;
  modifierGroups: any[];
  modifiers: any[];
  modifiersByGroup: Record<string, any[]>;
  productModifiers: any[];
  tables: any[];
  hrConfig: any[];
  stats: Record<string, number>;
}

interface ReviewLedgerProps {
  sessionId: number;
  onEdited: () => void;
}

function InlineCell({
  value,
  rowId,
  field,
  fullData,
  onSaved,
  className = "",
}: {
  value: string;
  rowId: number;
  field: string;
  fullData: Record<string, any>;
  onSaved: () => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const patchMutation = useMutation({
    mutationFn: async (newValue: string) => {
      const { rowId: _rid, validationStatus: _vs, ...dataOnly } = fullData;
      const updated = { ...dataOnly, [field]: newValue };
      await apiRequest("PATCH", `/api/admin/data-loader/staging/${rowId}`, { dataJson: updated });
    },
    onSuccess: () => {
      setEditing(false);
      onSaved();
    },
  });

  if (editing) {
    return (
      <Input
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={() => {
          if (editValue !== value) {
            patchMutation.mutate(editValue);
          } else {
            setEditing(false);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (editValue !== value) patchMutation.mutate(editValue);
            else setEditing(false);
          } else if (e.key === "Escape") {
            setEditValue(value);
            setEditing(false);
          }
        }}
        autoFocus
        className={`h-7 px-1.5 text-sm ${className}`}
        disabled={patchMutation.isPending}
        data-testid={`ledger-edit-${field}-${rowId}`}
      />
    );
  }

  return (
    <span
      className={`cursor-pointer hover:bg-primary/10 px-1.5 py-0.5 rounded text-sm inline-block min-h-[24px] border border-transparent hover:border-primary/20 transition-colors ${className}`}
      onClick={() => setEditing(true)}
      data-testid={`ledger-cell-${field}-${rowId}`}
    >
      {value || "\u00A0"}
    </span>
  );
}

function CollapsibleSection({
  title,
  icon,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <CardHeader
        className="pb-2 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
        data-testid={`section-toggle-${title.toLowerCase().replace(/\s/g, "-")}`}
      >
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            {title}
            {count !== undefined && (
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {count}
              </Badge>
            )}
          </div>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export default function ReviewLedger({ sessionId, onEdited }: ReviewLedgerProps) {
  const { toast } = useToast();

  const { data: ledger, isLoading } = useQuery<LedgerData>({
    queryKey: ["/api/admin/data-loader/sessions", sessionId, "ledger"],
  });

  const handleSaved = () => {
    queryClient.invalidateQueries({
      queryKey: ["/api/admin/data-loader/sessions", sessionId, "ledger"],
    });
    queryClient.invalidateQueries({
      queryKey: ["/api/admin/data-loader/sessions", sessionId],
    });
    toast({ title: "Campo actualizado" });
    onEdited();
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando ledger...</span>
      </div>
    );
  }

  if (!ledger) return null;

  const biz = ledger.business[0] || {};

  return (
    <div className="space-y-3" data-testid="review-ledger">
      <div className="flex flex-wrap gap-2 mb-2">
        <Badge variant="outline" className="gap-1"><ShoppingBag className="h-3 w-3" />{ledger.stats.totalProducts} productos</Badge>
        <Badge variant="outline" className="gap-1"><FolderTree className="h-3 w-3" />{ledger.stats.totalCategories} categorías</Badge>
        <Badge variant="outline" className="gap-1"><Users className="h-3 w-3" />{ledger.stats.totalEmployees} empleados</Badge>
        <Badge variant="outline" className="gap-1"><Armchair className="h-3 w-3" />{ledger.stats.totalTables} mesas</Badge>
        <Badge variant="outline" className="gap-1"><Package className="h-3 w-3" />{ledger.stats.totalModifiers} modificadores</Badge>
      </div>

      <CollapsibleSection title="Negocio" icon={<Building2 className="h-4 w-4" />} defaultOpen={true}>
        {biz.rowId ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Nombre</span>
              <InlineCell value={biz.name || ""} rowId={biz.rowId} field="name" fullData={biz} onSaved={handleSaved} />
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Moneda</span>
              <InlineCell value={biz.currency || ""} rowId={biz.rowId} field="currency" fullData={biz} onSaved={handleSaved} />
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Zona horaria</span>
              <InlineCell value={biz.timezone || ""} rowId={biz.rowId} field="timezone" fullData={biz} onSaved={handleSaved} />
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Dirección</span>
              <InlineCell value={biz.address || ""} rowId={biz.rowId} field="address" fullData={biz} onSaved={handleSaved} />
            </div>
            <div>
              <span className="text-muted-foreground text-xs">% Servicio</span>
              <InlineCell value={biz.service_percentage || ""} rowId={biz.rowId} field="service_percentage" fullData={biz} onSaved={handleSaved} />
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Impuesto default</span>
              <InlineCell value={biz.default_tax || ""} rowId={biz.rowId} field="default_tax" fullData={biz} onSaved={handleSaved} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No hay datos de negocio</p>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Impuestos" icon={<Receipt className="h-4 w-4" />} count={ledger.stats.totalTaxes}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-1 px-1">Nombre</th>
                <th className="text-left py-1 px-1">%</th>
                <th className="text-left py-1 px-1">Inclusivo</th>
              </tr>
            </thead>
            <tbody>
              {ledger.taxes.map((t: any) => (
                <tr key={t.rowId} className="border-b border-dashed" data-testid={`ledger-tax-${t.rowId}`}>
                  <td className="py-0.5 px-1"><InlineCell value={t.tax_name || ""} rowId={t.rowId} field="tax_name" fullData={t} onSaved={handleSaved} /></td>
                  <td className="py-0.5 px-1"><InlineCell value={t.percentage || ""} rowId={t.rowId} field="percentage" fullData={t} onSaved={handleSaved} className="w-16" /></td>
                  <td className="py-0.5 px-1"><InlineCell value={t.inclusive || ""} rowId={t.rowId} field="inclusive" fullData={t} onSaved={handleSaved} className="w-16" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Métodos de Pago" icon={<CreditCard className="h-4 w-4" />} count={ledger.stats.totalPaymentMethods}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-1 px-1">Nombre</th>
                <th className="text-left py-1 px-1">Tipo</th>
                <th className="text-left py-1 px-1">Activo</th>
              </tr>
            </thead>
            <tbody>
              {ledger.paymentMethods.map((pm: any) => (
                <tr key={pm.rowId} className="border-b border-dashed" data-testid={`ledger-pm-${pm.rowId}`}>
                  <td className="py-0.5 px-1"><InlineCell value={pm.payment_name || ""} rowId={pm.rowId} field="payment_name" fullData={pm} onSaved={handleSaved} /></td>
                  <td className="py-0.5 px-1"><InlineCell value={pm.type || ""} rowId={pm.rowId} field="type" fullData={pm} onSaved={handleSaved} className="w-20" /></td>
                  <td className="py-0.5 px-1"><InlineCell value={pm.active || ""} rowId={pm.rowId} field="active" fullData={pm} onSaved={handleSaved} className="w-16" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Empleados" icon={<Users className="h-4 w-4" />} count={ledger.stats.totalEmployees}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-1 px-1">Nombre</th>
                <th className="text-left py-1 px-1">Rol</th>
                <th className="text-left py-1 px-1">Activo</th>
              </tr>
            </thead>
            <tbody>
              {ledger.employees.map((emp: any) => (
                <tr key={emp.rowId} className="border-b border-dashed" data-testid={`ledger-emp-${emp.rowId}`}>
                  <td className="py-0.5 px-1"><InlineCell value={emp.employee_name || ""} rowId={emp.rowId} field="employee_name" fullData={emp} onSaved={handleSaved} /></td>
                  <td className="py-0.5 px-1"><InlineCell value={emp.role || ""} rowId={emp.rowId} field="role" fullData={emp} onSaved={handleSaved} className="w-24" /></td>
                  <td className="py-0.5 px-1"><InlineCell value={emp.active || ""} rowId={emp.rowId} field="active" fullData={emp} onSaved={handleSaved} className="w-16" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Menú" icon={<FolderTree className="h-4 w-4" />} count={ledger.stats.totalProducts} defaultOpen={true}>
        <div className="space-y-4">
          {Object.entries(ledger.categoryTree).map(([parent, children]) => (
            <div key={parent}>
              <h4 className="font-semibold text-sm mb-1 text-primary">{parent}</h4>
              {(children as string[]).map((child) => {
                const prods = ledger.productsByCategory[child] || [];
                return (
                  <div key={child} className="ml-4 mb-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded">{child}</span>
                      <span className="text-xs text-muted-foreground">({prods.length})</span>
                    </div>
                    {prods.length > 0 && (
                      <div className="ml-2 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-muted-foreground">
                              <th className="text-left py-0.5 px-1">Producto</th>
                              <th className="text-left py-0.5 px-1">Precio</th>
                              <th className="text-left py-0.5 px-1">Impuesto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {prods.map((p: any) => (
                              <tr key={p.rowId} className="border-b border-dashed" data-testid={`ledger-prod-${p.rowId}`}>
                                <td className="py-0.5 px-1"><InlineCell value={p.product_name || ""} rowId={p.rowId} field="product_name" fullData={p} onSaved={handleSaved} /></td>
                                <td className="py-0.5 px-1"><InlineCell value={p.price || ""} rowId={p.rowId} field="price" fullData={p} onSaved={handleSaved} className="w-20" /></td>
                                <td className="py-0.5 px-1"><InlineCell value={p.tax || ""} rowId={p.rowId} field="tax" fullData={p} onSaved={handleSaved} className="w-16" /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Modificadores" icon={<Settings2 className="h-4 w-4" />} count={ledger.stats.totalModifierGroups}>
        <div className="space-y-3">
          {ledger.modifierGroups.map((grp: any) => {
            const grpMods = ledger.modifiersByGroup[grp.group_name] || [];
            return (
              <div key={grp.rowId}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">
                    <InlineCell value={grp.group_name || ""} rowId={grp.rowId} field="group_name" fullData={grp} onSaved={handleSaved} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Req: <InlineCell value={grp.required || ""} rowId={grp.rowId} field="required" fullData={grp} onSaved={handleSaved} className="w-12 inline" />
                    | Max: <InlineCell value={grp.max_select || ""} rowId={grp.rowId} field="max_select" fullData={grp} onSaved={handleSaved} className="w-10 inline" />
                  </span>
                </div>
                {grpMods.length > 0 && (
                  <div className="ml-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted-foreground">
                          <th className="text-left py-0.5 px-1">Modificador</th>
                          <th className="text-left py-0.5 px-1">Precio</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grpMods.map((m: any) => (
                          <tr key={m.rowId} className="border-b border-dashed" data-testid={`ledger-mod-${m.rowId}`}>
                            <td className="py-0.5 px-1"><InlineCell value={m.modifier_name || ""} rowId={m.rowId} field="modifier_name" fullData={m} onSaved={handleSaved} /></td>
                            <td className="py-0.5 px-1"><InlineCell value={m.price || ""} rowId={m.rowId} field="price" fullData={m} onSaved={handleSaved} className="w-20" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Mesas" icon={<Armchair className="h-4 w-4" />} count={ledger.stats.totalTables}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-1 px-1">Nombre</th>
                <th className="text-left py-1 px-1">Área</th>
                <th className="text-left py-1 px-1">Capacidad</th>
              </tr>
            </thead>
            <tbody>
              {ledger.tables.map((t: any) => (
                <tr key={t.rowId} className="border-b border-dashed" data-testid={`ledger-table-${t.rowId}`}>
                  <td className="py-0.5 px-1"><InlineCell value={t.table_name || ""} rowId={t.rowId} field="table_name" fullData={t} onSaved={handleSaved} /></td>
                  <td className="py-0.5 px-1"><InlineCell value={t.area || ""} rowId={t.rowId} field="area" fullData={t} onSaved={handleSaved} className="w-24" /></td>
                  <td className="py-0.5 px-1"><InlineCell value={t.capacity || ""} rowId={t.rowId} field="capacity" fullData={t} onSaved={handleSaved} className="w-16" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Configuración HR" icon={<Settings2 className="h-4 w-4" />}>
        {ledger.hrConfig.length > 0 ? (
          <div className="text-sm space-y-1">
            {ledger.hrConfig.map((hr: any) => (
              <div key={hr.rowId} className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-muted-foreground text-xs">% Servicio</span>
                  <InlineCell value={hr.service_percentage || ""} rowId={hr.rowId} field="service_percentage" fullData={hr} onSaved={handleSaved} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No hay configuración HR</p>
        )}
      </CollapsibleSection>
    </div>
  );
}
