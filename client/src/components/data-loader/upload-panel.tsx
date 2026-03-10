import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react";

interface UploadResult {
  sessionId: number;
  sheetsFound: string[];
  rowCounts: Record<string, number>;
  unmappedColumns: Record<string, string[]>;
}

interface UploadPanelProps {
  onUploadComplete: (sessionId: number) => void;
}

export default function UploadPanel({ onUploadComplete }: UploadPanelProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      const res = await apiRequest("POST", "/api/admin/data-loader/upload", {
        fileData: base64,
        fileName: file.name,
      });
      return res.json();
    },
    onSuccess: (data: UploadResult) => {
      setUploadResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/data-loader/sessions"] });
      toast({ title: "Archivo cargado", description: `${data.sheetsFound.length} hojas encontradas` });
      onUploadComplete(data.sessionId);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith(".xlsx")) {
        toast({ title: "Error", description: "Solo se aceptan archivos .xlsx", variant: "destructive" });
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast({ title: "Error", description: "El archivo excede 5MB", variant: "destructive" });
        return;
      }
      setSelectedFile(file);
      setUploadResult(null);
    }
  };

  const handleUpload = () => {
    if (selectedFile) {
      uploadMutation.mutate(selectedFile);
    }
  };

  const handleDownloadTemplate = () => {
    window.open("/api/admin/data-loader/template", "_blank");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5" />
          Cargar Excel Maestro
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <Button
            variant="outline"
            onClick={handleDownloadTemplate}
            className="gap-2"
            data-testid="button-download-template"
          >
            <Download className="h-4 w-4" />
            Descargar plantilla
          </Button>
        </div>

        <div className="border-2 border-dashed rounded-lg p-6 text-center space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={handleFileChange}
            className="hidden"
            data-testid="input-file-upload"
          />
          <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {selectedFile ? selectedFile.name : "Selecciona un archivo .xlsx (máx 5MB)"}
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              data-testid="button-select-file"
            >
              Seleccionar archivo
            </Button>
            {selectedFile && (
              <Button
                size="sm"
                onClick={handleUpload}
                disabled={uploadMutation.isPending}
                data-testid="button-upload"
              >
                {uploadMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Cargando...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Cargar
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {uploadResult && (
          <div className="space-y-2 p-4 bg-muted rounded-lg">
            <p className="font-medium text-sm">Resumen de carga:</p>
            <div className="flex flex-wrap gap-2">
              {uploadResult.sheetsFound.map((sheet) => (
                <Badge key={sheet} variant="secondary" data-testid={`badge-sheet-${sheet}`}>
                  {sheet}: {uploadResult.rowCounts[sheet] || 0} filas
                </Badge>
              ))}
            </div>
            {Object.keys(uploadResult.unmappedColumns).length > 0 && (
              <div className="flex items-start gap-2 mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Columnas no reconocidas:</p>
                  {Object.entries(uploadResult.unmappedColumns).map(([sheet, cols]) => (
                    <p key={sheet}>{sheet}: {cols.join(", ")}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
