import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ChevronDown, ChevronRight, Plus, Pencil, Trash2, Settings2 } from "lucide-react";
import type { ModifierGroup, ModifierOption } from "@shared/schema";

type GroupWithOptions = ModifierGroup & { options: ModifierOption[] };

export default function AdminModifiersPage() {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editGroup, setEditGroup] = useState<GroupWithOptions | null>(null);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", required: false, multiSelect: true, sortOrder: 0 });

  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const [optionGroupId, setOptionGroupId] = useState<number>(0);
  const [editOption, setEditOption] = useState<ModifierOption | null>(null);
  const [optionForm, setOptionForm] = useState({ name: "", priceDelta: "0", sortOrder: 0 });

  const { data: groups = [], isLoading } = useQuery<GroupWithOptions[]>({
    queryKey: ["/api/admin/modifier-groups"],
  });

  const saveGroupMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editGroup) {
        return apiRequest("PATCH", `/api/admin/modifier-groups/${editGroup.id}`, data);
      }
      return apiRequest("POST", "/api/admin/modifier-groups", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modifier-groups"] });
      setGroupDialogOpen(false);
      setEditGroup(null);
      toast({ title: editGroup ? "Grupo actualizado" : "Grupo creado" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const saveOptionMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editOption) {
        return apiRequest("PATCH", `/api/admin/modifier-options/${editOption.id}`, data);
      }
      return apiRequest("POST", `/api/admin/modifier-groups/${optionGroupId}/options`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modifier-groups"] });
      setOptionDialogOpen(false);
      setEditOption(null);
      toast({ title: editOption ? "Opción actualizada" : "Opción creada" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteOptionMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/admin/modifier-options/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modifier-groups"] });
      toast({ title: "Opción eliminada" });
    },
  });

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreateGroup = () => {
    setEditGroup(null);
    setGroupForm({ name: "", required: false, multiSelect: true, sortOrder: 0 });
    setGroupDialogOpen(true);
  };

  const openEditGroup = (g: GroupWithOptions) => {
    setEditGroup(g);
    setGroupForm({ name: g.name, required: g.required, multiSelect: g.multiSelect, sortOrder: g.sortOrder });
    setGroupDialogOpen(true);
  };

  const openCreateOption = (groupId: number) => {
    setEditOption(null);
    setOptionGroupId(groupId);
    setOptionForm({ name: "", priceDelta: "0", sortOrder: 0 });
    setOptionDialogOpen(true);
  };

  const openEditOption = (opt: ModifierOption, groupId: number) => {
    setEditOption(opt);
    setOptionGroupId(groupId);
    setOptionForm({ name: opt.name, priceDelta: opt.priceDelta, sortOrder: opt.sortOrder });
    setOptionDialogOpen(true);
  };

  const formatPrice = (val: string) => {
    const n = parseFloat(val);
    if (isNaN(n) || n === 0) return "";
    return `₡${n.toLocaleString("es-CR")}`;
  };

  return (
    <div className="p-3 md:p-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Settings2 className="w-6 h-6" />
            Modificadores
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Grupos de modificadores y opciones para productos</p>
        </div>
        <Button onClick={openCreateGroup} data-testid="button-add-modifier-group">
          <Plus className="w-4 h-4" />
          <span className="ml-1">Nuevo Grupo</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Settings2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No hay grupos de modificadores</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Card key={g.id} data-testid={`card-modifier-group-${g.id}`}>
              <CardContent className="py-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <button
                    className="flex items-center gap-2 min-w-0 text-left min-h-[48px]"
                    onClick={() => toggleExpand(g.id)}
                    data-testid={`button-toggle-group-${g.id}`}
                  >
                    {expanded.has(g.id) ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                    <span className="font-medium truncate">{g.name}</span>
                    <Badge variant="secondary" className="ml-1">{g.options.length} opc.</Badge>
                  </button>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!g.active && <Badge variant="secondary">Inactivo</Badge>}
                    <Button size="icon" variant="ghost" onClick={() => openEditGroup(g)} data-testid={`button-edit-group-${g.id}`}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                {expanded.has(g.id) && (
                  <div className="mt-3 ml-6 space-y-1">
                    {g.options.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">Sin opciones</p>
                    )}
                    {g.options.map((opt) => (
                      <div key={opt.id} className="flex items-center justify-between gap-2 py-1 min-h-[48px]" data-testid={`row-option-${opt.id}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm truncate">{opt.name}</span>
                          {parseFloat(opt.priceDelta) !== 0 && (
                            <Badge variant="outline">{formatPrice(opt.priceDelta)}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0" style={{ visibility: "visible" }}>
                          <Button size="icon" variant="ghost" onClick={() => openEditOption(opt, g.id)} data-testid={`button-edit-option-${opt.id}`}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteOptionMutation.mutate(opt.id)} data-testid={`button-delete-option-${opt.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="mt-2" onClick={() => openCreateOption(g.id)} data-testid={`button-add-option-${g.id}`}>
                      <Plus className="w-3 h-3 mr-1" /> Agregar opción
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editGroup ? "Editar Grupo" : "Nuevo Grupo"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveGroupMutation.mutate(groupForm); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                data-testid="input-group-name"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Orden</Label>
              <Input
                type="number"
                value={groupForm.sortOrder}
                onChange={(e) => setGroupForm({ ...groupForm, sortOrder: parseInt(e.target.value) || 0 })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={saveGroupMutation.isPending} data-testid="button-save-group">
              {saveGroupMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {editGroup ? "Guardar" : "Crear"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={optionDialogOpen} onOpenChange={setOptionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editOption ? "Editar Opción" : "Nueva Opción"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveOptionMutation.mutate(optionForm); }} className="space-y-4">
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                data-testid="input-option-name"
                value={optionForm.name}
                onChange={(e) => setOptionForm({ ...optionForm, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Precio adicional (₡)</Label>
              <Input
                data-testid="input-option-price"
                type="number"
                value={optionForm.priceDelta}
                onChange={(e) => setOptionForm({ ...optionForm, priceDelta: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Orden</Label>
              <Input
                type="number"
                value={optionForm.sortOrder}
                onChange={(e) => setOptionForm({ ...optionForm, sortOrder: parseInt(e.target.value) || 0 })}
              />
            </div>
            <Button type="submit" className="w-full" disabled={saveOptionMutation.isPending} data-testid="button-save-option">
              {saveOptionMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {editOption ? "Guardar" : "Crear"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
