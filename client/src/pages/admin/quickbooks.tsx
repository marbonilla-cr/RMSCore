import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Link2, Unlink, Settings2, RefreshCw, Loader2, CheckCircle2, XCircle,
  Clock, AlertTriangle, ArrowUpDown, Play, Eye, EyeOff, Key, Shield
} from "lucide-react";

type TabId = "credentials" | "connection" | "accounting" | "mappings" | "sync";

export default function AdminQuickBooksPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("connection");
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

  useEffect(() => {
    if (searchParams?.get("connected") === "true") {
      toast({ title: "Conectado", description: "QuickBooks conectado exitosamente" });
      window.history.replaceState({}, "", "/admin/quickbooks");
    }
    if (searchParams?.get("error")) {
      toast({ title: "Error", description: searchParams.get("error") || "Error de conexión", variant: "destructive" });
      window.history.replaceState({}, "", "/admin/quickbooks");
    }
  }, []);

  const tabs: { id: TabId; label: string }[] = [
    { id: "credentials", label: "Credenciales" },
    { id: "connection", label: "Conexión" },
    { id: "accounting", label: "Config Contable" },
    { id: "mappings", label: "Mapeo" },
    { id: "sync", label: "Sincronización" },
  ];

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-4" data-testid="admin-quickbooks-page">
      <h1 className="text-xl font-bold">QuickBooks Online</h1>

      <div className="flex gap-1 bg-muted rounded-lg p-1">
        {tabs.map(tab => (
          <button
            key={tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "credentials" && <CredentialsTab />}
      {activeTab === "connection" && <ConnectionTab />}
      {activeTab === "accounting" && <AccountingTab />}
      {activeTab === "mappings" && <MappingsTab />}
      {activeTab === "sync" && <SyncTab />}
    </div>
  );
}

function CredentialsTab() {
  const { toast } = useToast();
  const [showClientId, setShowClientId] = useState(false);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [environment, setEnvironment] = useState("sandbox");

  const credQuery = useQuery<{
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasEncryptKey: boolean;
    redirectUri: string;
    environment: string;
    source: string;
  }>({
    queryKey: ["/api/qbo/credentials"],
  });

  useEffect(() => {
    if (credQuery.data) {
      setRedirectUri(credQuery.data.redirectUri || "");
      setEnvironment(credQuery.data.environment || "sandbox");
    }
  }, [credQuery.data]);

  const saveMut = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      await apiRequest("PUT", "/api/qbo/credentials", data);
    },
    onSuccess: () => {
      toast({ title: "Guardado", description: "Credenciales actualizadas" });
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/credentials"] });
      setClientId("");
      setClientSecret("");
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const data: Record<string, string> = {};
    if (clientId) data.clientId = clientId;
    if (clientSecret) data.clientSecret = clientSecret;
    data.redirectUri = redirectUri;
    data.environment = environment;
    saveMut.mutate(data);
  };

  if (credQuery.isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  }

  const cred = credQuery.data;

  return (
    <Card data-testid="credentials-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          Credenciales de API
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
          <Shield className="h-4 w-4 flex-shrink-0" />
          <span>Las credenciales se almacenan encriptadas. Los campos sensibles se muestran enmascarados.</span>
        </div>

        {cred?.source && (
          <div className="text-sm">
            <Badge variant={cred.source === "database" ? "default" : cred.source === "environment" ? "secondary" : "outline"}>
              Fuente: {cred.source === "database" ? "Base de datos" : cred.source === "environment" ? "Variables de entorno" : "No configurado"}
            </Badge>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <Label htmlFor="cred-client-id">Client ID</Label>
            <div className="flex gap-2 mt-1">
              <div className="relative flex-1">
                <Input
                  id="cred-client-id"
                  data-testid="input-qbo-client-id"
                  type={showClientId ? "text" : "password"}
                  placeholder={cred?.hasClientId ? "••••••••••••••• (configurado)" : "Ingrese Client ID"}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                data-testid="toggle-client-id-visibility"
                onClick={() => setShowClientId(!showClientId)}
              >
                {showClientId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              {cred?.hasClientId && <CheckCircle2 className="h-5 w-5 text-green-500 self-center" />}
            </div>
          </div>

          <div>
            <Label htmlFor="cred-client-secret">Client Secret</Label>
            <div className="flex gap-2 mt-1">
              <div className="relative flex-1">
                <Input
                  id="cred-client-secret"
                  data-testid="input-qbo-client-secret"
                  type={showClientSecret ? "text" : "password"}
                  placeholder={cred?.hasClientSecret ? "••••••••••••••• (configurado)" : "Ingrese Client Secret"}
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                data-testid="toggle-client-secret-visibility"
                onClick={() => setShowClientSecret(!showClientSecret)}
              >
                {showClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              {cred?.hasClientSecret && <CheckCircle2 className="h-5 w-5 text-green-500 self-center" />}
            </div>
          </div>

          {cred && (
            <div className="flex items-center gap-2 text-sm">
              <Badge variant={cred.hasEncryptKey ? "default" : "destructive"}>
                {cred.hasEncryptKey ? "Clave maestra configurada (env)" : "Clave maestra no configurada"}
              </Badge>
            </div>
          )}

          <div>
            <Label htmlFor="cred-redirect-uri">Redirect URI</Label>
            <Input
              id="cred-redirect-uri"
              data-testid="input-qbo-redirect-uri"
              placeholder="https://your-domain.com/api/qbo/callback"
              value={redirectUri}
              onChange={(e) => setRedirectUri(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="cred-environment">Ambiente</Label>
            <Select value={environment} onValueChange={setEnvironment}>
              <SelectTrigger data-testid="select-qbo-environment" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox (Pruebas)</SelectItem>
                <SelectItem value="production">Producción</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          data-testid="button-save-credentials"
          onClick={handleSave}
          disabled={saveMut.isPending}
          className="w-full"
        >
          {saveMut.isPending ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Shield className="mr-2 h-4 w-4" />}
          Guardar Credenciales
        </Button>
      </CardContent>
    </Card>
  );
}

function ConnectionTab() {
  const { toast } = useToast();

  const statusQuery = useQuery({
    queryKey: ["/api/qbo/status"],
  });

  const connectMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/qbo/auth-url");
      const data = await res.json();
      window.location.href = data.url;
    },
  });

  const disconnectMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/qbo/disconnect"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/status"] });
      toast({ title: "Desconectado", description: "QuickBooks desconectado" });
    },
  });

  const status = statusQuery.data as any;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Estado de Conexión
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>
        ) : status?.connected ? (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="default" className="bg-green-600" data-testid="status-connected">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Conectado
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span className="text-muted-foreground">Realm ID:</span>
              <span className="font-mono">{status.realmId}</span>
              <span className="text-muted-foreground">Conectado:</span>
              <span>{status.connectedAt ? new Date(status.connectedAt).toLocaleString() : "—"}</span>
              <span className="text-muted-foreground">Último refresh:</span>
              <span>{status.lastTokenRefresh ? new Date(status.lastTokenRefresh).toLocaleString() : "—"}</span>
            </div>
            <Button
              variant="destructive"
              onClick={() => disconnectMut.mutate()}
              disabled={disconnectMut.isPending}
              data-testid="button-disconnect"
            >
              <Unlink className="h-4 w-4 mr-2" />
              {disconnectMut.isPending ? "Desconectando..." : "Desconectar"}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" data-testid="status-disconnected">
                <XCircle className="h-3 w-3 mr-1" /> No conectado
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Conectá tu cuenta de QuickBooks Online para sincronizar ventas automáticamente.
            </p>
            <Button
              onClick={() => connectMut.mutate()}
              disabled={connectMut.isPending}
              data-testid="button-connect"
            >
              <Link2 className="h-4 w-4 mr-2" />
              {connectMut.isPending ? "Redirigiendo..." : "Conectar QuickBooks"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AccountingTab() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    depositAccountCash: "",
    depositAccountCard: "",
    depositAccountSinpe: "",
    taxCodeRef: "",
    syncFromDate: "",
  });

  const statusQuery = useQuery({ queryKey: ["/api/qbo/status"] });
  const accountsQuery = useQuery({
    queryKey: ["/api/qbo/accounts"],
    enabled: !!(statusQuery.data as any)?.connected,
  });
  const taxCodesQuery = useQuery({
    queryKey: ["/api/qbo/tax-codes"],
    enabled: !!(statusQuery.data as any)?.connected,
  });

  useEffect(() => {
    if (statusQuery.data) {
      const s = statusQuery.data as any;
      setForm({
        depositAccountCash: s.depositAccountCash || "",
        depositAccountCard: s.depositAccountCard || "",
        depositAccountSinpe: s.depositAccountSinpe || "",
        taxCodeRef: s.taxCodeRef || "",
        syncFromDate: s.syncFromDate || "",
      });
    }
  }, [statusQuery.data]);

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/qbo/settings", form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/status"] });
      toast({ title: "Guardado", description: "Configuración contable actualizada" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const connected = !!(statusQuery.data as any)?.connected;
  const accounts = (accountsQuery.data || []) as any[];
  const taxCodes = (taxCodesQuery.data || []) as any[];

  if (!connected) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Conectá QuickBooks primero en la pestaña Conexión.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          Configuración Contable
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Cuenta Depósito — Efectivo</Label>
          <Select value={form.depositAccountCash} onValueChange={v => setForm(f => ({ ...f, depositAccountCash: v }))}>
            <SelectTrigger data-testid="select-deposit-cash"><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Cuenta Depósito — Tarjeta</Label>
          <Select value={form.depositAccountCard} onValueChange={v => setForm(f => ({ ...f, depositAccountCard: v }))}>
            <SelectTrigger data-testid="select-deposit-card"><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Cuenta Depósito — SINPE</Label>
          <Select value={form.depositAccountSinpe} onValueChange={v => setForm(f => ({ ...f, depositAccountSinpe: v }))}>
            <SelectTrigger data-testid="select-deposit-sinpe"><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
            <SelectContent>
              {accounts.map((a: any) => (
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Código de Impuesto</Label>
          <Select value={form.taxCodeRef} onValueChange={v => setForm(f => ({ ...f, taxCodeRef: v }))}>
            <SelectTrigger data-testid="select-tax-code"><SelectValue placeholder="Seleccionar código" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Sin impuesto</SelectItem>
              {taxCodes.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Sincronizar desde (fecha)</Label>
          <Input
            type="date"
            value={form.syncFromDate}
            onChange={e => setForm(f => ({ ...f, syncFromDate: e.target.value }))}
            data-testid="input-sync-from-date"
          />
          <p className="text-xs text-muted-foreground">Solo se sincronizan pagos con businessDate mayor o igual a esta fecha.</p>
        </div>

        <Button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          data-testid="button-save-settings"
        >
          {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}

function MappingsTab() {
  const { toast } = useToast();
  const [localMappings, setLocalMappings] = useState<any[]>([]);

  const statusQuery = useQuery({ queryKey: ["/api/qbo/status"] });
  const connected = !!(statusQuery.data as any)?.connected;

  const mappingsQuery = useQuery({
    queryKey: ["/api/qbo/mappings"],
    enabled: connected,
  });

  const qboItemsQuery = useQuery({
    queryKey: ["/api/qbo/items"],
    enabled: connected,
  });

  useEffect(() => {
    if (mappingsQuery.data) {
      setLocalMappings(mappingsQuery.data as any[]);
    }
  }, [mappingsQuery.data]);

  const saveMut = useMutation({
    mutationFn: () => {
      const toSave = localMappings
        .filter(m => m.qboItemId)
        .map(m => ({ categoryId: m.categoryId, qboItemId: m.qboItemId, qboItemName: m.qboItemName }));
      return apiRequest("PUT", "/api/qbo/mappings", { mappings: toSave });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/mappings"] });
      toast({ title: "Guardado", description: "Mapeo de categorías actualizado" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!connected) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Conectá QuickBooks primero.</p>
        </CardContent>
      </Card>
    );
  }

  const qboItems = (qboItemsQuery.data || []) as any[];

  const handleChange = (categoryId: number, qboItemId: string) => {
    const item = qboItems.find((i: any) => i.id === qboItemId);
    setLocalMappings(prev =>
      prev.map(m =>
        m.categoryId === categoryId
          ? { ...m, qboItemId, qboItemName: item?.name || "" }
          : m
      )
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5" />
          Mapeo de Categorías → Ítems QBO
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {mappingsQuery.isLoading ? (
          <div className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Cargando...</div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Asigná un ítem de QuickBooks a cada categoría del restaurante. Solo las categorías mapeadas se sincronizarán.
            </p>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {localMappings.map(m => (
                <div key={m.categoryId} className="flex items-center gap-3 py-2 border-b last:border-0">
                  <span className="w-40 text-sm font-medium truncate">{m.categoryName}</span>
                  <Select
                    value={m.qboItemId || "__unmapped__"}
                    onValueChange={v => handleChange(m.categoryId, v === "__unmapped__" ? "" : v)}
                  >
                    <SelectTrigger className="flex-1" data-testid={`mapping-select-${m.categoryId}`}>
                      <SelectValue placeholder="Sin mapear" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unmapped__">— Sin mapear —</SelectItem>
                      {qboItems.map((item: any) => (
                        <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              data-testid="button-save-mappings"
            >
              {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Guardar Mapeo
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SyncTab() {
  const { toast } = useToast();
  const [syncFromDate, setSyncFromDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const statusQuery = useQuery({ queryKey: ["/api/qbo/status"] });
  const connected = !!(statusQuery.data as any)?.connected;

  const statsQuery = useQuery({
    queryKey: ["/api/qbo/sync-stats"],
    enabled: connected,
    refetchInterval: 30000,
  });

  const logsQuery = useQuery({
    queryKey: ["/api/qbo/sync-log", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/qbo/sync-log?${params}`, { credentials: "include" });
      return res.json();
    },
    enabled: connected,
    refetchInterval: 30000,
  });

  const retryMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/qbo/retry-pending"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/sync-stats"] });
      toast({ title: "Reintentos", description: `${data.processed} pagos procesados` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const initialSyncMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/qbo/initial-sync", { fromDate: syncFromDate }),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/sync-log"] });
      queryClient.invalidateQueries({ queryKey: ["/api/qbo/sync-stats"] });
      toast({ title: "Sincronización inicial", description: `${data.queued} pagos encolados` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (!connected) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Conectá QuickBooks primero.</p>
        </CardContent>
      </Card>
    );
  }

  const stats = statsQuery.data as any;
  const logs = (logsQuery.data || []) as any[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Resumen de Sincronización</CardTitle>
        </CardHeader>
        <CardContent>
          {statsQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600" data-testid="stat-success-today">{stats?.successToday || 0}</div>
                <div className="text-xs text-muted-foreground">Exitosos hoy</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600" data-testid="stat-pending">{stats?.pending || 0}</div>
                <div className="text-xs text-muted-foreground">Pendientes</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600" data-testid="stat-failed">{stats?.failed || 0}</div>
                <div className="text-xs text-muted-foreground">Fallidos</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-muted-foreground">Último éxito</div>
                <div className="text-xs" data-testid="stat-last-success">
                  {stats?.lastSuccess ? new Date(stats.lastSuccess).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1 space-y-1">
              <Label>Sincronización inicial desde:</Label>
              <Input
                type="date"
                value={syncFromDate}
                onChange={e => setSyncFromDate(e.target.value)}
                data-testid="input-initial-sync-date"
              />
            </div>
            <Button
              onClick={() => initialSyncMut.mutate()}
              disabled={initialSyncMut.isPending || !syncFromDate}
              data-testid="button-initial-sync"
            >
              {initialSyncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Iniciar
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => retryMut.mutate()}
            disabled={retryMut.isPending}
            data-testid="button-retry-pending"
          >
            {retryMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Reintentar fallidos
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Registro de Sincronización</span>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36" data-testid="select-log-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="SUCCESS">Exitosos</SelectItem>
                <SelectItem value="PENDING">Pendientes</SelectItem>
                <SelectItem value="FAILED">Fallidos</SelectItem>
                <SelectItem value="VOIDED">Anulados</SelectItem>
              </SelectContent>
            </Select>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logsQuery.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin registros.</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {logs.map((log: any) => (
                <div key={log.id} className="flex items-center gap-2 py-2 border-b text-sm" data-testid={`sync-log-${log.id}`}>
                  <StatusBadge status={log.status} />
                  <span className="text-muted-foreground">Pago #{log.paymentId}</span>
                  <span className="text-muted-foreground">Orden #{log.orderId}</span>
                  {log.qboReceiptId && <span className="text-xs font-mono">QBO:{log.qboReceiptId}</span>}
                  {log.errorMessage && (
                    <span className="text-xs text-red-500 truncate max-w-[200px]" title={log.errorMessage}>
                      {log.errorMessage}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString() : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "SUCCESS":
      return <Badge variant="default" className="bg-green-600 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />OK</Badge>;
    case "PENDING":
      return <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />Pend</Badge>;
    case "FAILED":
      return <Badge variant="destructive" className="text-xs"><XCircle className="h-3 w-3 mr-1" />Error</Badge>;
    case "VOIDED":
      return <Badge variant="outline" className="text-xs"><AlertTriangle className="h-3 w-3 mr-1" />Anulado</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}
