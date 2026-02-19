import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Plus, Edit, Trash2, ChevronDown, ChevronRight } from "lucide-react";

interface Supplier {
  id: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  leadTimeDays: number;
  isActive: boolean;
  notes: string | null;
}

interface SupplierItem {
  id: number;
  supplierId: number;
  invItemId: number;
  purchaseUom: string;
  lastPricePerPurchaseUom: string;
  isPreferred: boolean;
  itemName?: string;
  itemSku?: string;
}

const emptyForm = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  leadTimeDays: 0,
  notes: "",
};

export default function SuppliersPage() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/inv/suppliers"],
  });

  const { data: supplierItems } = useQuery<SupplierItem[]>({
    queryKey: ["/api/inv/suppliers", expandedId, "items"],
    enabled: expandedId !== null,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof emptyForm) => {
      await apiRequest("POST", "/api/inv/suppliers", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/suppliers"] });
      toast({ title: "Proveedor creado" });
      setCreateOpen(false);
      setForm(emptyForm);
    },
    onError: (err: Error) => {
      toast({ title: "Error al crear proveedor", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof emptyForm }) => {
      await apiRequest("PATCH", `/api/inv/suppliers/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/suppliers"] });
      toast({ title: "Proveedor actualizado" });
      setEditingSupplier(null);
      setForm(emptyForm);
    },
    onError: (err: Error) => {
      toast({ title: "Error al actualizar", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/inv/suppliers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/suppliers"] });
      toast({ title: "Proveedor desactivado" });
    },
    onError: (err: Error) => {
      toast({ title: "Error al desactivar", description: err.message, variant: "destructive" });
    },
  });

  function openCreate() {
    setForm(emptyForm);
    setCreateOpen(true);
  }

  function openEdit(s: Supplier) {
    setForm({
      name: s.name,
      contactName: s.contactName || "",
      phone: s.phone || "",
      email: s.email || "",
      leadTimeDays: s.leadTimeDays,
      notes: s.notes || "",
    });
    setEditingSupplier(s);
  }

  function handleSubmit() {
    if (!form.name.trim()) {
      toast({ title: "Nombre requerido", variant: "destructive" });
      return;
    }
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function toggleExpand(id: number) {
    setExpandedId(expandedId === id ? null : id);
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const dialogOpen = createOpen || !!editingSupplier;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title" data-testid="text-suppliers-title">Proveedores</h1>
        <Button data-testid="button-create-supplier" onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Proveedor
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Lista de Proveedores</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-4" data-testid="loading-suppliers">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : !suppliers || suppliers.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-suppliers">
              No hay proveedores registrados.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table data-testid="table-suppliers">
                <TableHeader>
                  <TableRow>
                    <TableHead></TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Lead Time</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.map((s) => (
                    <>
                      <TableRow key={s.id} data-testid={`row-supplier-${s.id}`}>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            data-testid={`button-expand-supplier-${s.id}`}
                            onClick={() => toggleExpand(s.id)}
                          >
                            {expandedId === s.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium" data-testid={`text-supplier-name-${s.id}`}>
                          <button
                            className="text-left underline-offset-2 hover:underline"
                            data-testid={`link-supplier-${s.id}`}
                            onClick={() => toggleExpand(s.id)}
                          >
                            {s.name}
                          </button>
                        </TableCell>
                        <TableCell data-testid={`text-supplier-contact-${s.id}`}>{s.contactName || "-"}</TableCell>
                        <TableCell data-testid={`text-supplier-phone-${s.id}`}>{s.phone || "-"}</TableCell>
                        <TableCell data-testid={`text-supplier-email-${s.id}`}>{s.email || "-"}</TableCell>
                        <TableCell data-testid={`text-supplier-leadtime-${s.id}`}>{s.leadTimeDays} días</TableCell>
                        <TableCell data-testid={`badge-supplier-status-${s.id}`}>
                          <Badge variant={s.isActive ? "default" : "secondary"}>
                            {s.isActive ? "Activo" : "Inactivo"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              data-testid={`button-edit-supplier-${s.id}`}
                              onClick={() => openEdit(s)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              data-testid={`button-delete-supplier-${s.id}`}
                              onClick={() => deleteMutation.mutate(s.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedId === s.id && (
                        <TableRow key={`items-${s.id}`}>
                          <TableCell colSpan={8} className="bg-muted/30 p-4">
                            {!supplierItems ? (
                              <div className="flex justify-center p-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                              </div>
                            ) : supplierItems.length === 0 ? (
                              <p className="text-sm text-muted-foreground" data-testid={`text-no-items-${s.id}`}>
                                Sin artículos asociados.
                              </p>
                            ) : (
                              <Table data-testid={`table-supplier-items-${s.id}`}>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Artículo</TableHead>
                                    <TableHead>UOM Compra</TableHead>
                                    <TableHead>Último Precio</TableHead>
                                    <TableHead>Preferido</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {supplierItems.map((si) => (
                                    <TableRow key={si.id} data-testid={`row-supplier-item-${si.id}`}>
                                      <TableCell data-testid={`text-si-sku-${si.id}`}>{si.itemSku || "-"}</TableCell>
                                      <TableCell data-testid={`text-si-name-${si.id}`}>{si.itemName || `Item #${si.invItemId}`}</TableCell>
                                      <TableCell data-testid={`text-si-uom-${si.id}`}>{si.purchaseUom}</TableCell>
                                      <TableCell data-testid={`text-si-price-${si.id}`}>{Number(si.lastPricePerPurchaseUom).toFixed(2)}</TableCell>
                                      <TableCell data-testid={`badge-si-preferred-${si.id}`}>
                                        {si.isPreferred && <Badge variant="default">Sí</Badge>}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            )}
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) { setCreateOpen(false); setEditingSupplier(null); } }}>
        <DialogContent data-testid="dialog-supplier">
          <DialogHeader>
            <DialogTitle>{editingSupplier ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nombre *</Label>
              <Input
                data-testid="input-supplier-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nombre del proveedor"
              />
            </div>
            <div className="space-y-1">
              <Label>Contacto</Label>
              <Input
                data-testid="input-supplier-contact"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                placeholder="Nombre de contacto"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Teléfono</Label>
                <Input
                  data-testid="input-supplier-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="Teléfono"
                />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input
                  data-testid="input-supplier-email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Email"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Lead Time (días)</Label>
              <Input
                data-testid="input-supplier-leadtime"
                type="number"
                value={form.leadTimeDays}
                onChange={(e) => setForm({ ...form, leadTimeDays: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1">
              <Label>Notas</Label>
              <Input
                data-testid="input-supplier-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Notas opcionales"
              />
            </div>
            <div className="flex justify-end gap-2 flex-wrap">
              <Button
                variant="outline"
                data-testid="button-cancel-supplier"
                onClick={() => { setCreateOpen(false); setEditingSupplier(null); }}
              >
                Cancelar
              </Button>
              <Button
                data-testid="button-save-supplier"
                onClick={handleSubmit}
                disabled={isPending}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
