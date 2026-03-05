import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
} from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Loader2, Plus, Search, Trash2, Upload, ArrowUp, ArrowDown, ArrowUpDown, Pencil, CheckCircle2, AlertCircle, StickyNote, Calculator } from "lucide-react";

interface InvItem {
  id: number;
  sku: string;
  name: string;
  itemType: string;
  category: string;
  baseUom: string;
  onHandQtyBase: string;
  reorderPointQtyBase: string;
  parLevelQtyBase: string;
  isActive: boolean;
  isPerishable: boolean;
  notes: string | null;
  avgCostPerBaseUom: string;
  lastCostPerBaseUom: string;
  unitWeightG: string | null;
  purchasePresentation: string | null;
  purchaseQtyPerBaseUom: string | null;
  lastCostPerPresentation: string | null;
  defaultSupplierId: number | null;
  supplierName: string | null;
}

interface Supplier {
  id: number;
  name: string;
}

const UOM_OPTIONS = [
  { value: "KG", label: "KG - Kilogramo" },
  { value: "G", label: "G - Gramo" },
  { value: "L", label: "L - Litro" },
  { value: "ML", label: "ML - Mililitro" },
  { value: "UNIT", label: "UNIT - Unidad" },
  { value: "PORTION", label: "PORTION - Porción" },
];

const ITEM_TYPE_OPTIONS = [
  { value: "AP", label: "AP (Materia Prima)" },
  { value: "EP", label: "EP (Elaborado)" },
];

const COST_HELPERS: Record<string, string> = {
  KG: "₡ por 1 KG (Ej: ₡700 si 1 KG cuesta ₡700)",
  L: "₡ por 1 L (Ej: ₡1200 si 1 L cuesta ₡1200)",
  UNIT: "₡ por 1 unidad (Ej: ₡250 si 1 unidad cuesta ₡250)",
  G: "₡ por 1 g (normalmente un número pequeño)",
  ML: "₡ por 1 ml (normalmente un número pequeño)",
  PORTION: "₡ por 1 porción",
};

const PRESENTATION_OPTIONS = [
  { value: "Bolsa", label: "Bolsa" },
  { value: "Caja", label: "Caja" },
  { value: "Paquete", label: "Paquete" },
  { value: "Botella", label: "Botella" },
  { value: "Saco", label: "Saco" },
  { value: "Lata", label: "Lata" },
  { value: "Unidad", label: "Unidad" },
  { value: "Rollo", label: "Rollo" },
  { value: "Garrafa", label: "Garrafa" },
];

const CATEGORIES = [
  "General", "Abarrotes", "Carnes", "Lácteos", "Verduras", "Frutas",
  "Granos", "Aceites", "Condimentos", "Bebidas", "Limpieza",
  "Desechables", "Porciones", "Otros",
];

const formSchema = z.object({
  sku: z.string().min(1, "SKU requerido"),
  name: z.string().min(1, "Nombre requerido"),
  itemType: z.string().min(1, "Tipo requerido"),
  category: z.string().min(1, "Categoría requerida"),
  baseUom: z.string().min(1, "UOM requerida"),
  onHandQtyBase: z.string().min(1, "Stock inicial requerido"),
  reorderPointQtyBase: z.string().default("0"),
  parLevelQtyBase: z.string().default("0"),
  lastCostPerBaseUom: z.coerce.number().min(0).default(0),
  avgCostPerBaseUom: z.coerce.number().min(0).optional(),
  purchasePresentation: z.string().optional(),
  purchaseQtyPerBaseUom: z.coerce.number().min(0).optional(),
  lastCostPerPresentation: z.coerce.number().min(0).optional(),
  unitWeightG: z.coerce.number().min(0).optional(),
  isPerishable: z.boolean().default(false),
  notes: z.string().optional(),
  defaultSupplierId: z.coerce.number().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function stockBadge(onHand: string, reorderPoint: string) {
  const qty = parseFloat(onHand);
  const reorder = parseFloat(reorderPoint);
  if (qty <= 0) return <Badge variant="destructive" data-testid="badge-stock-red">Sin stock</Badge>;
  if (qty <= reorder) return <Badge className="text-white" style={{ background: 'var(--amber)' }} data-testid="badge-stock-yellow">Bajo</Badge>;
  return <Badge className="text-white" style={{ background: 'var(--sage)' }} data-testid="badge-stock-green">OK</Badge>;
}

function stockLevel(onHand: string, reorderPoint: string): number {
  const qty = parseFloat(onHand);
  const reorder = parseFloat(reorderPoint);
  if (qty <= 0) return 0;
  if (qty <= reorder) return 1;
  return 2;
}

function parseImportText(text: string) {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length === 0) return [];
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes("sku") || firstLine.includes("nombre") || firstLine.includes("name");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map(line => {
    const parts = line.split("\t").length > 1 ? line.split("\t") : line.split(",");
    return {
      sku: (parts[0] || "").trim(),
      name: (parts[1] || "").trim(),
      category: (parts[2] || "General").trim(),
      baseUom: (parts[3] || "UNIT").trim(),
      onHandQtyBase: (parts[4] || "0").trim(),
      reorderPointQtyBase: (parts[5] || "0").trim(),
      parLevelQtyBase: (parts[6] || "0").trim(),
      isPerishable: (parts[7] || "").trim().toLowerCase() === "true" || (parts[7] || "").trim() === "1",
    };
  }).filter(item => item.sku && item.name);
}

type SortKey = "name" | "category" | "supplierName" | "onHand" | "reorderPoint" | "parLevel" | "cost" | "status";
type SortDir = "asc" | "desc";

function EditableTextCell({ value, onSave, itemId, field, className }: {
  value: string;
  onSave: (val: string) => void;
  itemId: number;
  field: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
  };

  if (!editing) {
    return (
      <div
        className={`cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded min-h-[28px] flex items-center ${className || ""}`}
        onClick={() => setEditing(true)}
        data-testid={`cell-${field}-${itemId}`}
      >
        <span className="truncate">{value}</span>
      </div>
    );
  }

  return (
    <Input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
      className="h-7 text-sm px-1"
      data-testid={`input-${field}-${itemId}`}
    />
  );
}

function EditableNumberCell({ value, onSave, itemId, field, step }: {
  value: string;
  onSave: (val: string) => void;
  itemId: number;
  field: string;
  step?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const displayVal = parseFloat(value || "0");

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select(); } }, [editing]);

  const commit = () => {
    setEditing(false);
    const num = parseFloat(draft);
    if (!isNaN(num) && draft !== value) onSave(String(num));
    else setDraft(value);
  };

  if (!editing) {
    return (
      <div
        className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded text-right min-h-[28px] flex items-center justify-end"
        onClick={() => setEditing(true)}
        data-testid={`cell-${field}-${itemId}`}
      >
        {displayVal.toFixed(2)}
      </div>
    );
  }

  return (
    <Input
      ref={inputRef}
      type="number"
      step={step || "0.01"}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
      className="h-7 text-sm px-1 text-right"
      data-testid={`input-${field}-${itemId}`}
    />
  );
}

function EditableSelectCell({ value, options, onSave, itemId, field, placeholder }: {
  value: string;
  options: { value: string; label: string }[];
  onSave: (val: string) => void;
  itemId: number;
  field: string;
  placeholder?: string;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={(v) => { if (v !== value) onSave(v); }}>
      <SelectTrigger className="h-7 text-sm px-1 border-0 shadow-none hover:bg-muted/50" data-testid={`select-${field}-${itemId}`}>
        <SelectValue placeholder={placeholder || "—"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function EditableSupplierCell({ value, supplierId, suppliers, onSave, itemId }: {
  value: string | null;
  supplierId: number | null;
  suppliers: Supplier[];
  onSave: (supplierId: number | null) => void;
  itemId: number;
}) {
  const currentVal = supplierId ? String(supplierId) : "__none__";
  return (
    <Select value={currentVal} onValueChange={(v) => {
      const newId = v === "__none__" ? null : Number(v);
      if (newId !== supplierId) onSave(newId);
    }}>
      <SelectTrigger className="h-7 text-sm px-1 border-0 shadow-none hover:bg-muted/50" data-testid={`select-supplier-${itemId}`}>
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Sin proveedor</SelectItem>
        {suppliers.map((s) => (
          <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortHeader({ label, sortKey, currentSort, onSort, className }: {
  label: string;
  sortKey: SortKey;
  currentSort: { key: SortKey; dir: SortDir } | null;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = currentSort?.key === sortKey;
  return (
    <th
      className={`px-2 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap ${className || ""}`}
      onClick={() => onSort(sortKey)}
      data-testid={`header-sort-${sortKey}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          currentSort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-30" />
        )}
      </span>
    </th>
  );
}

function NotesPopover({ itemId, initialNotes, onSave }: { itemId: number; initialNotes: string; onSave: (val: string) => void }) {
  const [draft, setDraft] = useState(initialNotes);
  const committed = useRef(false);

  useEffect(() => { setDraft(initialNotes); committed.current = false; }, [initialNotes]);

  const commit = () => {
    if (!committed.current && draft !== initialNotes) {
      committed.current = true;
      onSave(draft);
    }
  };

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">Notas</label>
      <Textarea
        value={draft}
        onChange={(e) => { setDraft(e.target.value); committed.current = false; }}
        onBlur={commit}
        rows={3}
        className="text-sm"
        placeholder="Observaciones..."
        data-testid={`textarea-notes-${itemId}`}
      />
    </div>
  );
}

export default function InventoryItems() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("__all__");
  const [typeFilter, setTypeFilter] = useState("__all__");
  const [supplierFilter, setSupplierFilter] = useState("__all__");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<any[]>([]);
  const [importResults, setImportResults] = useState<{created: number; skipped: number; errors: string[]} | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InvItem | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const [mobileEditItem, setMobileEditItem] = useState<InvItem | null>(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());

  const { data: items, isLoading } = useQuery<InvItem[]>({
    queryKey: ["/api/inv/items"],
  });

  const { data: suppliers } = useQuery<Supplier[]>({
    queryKey: ["/api/inv/suppliers"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sku: "",
      name: "",
      itemType: "AP",
      category: "General",
      baseUom: "UNIT",
      onHandQtyBase: "",
      reorderPointQtyBase: "0",
      parLevelQtyBase: "0",
      lastCostPerBaseUom: 0,
      avgCostPerBaseUom: undefined,
      unitWeightG: undefined,
      isPerishable: false,
      notes: "",
      defaultSupplierId: undefined,
    },
  });

  const watchBaseUom = form.watch("baseUom");
  const watchUnitWeightG = form.watch("unitWeightG");

  const createMutation = useMutation({
    mutationFn: async (data: FormValues) => {
      const payload: any = { ...data };
      if (data.avgCostPerBaseUom == null || isNaN(data.avgCostPerBaseUom)) delete payload.avgCostPerBaseUom;
      if (data.unitWeightG == null || isNaN(data.unitWeightG)) delete payload.unitWeightG;
      await apiRequest("POST", "/api/inv/items", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: "Insumo creado" });
      setDialogOpen(false);
      form.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (importItems: any[]) => {
      const res = await apiRequest("POST", "/api/inv/items/bulk-import", { items: importItems });
      return res.json();
    },
    onSuccess: (data: any) => {
      setImportResults(data);
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: `Importación completada: ${data.created} creados, ${data.skipped} omitidos` });
    },
    onError: (err: Error) => {
      toast({ title: "Error en importación", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const res = await apiRequest("DELETE", `/api/inv/items/${itemId}`);
      return res.json();
    },
    onSuccess: (data: { hardDeleted: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({
        title: data.hardDeleted ? "Insumo eliminado permanentemente" : "Insumo desactivado",
        description: data.hardDeleted ? "El insumo fue eliminado de la base de datos." : "El insumo tiene registros relacionados y fue desactivado.",
      });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error al eliminar", description: err.message, variant: "destructive" });
    },
  });

  const recalcMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/inv/items/recalc-avg-cost");
      return res.json();
    },
    onSuccess: (data: { updated: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: "Costos recalculados", description: `${data.updated} insumos actualizados (promedio = último costo).` });
    },
    onError: (err: Error) => {
      toast({ title: "Error al recalcular", description: err.message, variant: "destructive" });
    },
  });

  const patchItem = useCallback(async (itemId: number, field: string, value: any) => {
    const cellKey = `${itemId}_${field}`;
    setSavingCells(prev => new Set(prev).add(cellKey));
    try {
      queryClient.setQueryData<InvItem[]>(["/api/inv/items"], (old) => {
        if (!old) return old;
        return old.map(item => {
          if (item.id !== itemId) return item;
          const updated = { ...item };
          if (field === "name") updated.name = value;
          else if (field === "category") updated.category = value;
          else if (field === "defaultSupplierId") {
            updated.defaultSupplierId = value;
            updated.supplierName = value ? (suppliers || []).find(s => s.id === value)?.name || null : null;
          }
          else if (field === "reorderPointQtyBase") updated.reorderPointQtyBase = value;
          else if (field === "parLevelQtyBase") updated.parLevelQtyBase = value;
          else if (field === "lastCostPerBaseUom") updated.lastCostPerBaseUom = value;
          else if (field === "unitWeightG") updated.unitWeightG = value != null ? String(value) : null;
          else if (field === "isPerishable") updated.isPerishable = value;
          else if (field === "notes") updated.notes = value || null;
          else if (field === "baseUom") updated.baseUom = value;
          else if (field === "purchasePresentation") updated.purchasePresentation = value;
          else if (field === "purchaseQtyPerBaseUom") updated.purchaseQtyPerBaseUom = value != null ? String(value) : null;
          else if (field === "lastCostPerPresentation") updated.lastCostPerPresentation = value != null ? String(value) : null;
          return updated;
        });
      });
      await apiRequest("PATCH", `/api/inv/items/${itemId}`, { [field]: value });
    } catch (err: any) {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    } finally {
      setSavingCells(prev => {
        const next = new Set(prev);
        next.delete(cellKey);
        return next;
      });
    }
  }, [suppliers, toast]);

  const patchItemMulti = useCallback(async (itemId: number, fields: Record<string, any>) => {
    try {
      queryClient.setQueryData<InvItem[]>(["/api/inv/items"], (old) => {
        if (!old) return old;
        return old.map(item => {
          if (item.id !== itemId) return item;
          const updated = { ...item, ...fields };
          if ("lastCostPerBaseUom" in fields) updated.lastCostPerBaseUom = String(fields.lastCostPerBaseUom);
          if ("lastCostPerPresentation" in fields) updated.lastCostPerPresentation = fields.lastCostPerPresentation != null ? String(fields.lastCostPerPresentation) : null;
          return updated;
        });
      });
      await apiRequest("PATCH", `/api/inv/items/${itemId}`, fields);
    } catch (err: any) {
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      toast({ title: "Error al guardar", description: err.message, variant: "destructive" });
    }
  }, [toast]);

  const categories = useMemo(() => {
    if (!items) return [];
    const set = new Set(items.filter((i) => i.isActive).map((i) => i.category));
    return Array.from(set).sort();
  }, [items]);

  const suppliersList = useMemo(() => {
    if (!items) return [];
    const map = new Map<string, boolean>();
    items.filter(i => i.isActive && i.supplierName).forEach(i => map.set(i.supplierName!, true));
    return Array.from(map.keys()).sort();
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    let list = items.filter((i) => i.isActive);
    if (typeFilter !== "__all__") list = list.filter((i) => i.itemType === typeFilter);
    if (categoryFilter !== "__all__") list = list.filter((i) => i.category === categoryFilter);
    if (supplierFilter !== "__all__") {
      if (supplierFilter === "__none__") list = list.filter((i) => !i.supplierName);
      else list = list.filter((i) => i.supplierName === supplierFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q));
    }
    if (sort) {
      list = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sort.key) {
          case "name": cmp = a.name.localeCompare(b.name, "es"); break;
          case "category": cmp = (a.category || "").localeCompare(b.category || "", "es"); break;
          case "supplierName": cmp = (a.supplierName || "").localeCompare(b.supplierName || "", "es"); break;
          case "onHand": cmp = parseFloat(a.onHandQtyBase) - parseFloat(b.onHandQtyBase); break;
          case "reorderPoint": cmp = parseFloat(a.reorderPointQtyBase) - parseFloat(b.reorderPointQtyBase); break;
          case "parLevel": cmp = parseFloat(a.parLevelQtyBase) - parseFloat(b.parLevelQtyBase); break;
          case "cost": cmp = parseFloat(a.lastCostPerBaseUom || "0") - parseFloat(b.lastCostPerBaseUom || "0"); break;
          case "status": cmp = stockLevel(a.onHandQtyBase, a.reorderPointQtyBase) - stockLevel(b.onHandQtyBase, b.reorderPointQtyBase); break;
        }
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return list;
  }, [items, search, categoryFilter, typeFilter, supplierFilter, sort]);

  const handleSort = useCallback((key: SortKey) => {
    setSort(prev => {
      if (prev?.key === key) return prev.dir === "asc" ? { key, dir: "desc" } : null;
      return { key, dir: "asc" };
    });
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" data-testid="status-loading">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const categoryOptions = [...new Set([...CATEGORIES, ...categories])].sort().map(c => ({ value: c, label: c }));

  return (
    <div className="admin-page full-width">
      <Card className="flex flex-col" style={{ height: "calc(100vh - 80px)" }}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2 flex-wrap flex-shrink-0">
          <CardTitle className="text-lg" data-testid="text-page-title">Insumos ({filtered.length})</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => recalcMutation.mutate()}
              disabled={recalcMutation.isPending}
              data-testid="button-recalc-avg-cost"
            >
              {recalcMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Calculator className="h-4 w-4 mr-1" />}
              Recalcular Costos
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setImportOpen(true); setImportText(""); setImportPreview([]); setImportResults(null); }} data-testid="button-import-items">
              <Upload className="h-4 w-4 mr-1" />
              Importar
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} data-testid="button-create-item">
              <Plus className="h-4 w-4 mr-1" />
              Nuevo
            </Button>
          </div>
        </CardHeader>
        <div className="px-6 pb-2 flex items-center gap-2 flex-wrap flex-shrink-0">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar nombre o SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
              data-testid="input-search"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[100px] h-8 text-sm" data-testid="select-type-filter">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Tipo</SelectItem>
              <SelectItem value="AP">AP</SelectItem>
              <SelectItem value="EP">EP</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[140px] h-8 text-sm" data-testid="select-category-filter">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Categoría</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-[140px] h-8 text-sm" data-testid="select-supplier-filter">
              <SelectValue placeholder="Proveedor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Proveedor</SelectItem>
              <SelectItem value="__none__">Sin proveedor</SelectItem>
              {suppliersList.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="hidden md:block flex-1 overflow-auto px-6 pb-4">
          <table className="w-full text-sm" data-testid="table-items">
            <thead className="sticky top-0 z-10 bg-background border-b">
              <tr>
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-left w-[100px]">SKU</th>
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-center w-[40px]">Tipo</th>
                <SortHeader label="Nombre" sortKey="name" currentSort={sort} onSort={handleSort} className="text-left min-w-[160px]" />
                <SortHeader label="Categoría" sortKey="category" currentSort={sort} onSort={handleSort} className="text-left w-[120px]" />
                <SortHeader label="Proveedor" sortKey="supplierName" currentSort={sort} onSort={handleSort} className="text-left w-[130px]" />
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-center w-[50px]">UOM</th>
                <SortHeader label="En Mano" sortKey="onHand" currentSort={sort} onSort={handleSort} className="text-right w-[80px]" />
                <SortHeader label="Pto Reorden" sortKey="reorderPoint" currentSort={sort} onSort={handleSort} className="text-right w-[90px]" />
                <SortHeader label="Nivel Par" sortKey="parLevel" currentSort={sort} onSort={handleSort} className="text-right w-[80px]" />
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-left w-[80px]">Present.</th>
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right w-[70px]">Cant.P.</th>
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right w-[90px]">₡ Present.</th>
                <SortHeader label="₡/UOM" sortKey="cost" currentSort={sort} onSort={handleSort} className="text-right w-[90px]" />
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right w-[80px]">Costo Prom</th>
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right w-[70px]">Peso (g)</th>
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-center w-[40px]">P</th>
                <SortHeader label="Estado" sortKey="status" currentSort={sort} onSort={handleSort} className="text-center w-[80px]" />
                <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-center w-[50px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-muted/30 group"
                  data-testid={`row-item-${item.id}`}
                >
                  <td className="px-2 py-1 font-mono text-xs text-muted-foreground truncate max-w-[100px]" title={item.sku} data-testid={`cell-sku-${item.id}`}>
                    {item.sku}
                  </td>
                  <td className="px-2 py-1 text-center" data-testid={`cell-type-${item.id}`}>
                    <Badge variant={item.itemType === "EP" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                      {item.itemType || "AP"}
                    </Badge>
                  </td>
                  <td className="px-1 py-1">
                    <EditableTextCell
                      value={item.name}
                      onSave={(v) => patchItem(item.id, "name", v)}
                      itemId={item.id}
                      field="name"
                      className="font-medium"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableSelectCell
                      value={item.category}
                      options={categoryOptions}
                      onSave={(v) => patchItem(item.id, "category", v)}
                      itemId={item.id}
                      field="category"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableSupplierCell
                      value={item.supplierName}
                      supplierId={item.defaultSupplierId}
                      suppliers={suppliers || []}
                      onSave={(id) => patchItem(item.id, "defaultSupplierId", id)}
                      itemId={item.id}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableSelectCell
                      value={item.baseUom}
                      options={UOM_OPTIONS}
                      onSave={(v) => patchItem(item.id, "baseUom", v)}
                      itemId={item.id}
                      field="uom"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums" data-testid={`cell-onhand-${item.id}`}>
                    {parseFloat(item.onHandQtyBase).toFixed(2)}
                  </td>
                  <td className="px-1 py-1">
                    <EditableNumberCell
                      value={item.reorderPointQtyBase}
                      onSave={(v) => patchItem(item.id, "reorderPointQtyBase", v)}
                      itemId={item.id}
                      field="reorderPoint"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableNumberCell
                      value={item.parLevelQtyBase}
                      onSave={(v) => patchItem(item.id, "parLevelQtyBase", v)}
                      itemId={item.id}
                      field="parLevel"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableSelectCell
                      value={item.purchasePresentation || "__none__"}
                      options={[{ value: "__none__", label: "—" }, ...PRESENTATION_OPTIONS]}
                      onSave={(v) => patchItem(item.id, "purchasePresentation", v === "__none__" ? null : v)}
                      itemId={item.id}
                      field="presentation"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableNumberCell
                      value={item.purchaseQtyPerBaseUom || "0"}
                      onSave={(v) => patchItem(item.id, "purchaseQtyPerBaseUom", Number(v))}
                      itemId={item.id}
                      field="purchaseQty"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableNumberCell
                      value={item.lastCostPerPresentation || "0"}
                      onSave={(v) => {
                        const costPres = Number(v);
                        const qtyPerBase = parseFloat(item.purchaseQtyPerBaseUom || "0");
                        if (qtyPerBase > 0) {
                          const costPerBase = costPres / qtyPerBase;
                          patchItemMulti(item.id, {
                            lastCostPerPresentation: costPres,
                            lastCostPerBaseUom: Number(costPerBase.toFixed(6)),
                          });
                        } else {
                          patchItem(item.id, "lastCostPerPresentation", costPres);
                        }
                      }}
                      itemId={item.id}
                      field="costPresentation"
                    />
                  </td>
                  <td className="px-1 py-1">
                    <EditableNumberCell
                      value={item.lastCostPerBaseUom || "0"}
                      onSave={(v) => patchItem(item.id, "lastCostPerBaseUom", Number(v))}
                      itemId={item.id}
                      field="cost"
                    />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground" data-testid={`cell-avgcost-${item.id}`}>
                    {parseFloat(item.avgCostPerBaseUom || "0").toFixed(2)}
                  </td>
                  <td className="px-1 py-1">
                    {item.baseUom === "UNIT" ? (
                      <EditableNumberCell
                        value={item.unitWeightG || "0"}
                        onSave={(v) => patchItem(item.id, "unitWeightG", Number(v))}
                        itemId={item.id}
                        field="unitWeightG"
                        step="0.01"
                      />
                    ) : (
                      <span className="px-1 text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center">
                    <Switch
                      checked={item.isPerishable}
                      onCheckedChange={(v) => patchItem(item.id, "isPerishable", v)}
                      className="scale-75"
                      data-testid={`switch-perishable-${item.id}`}
                    />
                  </td>
                  <td className="px-2 py-1 text-center" data-testid={`cell-status-${item.id}`}>
                    {stockBadge(item.onHandQtyBase, item.reorderPointQtyBase)}
                  </td>
                  <td className="px-1 py-1 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 ${item.notes ? "text-amber-600" : "opacity-0 group-hover:opacity-60"}`}
                            data-testid={`button-notes-${item.id}`}
                          >
                            <StickyNote className="h-3.5 w-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2">
                          <NotesPopover itemId={item.id} initialNotes={item.notes || ""} onSave={(v) => patchItem(item.id, "notes", v)} />
                        </PopoverContent>
                      </Popover>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => setDeleteTarget(item)}
                        data-testid={`button-delete-item-${item.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={18} className="text-center text-muted-foreground py-8">
                    No se encontraron insumos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="md:hidden flex-1 overflow-auto px-4 pb-4 space-y-2">
          {filtered.map((item) => (
            <Card
              key={item.id}
              className="cursor-pointer hover-elevate"
              onClick={() => setMobileEditItem(item)}
              data-testid={`card-item-${item.id}`}
            >
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{item.name}</span>
                    <Badge
                      variant={item.itemType === "EP" ? "default" : "secondary"}
                      data-testid={`badge-item-type-mobile-${item.id}`}
                    >
                      {item.itemType || "AP"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    {stockBadge(item.onHandQtyBase, item.reorderPointQtyBase)}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }}
                      data-testid={`button-delete-item-mobile-${item.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{item.sku} · {item.category}{item.supplierName ? ` · ${item.supplierName}` : ""}</span>
                  <span>{parseFloat(item.onHandQtyBase).toFixed(2)} {item.baseUom}</span>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <p className="text-center text-muted-foreground py-8" data-testid="text-empty">
              No se encontraron insumos
            </p>
          )}
        </div>
      </Card>

      <Dialog open={!!mobileEditItem} onOpenChange={(open) => { if (!open) setMobileEditItem(null); }}>
        <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-mobile-edit-title">
              <Pencil className="h-4 w-4 inline mr-1" />
              {mobileEditItem?.name}
            </DialogTitle>
          </DialogHeader>
          {mobileEditItem && (
            <MobileEditForm
              item={mobileEditItem}
              suppliers={suppliers || []}
              categories={categoryOptions}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">Nuevo Insumo</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-3">
              <FormField control={form.control} name="sku" render={({ field }) => (
                <FormItem>
                  <FormLabel>SKU</FormLabel>
                  <FormControl><Input {...field} placeholder="Ej: ARR-001" data-testid="input-sku" /></FormControl>
                  <p className="text-xs text-muted-foreground">Código único del insumo</p>
                </FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre</FormLabel>
                  <FormControl><Input {...field} placeholder="Ej: Arroz Horizonte 5kg" data-testid="input-name" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="itemType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-item-type"><SelectValue placeholder="Seleccionar tipo" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ITEM_TYPE_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">AP = Materia Prima, EP = Producto Elaborado</p>
                </FormItem>
              )} />
              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel>Categoría</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-category"><SelectValue placeholder="Seleccionar categoría" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {categoryOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="baseUom" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unidad Base (UOM)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-base-uom"><SelectValue placeholder="Seleccionar unidad" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {UOM_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Unidad en que se mide el stock</p>
                </FormItem>
              )} />
              <FormField control={form.control} name="onHandQtyBase" render={({ field }) => (
                <FormItem>
                  <FormLabel>Stock Inicial</FormLabel>
                  <FormControl><Input type="number" step="0.01" min="0" {...field} placeholder="Ej: 50" data-testid="input-initial-stock" /></FormControl>
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="reorderPointQtyBase" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Punto Reorden</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-reorder-point" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="parLevelQtyBase" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nivel Par</FormLabel>
                    <FormControl><Input type="number" step="0.01" {...field} data-testid="input-par-level" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Presentación de compra (opcional)</label>
                <Select value={form.watch("purchasePresentation") || "__none__"} onValueChange={(v) => form.setValue("purchasePresentation", v === "__none__" ? undefined : v)}>
                  <SelectTrigger data-testid="select-create-presentation"><SelectValue placeholder="Sin presentación" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin presentación</SelectItem>
                    {PRESENTATION_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Cant. por presentación</label>
                  <Input
                    type="number" step="0.01"
                    value={form.watch("purchaseQtyPerBaseUom") ?? ""}
                    onChange={(e) => {
                      const val = e.target.value === "" ? undefined : Number(e.target.value);
                      form.setValue("purchaseQtyPerBaseUom", val);
                    }}
                    placeholder="Ej: 5000"
                    data-testid="input-create-purchase-qty"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">₡ Presentación</label>
                  <Input
                    type="number" step="0.01"
                    value={form.watch("lastCostPerPresentation") ?? ""}
                    onChange={(e) => {
                      const val = e.target.value === "" ? undefined : Number(e.target.value);
                      form.setValue("lastCostPerPresentation", val);
                      const qtyPerBase = form.getValues("purchaseQtyPerBaseUom");
                      if (val && qtyPerBase && qtyPerBase > 0) {
                        form.setValue("lastCostPerBaseUom", Number((val / qtyPerBase).toFixed(6)));
                      }
                    }}
                    placeholder="Ej: 870"
                    data-testid="input-create-cost-presentation"
                  />
                </div>
              </div>
              <FormField control={form.control} name="lastCostPerBaseUom" render={({ field }) => (
                <FormItem>
                  <FormLabel>Costo por unidad base (₡/{watchBaseUom})</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.000001" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))} placeholder="Ej: 700" data-testid="input-last-cost" />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">{COST_HELPERS[watchBaseUom] || `₡ por 1 ${watchBaseUom}`}</p>
                </FormItem>
              )} />
              {watchBaseUom === "UNIT" && (
                <>
                  <FormField control={form.control} name="unitWeightG" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Peso por unidad (g)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" min="0" {...field} value={field.value ?? ""} onChange={e => field.onChange(e.target.value === "" ? undefined : Number(e.target.value))} placeholder="Ej: 250" data-testid="input-unit-weight" />
                      </FormControl>
                    </FormItem>
                  )} />
                  {(!watchUnitWeightG || watchUnitWeightG <= 0) && (
                    <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-unit-weight-warning">
                      Sin peso por unidad, las conversiones UNIT - G no funcionarán
                    </p>
                  )}
                </>
              )}
              <FormField control={form.control} name="isPerishable" render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-perishable" /></FormControl>
                  <FormLabel className="!mt-0">Perecedero</FormLabel>
                </FormItem>
              )} />
              <FormField control={form.control} name="defaultSupplierId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor (opcional)</FormLabel>
                  <Select value={field.value ? String(field.value) : "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : Number(v))}>
                    <FormControl>
                      <SelectTrigger data-testid="select-supplier"><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Sin proveedor</SelectItem>
                      {(suppliers || []).map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas (opcional)</FormLabel>
                  <FormControl><Textarea {...field} placeholder="Observaciones adicionales..." data-testid="input-notes" /></FormControl>
                </FormItem>
              )} />
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel">Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-save">
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Guardar
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-delete-dialog-title">Eliminar {deleteTarget?.name}</AlertDialogTitle>
            <AlertDialogDescription data-testid="text-delete-dialog-description">
              Si el insumo tiene registros relacionados (movimientos, conversiones, recetas, etc.) se desactivará en lugar de eliminarse permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-import-dialog-title">Importar Insumos</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-import-instructions">
              Pegue datos separados por tabulador o coma. Columnas: SKU, Nombre, Categoría, UOM, Stock Inicial, Punto Reorden, Nivel Par, Perecedero (true/false)
            </p>
            <Textarea
              placeholder={"SKU\tNombre\tCategoría\tUOM\tStock\tReorden\tParLevel\tPerecedero\nINS-001\tLeche Entera\tLácteos\tLT\t50\t10\t20\tfalse"}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              data-testid="textarea-import-data"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                onClick={() => {
                  const parsed = parseImportText(importText);
                  setImportPreview(parsed);
                  setImportResults(null);
                  if (parsed.length === 0) toast({ title: "No se encontraron items válidos", variant: "destructive" });
                }}
                disabled={!importText.trim()}
                data-testid="button-analyze-import"
              >
                Analizar
              </Button>
              {importPreview.length > 0 && (
                <Button
                  onClick={() => importMutation.mutate(importPreview)}
                  disabled={importMutation.isPending}
                  data-testid="button-execute-import"
                >
                  {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Importar {importPreview.length} items
                </Button>
              )}
            </div>
            {importPreview.length > 0 && !importResults && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-import-preview">
                  <thead>
                    <tr className="border-b">
                      <th className="px-2 py-1 text-left text-xs">SKU</th>
                      <th className="px-2 py-1 text-left text-xs">Nombre</th>
                      <th className="px-2 py-1 text-left text-xs">Categoría</th>
                      <th className="px-2 py-1 text-left text-xs">UOM</th>
                      <th className="px-2 py-1 text-right text-xs">Stock</th>
                      <th className="px-2 py-1 text-right text-xs">Reorden</th>
                      <th className="px-2 py-1 text-right text-xs">Par</th>
                      <th className="px-2 py-1 text-left text-xs">Perec.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.map((item, idx) => (
                      <tr key={idx} className="border-b" data-testid={`row-import-preview-${idx}`}>
                        <td className="px-2 py-1 font-mono text-xs">{item.sku}</td>
                        <td className="px-2 py-1">{item.name}</td>
                        <td className="px-2 py-1">{item.category}</td>
                        <td className="px-2 py-1">{item.baseUom}</td>
                        <td className="px-2 py-1 text-right">{item.onHandQtyBase}</td>
                        <td className="px-2 py-1 text-right">{item.reorderPointQtyBase}</td>
                        <td className="px-2 py-1 text-right">{item.parLevelQtyBase}</td>
                        <td className="px-2 py-1">{item.isPerishable ? "Si" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {importResults && (
              <Card data-testid="card-import-results">
                <CardContent className="p-4 space-y-2">
                  <p className="font-medium" data-testid="text-import-results-summary">
                    Creados: {importResults.created} | Omitidos: {importResults.skipped}
                  </p>
                  {importResults.errors.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-destructive">Errores:</p>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        {importResults.errors.map((err, idx) => (
                          <li key={idx} data-testid={`text-import-error-${idx}`}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MobileEditForm({ item, suppliers, categories }: {
  item: InvItem;
  suppliers: Supplier[];
  categories: { value: string; label: string }[];
}) {
  const { toast } = useToast();
  const [name, setName] = useState(item.name);
  const [category, setCategory] = useState(item.category);
  const [supplierId, setSupplierId] = useState<number | null>(item.defaultSupplierId);
  const [reorder, setReorder] = useState(item.reorderPointQtyBase);
  const [par, setPar] = useState(item.parLevelQtyBase);
  const [baseUom, setBaseUom] = useState(item.baseUom);
  const [cost, setCost] = useState(item.lastCostPerBaseUom || "0");
  const [unitWeight, setUnitWeight] = useState(item.unitWeightG || "");
  const [isPerishable, setIsPerishable] = useState(item.isPerishable);
  const [notes, setNotes] = useState(item.notes || "");
  const [purchasePresentation, setPurchasePresentation] = useState(item.purchasePresentation || "");
  const [purchaseQty, setPurchaseQty] = useState(item.purchaseQtyPerBaseUom || "");
  const [costPresentation, setCostPresentation] = useState(item.lastCostPerPresentation || "");

  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pendingRef = useRef<Record<string, any>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);

  const saveChanges = useCallback(async () => {
    if (!isDirtyRef.current || Object.keys(pendingRef.current).length === 0) return;
    setSaveStatus("saving");
    const payload = { ...pendingRef.current };
    try {
      await apiRequest("PATCH", `/api/inv/items/${item.id}`, payload);
      queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
      pendingRef.current = {};
      setIsDirty(false);
      isDirtyRef.current = false;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus((prev) => prev === "saved" ? "idle" : prev), 2000);
    } catch {
      setSaveStatus("error");
      toast({
        variant: "destructive",
        title: "Error al guardar",
        description: "No se pudieron guardar los cambios. Intentá de nuevo.",
      });
    }
  }, [item.id, toast]);

  const markDirtyAndDebounce = useCallback((field: string, value: any) => {
    pendingRef.current[field] = value;
    setIsDirty(true);
    isDirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(saveChanges, 1500);
  }, [saveChanges]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (isDirtyRef.current && Object.keys(pendingRef.current).length > 0) {
        apiRequest("PATCH", `/api/inv/items/${item.id}`, { ...pendingRef.current })
          .then(() => {
            queryClient.invalidateQueries({ queryKey: ["/api/inv/items"] });
          })
          .catch(() => {});
      }
    };
  }, [item.id]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={item.itemType === "EP" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
          {item.itemType || "AP"}
        </Badge>
        <span>{item.sku} · En mano: {parseFloat(item.onHandQtyBase).toFixed(2)}</span>
      </div>
      <div className="text-xs text-muted-foreground">Costo Promedio: ₡{parseFloat(item.avgCostPerBaseUom || "0").toFixed(2)}/{baseUom}</div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Nombre</label>
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); markDirtyAndDebounce("name", e.target.value.trim()); }}
          onBlur={saveChanges}
          data-testid="input-mobile-name"
        />
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Categoría</label>
        <Select value={category} onValueChange={(v) => { setCategory(v); markDirtyAndDebounce("category", v); }}>
          <SelectTrigger data-testid="select-mobile-category"><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Proveedor</label>
        <Select value={supplierId ? String(supplierId) : "__none__"} onValueChange={(v) => {
          const id = v === "__none__" ? null : Number(v);
          setSupplierId(id);
          markDirtyAndDebounce("defaultSupplierId", id);
        }}>
          <SelectTrigger data-testid="select-mobile-supplier"><SelectValue placeholder="Sin proveedor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sin proveedor</SelectItem>
            {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Unidad de Medida (UOM)</label>
        <Select value={baseUom} onValueChange={(v) => { setBaseUom(v); markDirtyAndDebounce("baseUom", v); }}>
          <SelectTrigger data-testid="select-mobile-uom"><SelectValue /></SelectTrigger>
          <SelectContent>
            {UOM_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Pto Reorden</label>
          <Input
            type="number" step="0.01" value={reorder}
            onChange={(e) => { setReorder(e.target.value); markDirtyAndDebounce("reorderPointQtyBase", e.target.value); }}
            onBlur={saveChanges}
            data-testid="input-mobile-reorder"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Nivel Par</label>
          <Input
            type="number" step="0.01" value={par}
            onChange={(e) => { setPar(e.target.value); markDirtyAndDebounce("parLevelQtyBase", e.target.value); }}
            onBlur={saveChanges}
            data-testid="input-mobile-par"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Presentación de compra</label>
        <Select value={purchasePresentation || "__none__"} onValueChange={(v) => {
          const val = v === "__none__" ? "" : v;
          setPurchasePresentation(val);
          markDirtyAndDebounce("purchasePresentation", val || null);
        }}>
          <SelectTrigger data-testid="select-mobile-presentation"><SelectValue placeholder="Sin presentación" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Sin presentación</SelectItem>
            {PRESENTATION_OPTIONS.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Cant. por {baseUom}</label>
          <Input
            type="number" step="0.01" value={purchaseQty}
            onChange={(e) => { setPurchaseQty(e.target.value); markDirtyAndDebounce("purchaseQtyPerBaseUom", e.target.value ? Number(e.target.value) : null); }}
            onBlur={saveChanges}
            placeholder="Ej: 5000"
            data-testid="input-mobile-purchase-qty"
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">₡ Presentación</label>
          <Input
            type="number" step="0.01" value={costPresentation}
            onChange={(e) => {
              const val = e.target.value;
              setCostPresentation(val);
              const costPres = Number(val);
              const qtyPerBase = parseFloat(purchaseQty || "0");
              if (qtyPerBase > 0 && !isNaN(costPres)) {
                const costPerBase = costPres / qtyPerBase;
                setCost(costPerBase.toFixed(6));
                pendingRef.current.lastCostPerPresentation = costPres;
                pendingRef.current.lastCostPerBaseUom = Number(costPerBase.toFixed(6));
              } else {
                pendingRef.current.lastCostPerPresentation = val ? costPres : null;
              }
              setIsDirty(true);
              isDirtyRef.current = true;
              if (debounceRef.current) clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(saveChanges, 1500);
            }}
            onBlur={saveChanges}
            placeholder="Ej: 870"
            data-testid="input-mobile-cost-presentation"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium">Costo (₡/{baseUom})</label>
        <Input
          type="number" step="0.000001" value={cost}
          onChange={(e) => { setCost(e.target.value); markDirtyAndDebounce("lastCostPerBaseUom", Number(e.target.value)); }}
          onBlur={saveChanges}
          data-testid="input-mobile-cost"
        />
        {parseFloat(purchaseQty || "0") > 0 && parseFloat(costPresentation || "0") > 0 && (
          <p className="text-xs text-muted-foreground">Calculado: ₡{costPresentation} / {purchaseQty} = ₡{cost}/{baseUom}</p>
        )}
      </div>

      {baseUom === "UNIT" && (
        <div className="space-y-1">
          <label className="text-sm font-medium">Peso por unidad (g)</label>
          <Input
            type="number" step="0.01" value={unitWeight}
            onChange={(e) => { setUnitWeight(e.target.value); markDirtyAndDebounce("unitWeightG", e.target.value ? Number(e.target.value) : null); }}
            onBlur={saveChanges}
            placeholder="Ej: 250"
            data-testid="input-mobile-unit-weight"
          />
          {(!unitWeight || parseFloat(unitWeight) <= 0) && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Sin peso por unidad, las conversiones UNIT→G no funcionarán</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Switch
          checked={isPerishable}
          onCheckedChange={(v) => { setIsPerishable(v); markDirtyAndDebounce("isPerishable", v); }}
          data-testid="switch-mobile-perishable"
        />
        <label className="text-sm font-medium">Perecedero</label>
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium flex items-center gap-1.5">
          <StickyNote className="h-3.5 w-3.5" />
          Notas
        </label>
        <Textarea
          value={notes}
          onChange={(e) => { setNotes(e.target.value); markDirtyAndDebounce("notes", e.target.value); }}
          onBlur={saveChanges}
          rows={2}
          placeholder="Observaciones..."
          data-testid="textarea-mobile-notes"
        />
      </div>

      <div className="pt-2 flex justify-between items-center">
        {stockBadge(item.onHandQtyBase, item.reorderPointQtyBase)}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-[16px]" data-testid="status-save-indicator">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Guardando...</span>
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              <span className="text-green-600">Guardado</span>
            </>
          )}
          {saveStatus === "error" && (
            <>
              <AlertCircle className="h-3 w-3 text-red-500" />
              <span className="text-red-600">Error al guardar</span>
            </>
          )}
          {saveStatus === "idle" && isDirty && (
            <span className="text-amber-600">Cambios sin guardar</span>
          )}
          {saveStatus === "idle" && !isDirty && (
            <span>Los cambios se guardan automáticamente</span>
          )}
        </div>
      </div>
    </div>
  );
}
