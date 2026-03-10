import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, XCircle, Loader2, Rocket, ShieldAlert } from "lucide-react";

interface SystemCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface ImportResult {
  import: { success: boolean; message: string };
  systemCheck: { status: string; checks: SystemCheck[] };
}

interface ImportStatusProps {
  sessionId: number;
  sessionStatus: string;
  onImported: () => void;
}

export default function ImportStatus({ sessionId, sessionStatus, onImported }: ImportStatusProps) {
  const { toast } = useToast();
  const [result, setResult] = useState<ImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/data-loader/sessions/${sessionId}/import`);
      return res.json() as Promise<ImportResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      if (data.import.success) {
        toast({ title: "Importación exitosa", description: data.import.message });
      }
      onImported();
    },
    onError: (error: any) => {
      toast({ title: "Error en importación", description: error.message, variant: "destructive" });
    },
  });

  const canImport = sessionStatus === "validated";

  return (
    <div className="space-y-4">
      <Button
        onClick={() => importMutation.mutate()}
        disabled={!canImport || importMutation.isPending}
        className="gap-2"
        variant={canImport ? "default" : "secondary"}
        data-testid="button-import"
      >
        {importMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Importando...
          </>
        ) : (
          <>
            <Rocket className="h-4 w-4" />
            Importar a producción
          </>
        )}
      </Button>

      {!canImport && sessionStatus !== "imported" && (
        <p className="text-xs text-muted-foreground">
          La sesión debe estar validada sin errores para importar.
        </p>
      )}

      {result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Verificación del Sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {result.systemCheck.checks.map((check, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm"
                data-testid={`check-${check.name}`}
              >
                {check.passed ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-600 shrink-0" />
                )}
                <span className="font-medium">{check.name}:</span>
                <span className="text-muted-foreground">{check.detail}</span>
              </div>
            ))}

            <div className="pt-2 border-t mt-2">
              {result.systemCheck.status === "ready" ? (
                <p className="text-green-600 font-medium text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Tenant listo para operar
                </p>
              ) : (
                <p className="text-yellow-600 font-medium text-sm flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4" />
                  Algunas verificaciones fallaron
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {sessionStatus === "imported" && !result && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-green-600 font-medium text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Esta sesión ya fue importada
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
