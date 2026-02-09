import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, QrCode, Grid3x3, Loader2, ExternalLink } from "lucide-react";
import type { Table as RestTable } from "@shared/schema";

export default function AdminTablesPage() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RestTable | null>(null);
  const [form, setForm] = useState({ tableCode: "", tableName: "", active: true, sortOrder: 0 });

  const { data: tables = [], isLoading } = useQuery<RestTable[]>({
    queryKey: ["/api/admin/tables"],
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editing) {
        return apiRequest("PATCH", `/api/admin/tables/${editing.id}`, data);
      }
      return apiRequest("POST", "/api/admin/tables", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/tables"] });
      setOpen(false);
      setEditing(null);
      toast({ title: editing ? "Mesa actualizada" : "Mesa creada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ tableCode: "", tableName: "", active: true, sortOrder: 0 });
    setOpen(true);
  };

  const openEdit = (table: RestTable) => {
    setEditing(table);
    setForm({
      tableCode: table.tableCode,
      tableName: table.tableName,
      active: table.active,
      sortOrder: table.sortOrder,
    });
    setOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Grid3x3 className="w-6 h-6" />
            Administrar Mesas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Gestione las mesas del restaurante y sus códigos QR</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate} data-testid="button-add-table">
              <Plus className="w-4 h-4" />
              <span className="ml-1">Nueva Mesa</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar Mesa" : "Nueva Mesa"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Código de Mesa</Label>
                <Input
                  data-testid="input-table-code"
                  value={form.tableCode}
                  onChange={(e) => setForm({ ...form, tableCode: e.target.value })}
                  placeholder="M01"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  data-testid="input-table-name"
                  value={form.tableName}
                  onChange={(e) => setForm({ ...form, tableName: e.target.value })}
                  placeholder="Mesa 1"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Orden</Label>
                <Input
                  type="number"
                  data-testid="input-table-sort"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  data-testid="switch-table-active"
                  checked={form.active}
                  onCheckedChange={(c) => setForm({ ...form, active: c })}
                />
                <Label>Activa</Label>
              </div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending} data-testid="button-save-table">
                {saveMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                {editing ? "Guardar Cambios" : "Crear Mesa"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : tables.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Grid3x3 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay mesas configuradas</p>
            <Button variant="outline" className="mt-4" onClick={openCreate} data-testid="button-add-table-empty">
              <Plus className="w-4 h-4 mr-1" />
              Crear primera mesa
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {tables.map((table) => (
            <Card key={table.id} data-testid={`card-table-${table.id}`}>
              <CardContent className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-accent flex items-center justify-center flex-shrink-0">
                    <Grid3x3 className="w-5 h-5 text-accent-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{table.tableName}</p>
                    <p className="text-xs text-muted-foreground">Código: {table.tableCode}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={table.active ? "default" : "secondary"}>
                    {table.active ? "Activa" : "Inactiva"}
                  </Badge>
                  <Button size="icon" variant="ghost" onClick={() => window.open(`/qr/${table.tableCode}`, '_blank')} data-testid={`button-open-qr-client-${table.id}`} title="Abrir UI Cliente">
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => window.open(`/api/admin/tables/${table.id}/qr`, '_blank')} data-testid={`button-qr-${table.id}`} title="Ver QR">
                    <QrCode className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant="ghost" onClick={() => openEdit(table)} data-testid={`button-edit-table-${table.id}`} title="Editar">
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
