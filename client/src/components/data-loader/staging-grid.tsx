import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Plus, Loader2 } from "lucide-react";

interface StagingRow {
  id: number;
  sheet_name: string;
  row_index: number;
  data_json: Record<string, any>;
  validation_status: string;
  validation_errors: { field: string; message: string }[] | null;
  imported: boolean;
}

interface StagingGridProps {
  sessionId: number;
  rows: Record<string, StagingRow[]>;
  sheetsFound: string[];
  onRefresh: () => void;
}

function CellEditor({
  value,
  rowId,
  field,
  dataJson,
  onSaved,
}: {
  value: string;
  rowId: number;
  field: string;
  dataJson: Record<string, any>;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);

  const patchMutation = useMutation({
    mutationFn: async (newValue: string) => {
      const updated = { ...dataJson, [field]: newValue };
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
            if (editValue !== value) {
              patchMutation.mutate(editValue);
            } else {
              setEditing(false);
            }
          } else if (e.key === "Escape") {
            setEditValue(value);
            setEditing(false);
          }
        }}
        autoFocus
        className="h-7 px-1 text-xs"
        disabled={patchMutation.isPending}
        data-testid={`input-edit-${field}-${rowId}`}
      />
    );
  }

  return (
    <span
      className="cursor-pointer hover:bg-muted px-1 py-0.5 rounded text-xs block min-h-[24px]"
      onClick={() => setEditing(true)}
      data-testid={`cell-${field}-${rowId}`}
    >
      {value || "\u00A0"}
    </span>
  );
}

export default function StagingGrid({ sessionId, rows, sheetsFound, onRefresh }: StagingGridProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState(sheetsFound[0] || "");

  const deleteMutation = useMutation({
    mutationFn: async (rowId: number) => {
      await apiRequest("DELETE", `/api/admin/data-loader/staging/${rowId}`);
    },
    onSuccess: () => {
      toast({ title: "Fila eliminada" });
      onRefresh();
    },
  });

  const addRowMutation = useMutation({
    mutationFn: async (sheetName: string) => {
      const currentRows = rows[sheetName] || [];
      const columns = currentRows.length > 0 ? Object.keys(currentRows[0].data_json) : [];
      const emptyRow: Record<string, string> = {};
      for (const col of columns) {
        emptyRow[col] = "";
      }
      await apiRequest("POST", `/api/admin/data-loader/sessions/${sessionId}/add-row`, {
        sheetName,
        dataJson: emptyRow,
      });
    },
    onSuccess: () => {
      toast({ title: "Fila agregada" });
      onRefresh();
    },
  });

  if (sheetsFound.length === 0) {
    return <p className="text-sm text-muted-foreground p-4">No hay datos en staging.</p>;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="flex-wrap h-auto gap-1">
        {sheetsFound.map((sheet) => (
          <TabsTrigger key={sheet} value={sheet} className="text-xs" data-testid={`tab-${sheet}`}>
            {sheet}
            <Badge variant="outline" className="ml-1 text-[10px] px-1">
              {(rows[sheet] || []).length}
            </Badge>
          </TabsTrigger>
        ))}
      </TabsList>

      {sheetsFound.map((sheet) => {
        const sheetRows = rows[sheet] || [];
        const columns = sheetRows.length > 0 ? Object.keys(sheetRows[0].data_json) : [];

        return (
          <TabsContent key={sheet} value={sheet} className="mt-2">
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="p-2 text-left font-medium sticky left-0 bg-muted/50">#</th>
                    {columns.map((col) => (
                      <th key={col} className="p-2 text-left font-medium whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                    <th className="p-2 text-left font-medium">Estado</th>
                    <th className="p-2 text-left font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {sheetRows.map((row) => (
                    <tr
                      key={row.id}
                      className={`border-t ${
                        row.validation_status === "INVALID"
                          ? "bg-red-50 dark:bg-red-950/20"
                          : row.validation_status === "VALID"
                          ? "bg-green-50 dark:bg-green-950/20"
                          : ""
                      }`}
                      data-testid={`row-staging-${row.id}`}
                    >
                      <td className="p-2 text-muted-foreground sticky left-0 bg-inherit">
                        {row.row_index + 1}
                      </td>
                      {columns.map((col) => (
                        <td key={col} className="p-1 min-w-[100px]">
                          <CellEditor
                            value={String(row.data_json[col] || "")}
                            rowId={row.id}
                            field={col}
                            dataJson={row.data_json}
                            onSaved={onRefresh}
                          />
                        </td>
                      ))}
                      <td className="p-2">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant={
                                  row.validation_status === "VALID"
                                    ? "default"
                                    : row.validation_status === "INVALID"
                                    ? "destructive"
                                    : "secondary"
                                }
                                className="text-[10px] cursor-help"
                                data-testid={`badge-status-${row.id}`}
                              >
                                {row.validation_status}
                              </Badge>
                            </TooltipTrigger>
                            {row.validation_errors && row.validation_errors.length > 0 && (
                              <TooltipContent side="left" className="max-w-xs">
                                <ul className="text-xs space-y-1">
                                  {row.validation_errors.map((err, i) => (
                                    <li key={i}>
                                      <span className="font-medium">{err.field}:</span> {err.message}
                                    </li>
                                  ))}
                                </ul>
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
                      </td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteMutation.mutate(row.id)}
                          disabled={deleteMutation.isPending || row.imported}
                          data-testid={`button-delete-row-${row.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => addRowMutation.mutate(sheet)}
                disabled={addRowMutation.isPending}
                className="gap-1 text-xs"
                data-testid={`button-add-row-${sheet}`}
              >
                <Plus className="h-3 w-3" />
                Agregar fila
              </Button>
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
