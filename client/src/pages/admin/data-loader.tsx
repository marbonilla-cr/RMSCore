import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, FileSpreadsheet, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import UploadPanel from "@/components/data-loader/upload-panel";
import StagingGrid from "@/components/data-loader/staging-grid";
import ValidationPanel from "@/components/data-loader/validation-panel";
import ImportStatus from "@/components/data-loader/import-status";

interface Session {
  id: number;
  status: string;
  file_name: string;
  sheets_found: string[];
  error_message: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  uploaded: { label: "Subido", variant: "secondary" },
  parsed: { label: "Parseado", variant: "secondary" },
  staged: { label: "En revisión", variant: "outline" },
  validated: { label: "Validado", variant: "default" },
  imported: { label: "Importado", variant: "default" },
  failed: { label: "Error", variant: "destructive" },
};

export default function DataLoaderPage() {
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<Session[]>({
    queryKey: ["/api/admin/data-loader/sessions"],
  });

  const { data: sessionData, isLoading: sessionLoading } = useQuery<{
    session: Session;
    rows: Record<string, any[]>;
  }>({
    queryKey: ["/api/admin/data-loader/sessions", selectedSessionId],
    enabled: !!selectedSessionId,
  });

  const handleUploadComplete = (sessionId: number) => {
    setSelectedSessionId(sessionId);
  };

  const handleRefresh = () => {
    if (selectedSessionId) {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/data-loader/sessions", selectedSessionId],
      });
    }
  };

  const handleValidated = () => {
    handleRefresh();
    queryClient.invalidateQueries({ queryKey: ["/api/admin/data-loader/sessions"] });
  };

  const handleImported = () => {
    handleRefresh();
    queryClient.invalidateQueries({ queryKey: ["/api/admin/data-loader/sessions"] });
  };

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Data Loader</h1>
        <p className="text-sm text-muted-foreground">
          Carga inicial de datos operativos desde Excel
        </p>
      </div>

      <UploadPanel onUploadComplete={handleUploadComplete} />

      {sessionsLoading ? (
        <div className="flex items-center gap-2 p-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Cargando sesiones...</span>
        </div>
      ) : sessions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Sesiones anteriores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sessions.map((session) => {
                const config = STATUS_CONFIG[session.status] || STATUS_CONFIG.uploaded;
                const isActive = session.id === selectedSessionId;
                return (
                  <div
                    key={session.id}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer border transition-colors ${
                      isActive ? "border-primary bg-primary/5" : "hover:bg-muted"
                    }`}
                    onClick={() => setSelectedSessionId(session.id)}
                    data-testid={`session-item-${session.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{session.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(session.created_at).toLocaleString("es-CR")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {session.error_message && (
                        <span className="text-xs text-red-500 max-w-[200px] truncate">
                          {session.error_message}
                        </span>
                      )}
                      <Badge variant={config.variant} data-testid={`badge-session-status-${session.id}`}>
                        {config.label}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedSessionId && sessionData && (
        <>
          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" data-testid="text-session-title">
                Sesión: {sessionData.session.file_name}
              </h2>
              <Badge
                variant={
                  (STATUS_CONFIG[sessionData.session.status] || STATUS_CONFIG.uploaded).variant
                }
              >
                {(STATUS_CONFIG[sessionData.session.status] || STATUS_CONFIG.uploaded).label}
              </Badge>
            </div>

            {sessionLoading ? (
              <div className="flex items-center gap-2 p-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Cargando datos...</span>
              </div>
            ) : (
              <>
                <StagingGrid
                  sessionId={selectedSessionId}
                  rows={sessionData.rows}
                  sheetsFound={sessionData.session.sheets_found || []}
                  onRefresh={handleRefresh}
                />

                <Separator />

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Validación</h3>
                    <ValidationPanel
                      sessionId={selectedSessionId}
                      sessionStatus={sessionData.session.status}
                      onValidated={handleValidated}
                    />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold mb-2">Importación</h3>
                    <ImportStatus
                      sessionId={selectedSessionId}
                      sessionStatus={sessionData.session.status}
                      onImported={handleImported}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
