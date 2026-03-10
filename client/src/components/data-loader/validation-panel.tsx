import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";

interface ValidationResult {
  valid: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: { sheet: string; rowIndex: number; field: string; message: string }[];
}

interface ValidationPanelProps {
  sessionId: number;
  sessionStatus: string;
  onValidated: () => void;
}

export default function ValidationPanel({ sessionId, sessionStatus, onValidated }: ValidationPanelProps) {
  const { toast } = useToast();

  const validateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/data-loader/sessions/${sessionId}/validate`);
      return res.json() as Promise<ValidationResult>;
    },
    onSuccess: (data) => {
      if (data.valid) {
        toast({ title: "Validación exitosa", description: `${data.validRows} filas válidas` });
      } else {
        toast({
          title: "Errores encontrados",
          description: `${data.invalidRows} fila(s) con errores`,
          variant: "destructive",
        });
      }
      onValidated();
    },
    onError: (error: any) => {
      toast({ title: "Error de validación", description: error.message, variant: "destructive" });
    },
  });

  const canValidate = sessionStatus === "staged" || sessionStatus === "validated";
  const result = validateMutation.data;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          onClick={() => validateMutation.mutate()}
          disabled={!canValidate || validateMutation.isPending}
          className="gap-2"
          data-testid="button-validate"
        >
          {validateMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Validando...
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4" />
              Validar
            </>
          )}
        </Button>

        {sessionStatus === "validated" && (
          <Badge variant="default" className="bg-green-600 gap-1" data-testid="badge-validated">
            <CheckCircle2 className="h-3 w-3" />
            Validado
          </Badge>
        )}
      </div>

      {result && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex gap-4 text-sm">
              <span>Total: <strong>{result.totalRows}</strong></span>
              <span className="text-green-600">
                <CheckCircle2 className="h-3 w-3 inline mr-1" />
                Válidas: <strong>{result.validRows}</strong>
              </span>
              {result.invalidRows > 0 && (
                <span className="text-red-600">
                  <XCircle className="h-3 w-3 inline mr-1" />
                  Inválidas: <strong>{result.invalidRows}</strong>
                </span>
              )}
            </div>

            {result.errors.length > 0 && (
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="p-1 text-left">Hoja</th>
                      <th className="p-1 text-left">Fila</th>
                      <th className="p-1 text-left">Campo</th>
                      <th className="p-1 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((err, i) => (
                      <tr key={i} className="border-b text-red-600">
                        <td className="p-1">{err.sheet}</td>
                        <td className="p-1">{err.rowIndex + 1}</td>
                        <td className="p-1 font-medium">{err.field}</td>
                        <td className="p-1">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
