# RMSCore — Superadmin Dashboard (React + Linen)

## Objetivo
Construir la página `/superadmin` como un componente React integrado al proyecto existente. Esta página es pública (no requiere autenticación del sistema normal), usa su propio mecanismo de auth por token, y se comunica con las rutas `/api/superadmin/*` ya existentes en el backend.

---

## INSTRUCCIONES GENERALES

- Seguir el plan de tareas T001→T004 en orden
- El componente usa el sistema de diseño **Linen** del proyecto (tokens CSS de `src/styles/tokens.css`)
- NO usar shadcn para este componente — CSS inline con variables Linen directamente
- NO modificar ningún archivo existente excepto `App.tsx` (solo agregar la ruta)
- El token se guarda en `localStorage` bajo la clave `rms_superadmin_token`
- Toda la comunicación con el backend usa el header `X-Superadmin-Token`

---

## T001 — Verificar que la app corre

Antes de crear archivos, verificar que el workflow está corriendo. Si hay error `EADDRINUSE` u otro error de puerto, hacer restart del workflow. El sistema debe estar accesible antes de continuar.

---

## T002 — Crear `client/src/pages/superadmin.tsx`

Crear el archivo con el siguiente contenido EXACTO:

```tsx
import { useState, useEffect, useCallback } from "react";

// ─── TIPOS ────────────────────────────────────────────────────────────────────

interface Tenant {
  id: number;
  slug: string;
  business_name: string;
  schema_name: string;
  plan: string;
  status: string;
  is_active: boolean;
  trial_ends_at: string | null;
  suspended_at: string | null;
  suspend_reason: string | null;
  billing_email: string | null;
  created_at: string;
  active_modules: number;
}

interface Metrics {
  active_tenants: string;
  trial_tenants: string;
  basic_tenants: string;
  pro_tenants: string;
  enterprise_tenants: string;
  suspended_tenants: string;
}

interface TenantDetail {
  tenant: Tenant;
  modules: { module_key: string; is_active: boolean; price: number }[];
  logs: { action: string; status: string; created_at: string; error_message?: string }[];
}

const PLAN_LABELS: Record<string, string> = {
  TRIAL: "Trial", BASIC: "Básico", PRO: "Pro", ENTERPRISE: "Empresarial",
};
const PLAN_PRICES: Record<string, number> = {
  TRIAL: 0, BASIC: 50, PRO: 120, ENTERPRISE: 250,
};
const PLAN_COLORS: Record<string, string> = {
  TRIAL: "#c9841a", BASIC: "#1d4ed8", PRO: "#4a7c59", ENTERPRISE: "#e05e3a",
};

// ─── STORAGE KEY ──────────────────────────────────────────────────────────────
const TOKEN_KEY = "rms_superadmin_token";

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SuperadminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [tokenInput, setTokenInput] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);

  const [section, setSection] = useState<"tenants" | "metrics" | "setup">("tenants");

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<TenantDetail | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string; message: string; actionLabel: string; variant: "danger" | "success" | "primary";
    needsReason?: boolean; onConfirm: (reason?: string) => Promise<void>;
  } | null>(null);
  const [confirmReason, setConfirmReason] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);

  // Create form
  const [form, setForm] = useState({
    plan: "TRIAL", businessName: "", slug: "", billingEmail: "",
    adminEmail: "", adminPassword: "", adminDisplayName: "",
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // Setup
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupMsg, setSetupMsg] = useState("");

  // Toast
  const [toasts, setToasts] = useState<{ id: number; type: string; title: string; msg: string }[]>([]);

  // ─── API ────────────────────────────────────────────────────────────────────
  const api = useCallback(async (method: string, path: string, body?: unknown) => {
    const opts: RequestInit = {
      method,
      headers: { "Content-Type": "application/json", "X-Superadmin-Token": token },
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(path, opts);
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || "Error del servidor");
    return data;
  }, [token]);

  // ─── TOAST ──────────────────────────────────────────────────────────────────
  const toast = useCallback((type: string, title: string, msg = "") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, title, msg }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // ─── LOAD DATA ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        api("GET", "/api/superadmin/tenants"),
        api("GET", "/api/superadmin/metrics"),
      ]);
      setTenants(t);
      setMetrics(m);
    } catch (err: any) {
      toast("error", "Error al cargar", err.message);
    } finally {
      setLoading(false);
    }
  }, [api, toast]);

  // ─── AUTO-AUTH on mount if token stored ─────────────────────────────────────
  useEffect(() => {
    if (token) {
      api("GET", "/api/superadmin/metrics")
        .then(m => { setAuthed(true); setMetrics(m); loadData(); })
        .catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(""); });
    }
  }, []); // eslint-disable-line

  // ─── LOGIN ──────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!tokenInput.trim()) return;
    setAuthLoading(true);
    setAuthError("");
    try {
      await fetch("/api/superadmin/metrics", {
        headers: { "X-Superadmin-Token": tokenInput.trim() },
      }).then(async r => {
        if (!r.ok) throw new Error("Token inválido");
        const m = await r.json();
        setToken(tokenInput.trim());
        localStorage.setItem(TOKEN_KEY, tokenInput.trim());
        setMetrics(m);
        setAuthed(true);
        loadData();
      });
    } catch {
      setAuthError("Token incorrecto. Verifica el valor en Replit Secrets → SUPERADMIN_TOKEN");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(""); setTokenInput(""); setAuthed(false);
    setTenants([]); setMetrics(null);
  };

  // ─── SLUG AUTO-GEN ──────────────────────────────────────────────────────────
  const handleBusinessNameChange = (val: string) => {
    const auto = val.toLowerCase()
      .replace(/[áàä]/g,"a").replace(/[éèë]/g,"e").replace(/[íìï]/g,"i")
      .replace(/[óòö]/g,"o").replace(/[úùü]/g,"u").replace(/ñ/g,"n")
      .replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,30);
    setForm(f => ({ ...f, businessName: val, slug: f.slug || auto }));
  };

  // ─── CREATE TENANT ───────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.businessName || !form.slug || !form.billingEmail || !form.adminEmail) {
      setCreateError("Completa todos los campos marcados con *"); return;
    }
    setCreateLoading(true); setCreateError("");
    try {
      await api("POST", "/api/superadmin/tenants", {
        ...form,
        slug: `rest-${form.slug}`,
        adminPassword: form.adminPassword || "TempPass123!",
        adminDisplayName: form.adminDisplayName || form.businessName,
      });
      setCreateOpen(false);
      setForm({ plan:"TRIAL", businessName:"", slug:"", billingEmail:"", adminEmail:"", adminPassword:"", adminDisplayName:"" });
      toast("success", "¡Tenant creado!", `${form.businessName} está activo`);
      await loadData();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  // ─── DETAIL ──────────────────────────────────────────────────────────────────
  const openDetail = async (id: number) => {
    setDetailOpen(true); setDetailData(null);
    try {
      const d = await api("GET", `/api/superadmin/tenants/${id}`);
      setDetailData(d);
    } catch (err: any) {
      toast("error", "Error", err.message); setDetailOpen(false);
    }
  };

  // ─── CONFIRM ACTIONS ─────────────────────────────────────────────────────────
  const confirmSuspend = (t: Tenant) => {
    setConfirmReason("");
    setConfirmConfig({
      title: "Suspender tenant",
      message: `Se bloqueará el acceso a "${t.business_name}". El restaurante no podrá ingresar al sistema.`,
      actionLabel: "Suspender", variant: "danger", needsReason: true,
      onConfirm: async (reason) => {
        await api("POST", `/api/superadmin/tenants/${t.id}/suspend`, { reason });
        toast("success", "Tenant suspendido", t.business_name);
        await loadData();
      },
    });
    setConfirmOpen(true);
  };

  const confirmReactivate = (t: Tenant) => {
    setConfirmReason("");
    setConfirmConfig({
      title: "Reactivar tenant",
      message: `Se restaurará el acceso a "${t.business_name}".`,
      actionLabel: "Reactivar", variant: "success",
      onConfirm: async () => {
        await api("POST", `/api/superadmin/tenants/${t.id}/reactivate`);
        toast("success", "Tenant reactivado", t.business_name);
        await loadData();
      },
    });
    setConfirmOpen(true);
  };

  const executeConfirm = async () => {
    if (!confirmConfig) return;
    if (confirmConfig.needsReason && !confirmReason.trim()) {
      toast("error", "Razón requerida", "Ingresa una razón para continuar"); return;
    }
    setConfirmLoading(true);
    try {
      await confirmConfig.onConfirm(confirmReason.trim() || undefined);
      setConfirmOpen(false);
    } catch (err: any) {
      toast("error", "Error", err.message);
    } finally {
      setConfirmLoading(false);
    }
  };

  // ─── SETUP ───────────────────────────────────────────────────────────────────
  const runSetup = async () => {
    setSetupLoading(true); setSetupMsg("");
    try {
      await api("POST", "/api/superadmin/setup");
      setSetupMsg("success");
      toast("success", "Setup completado", "Tablas multi-tenant verificadas");
    } catch (err: any) {
      setSetupMsg("error:" + err.message);
    } finally {
      setSetupLoading(false);
    }
  };

  // ─── FILTERED TENANTS ────────────────────────────────────────────────────────
  const filtered = tenants.filter(t => {
    const q = search.toLowerCase();
    return (
      (!q || t.business_name.toLowerCase().includes(q) || t.slug.includes(q)) &&
      (!filterPlan || t.plan === filterPlan) &&
      (!filterStatus || t.status === filterStatus || (filterStatus === "ACTIVE" && t.is_active))
    );
  });

  // ─── MRR ─────────────────────────────────────────────────────────────────────
  const mrr = tenants.reduce((s, t) => s + (t.is_active ? (PLAN_PRICES[t.plan] || 0) : 0), 0);

  // ─── STYLES (Linen tokens) ────────────────────────────────────────────────────
  const S = {
    page: { minHeight: "100dvh", background: "var(--rail-bg)", fontFamily: "var(--f-body)" },
    loginWrap: { minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--rail-bg)", backgroundImage: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(224,94,58,0.15), transparent)", padding: 20 },
    card: { width: "100%", maxWidth: 400, background: "var(--s0)", borderRadius: "var(--r-xl)", padding: "36px 36px 32px", boxShadow: "var(--shadow-dialog)" },
    label: { fontSize: 12, fontWeight: 600, color: "var(--text2)", display: "block", marginBottom: 5, letterSpacing: "0.02em" } as React.CSSProperties,
    input: { width: "100%", padding: "9px 13px", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", fontFamily: "var(--f-body)", fontSize: 14, color: "var(--text)", outline: "none" } as React.CSSProperties,
    btnPrimary: { width: "100%", padding: "10px 20px", background: "var(--acc)", color: "white", border: "none", borderRadius: "var(--r-sm)", fontFamily: "var(--f-disp)", fontWeight: 600, fontSize: 15, cursor: "pointer" } as React.CSSProperties,
    // Layout
    layout: { display: "flex", minHeight: "100dvh" } as React.CSSProperties,
    sidebar: { width: 216, minHeight: "100dvh", background: "var(--rail-bg)", display: "flex", flexDirection: "column" as const, position: "fixed" as const, left: 0, top: 0, zIndex: 100 },
    main: { marginLeft: 216, flex: 1, display: "flex", flexDirection: "column" as const },
    topbar: { height: 54, background: "var(--s0)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", padding: "0 24px", position: "sticky" as const, top: 0, zIndex: 50 },
    content: { padding: "24px" },
    // Cards
    metricCard: { background: "var(--s0)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", padding: "16px 20px" },
    tableWrap: { background: "var(--s0)", border: "1px solid var(--border)", borderRadius: "var(--r-md)", overflow: "hidden" },
    // Badges
    badge: (color: string, bg: string, border: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, color, background: bg, border: `1px solid ${border}` }),
    // Buttons
    btnRow: { padding: "4px 9px", borderRadius: "var(--r-xs)", fontSize: 11, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: "var(--s0)", color: "var(--text2)", fontFamily: "var(--f-body)" } as React.CSSProperties,
    btnSec: { padding: "8px 16px", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", fontFamily: "var(--f-disp)", fontWeight: 600, fontSize: 14, color: "var(--text2)", cursor: "pointer" } as React.CSSProperties,
    btnAdd: { display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--acc)", color: "white", border: "none", borderRadius: "var(--r-xs)", fontFamily: "var(--f-disp)", fontWeight: 600, fontSize: 13, cursor: "pointer" } as React.CSSProperties,
  };

  // ─── RENDER: LOGIN ────────────────────────────────────────────────────────────
  if (!authed) return (
    <div style={S.loginWrap}>
      <div style={S.card}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <div style={{ width: 36, height: 36, background: "var(--coral)", borderRadius: "var(--r-sm)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "var(--f-disp)", fontWeight: 800, fontSize: 16 }}>R</div>
          <div>
            <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
              RMS<span style={{ color: "var(--coral)" }}>Core</span>
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--text3)" }}>SuperAdmin</div>
          </div>
        </div>

        <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 24, marginBottom: 24, color: "var(--text)" }}>Panel de Operaciones</div>

        <div style={{ marginBottom: 16 }}>
          <label style={S.label}>Token de acceso</label>
          <div style={{ display: "flex", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
            <input
              type={tokenVisible ? "text" : "password"}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLogin()}
              placeholder="••••••••••••••••••••"
              style={{ flex: 1, padding: "9px 13px", background: "none", border: "none", outline: "none", fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--text)", letterSpacing: "0.04em" }}
              autoFocus
            />
            <button onClick={() => setTokenVisible(v => !v)} style={{ padding: "0 12px", background: "none", border: "none", color: "var(--text3)", cursor: "pointer" }}>
              {tokenVisible
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              }
            </button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>Configurado como SUPERADMIN_TOKEN en Replit Secrets</div>
        </div>

        {authError && (
          <div style={{ background: "var(--red-d)", border: "1px solid var(--red-m)", borderRadius: "var(--r-sm)", padding: "10px 13px", fontSize: 13, color: "var(--red)", marginBottom: 12 }}>
            {authError}
          </div>
        )}

        <button onClick={handleLogin} disabled={authLoading} style={{ ...S.btnPrimary, opacity: authLoading ? 0.7 : 1 }}>
          {authLoading ? "Verificando..." : "Ingresar al Panel"}
        </button>
      </div>
    </div>
  );

  // ─── RENDER: APP ──────────────────────────────────────────────────────────────
  return (
    <div style={S.layout}>

      {/* ── SIDEBAR ── */}
      <nav style={S.sidebar}>
        {/* Header */}
        <div style={{ padding: "18px 14px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, background: "var(--coral)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontFamily: "var(--f-disp)", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>R</div>
            <div>
              <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 15, color: "white" }}>RMSCore</div>
              <div style={{ fontSize: 9, fontWeight: 600, color: "var(--rail-accent)", letterSpacing: "0.06em", textTransform: "uppercase" as const }}>SuperAdmin</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <div style={{ padding: "10px 6px", flex: 1 }}>
          {[
            { id: "tenants", label: "Tenants", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
            { id: "metrics", label: "Métricas", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
            { id: "setup",   label: "Setup",    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 19.07l1.41-1.41M20 12h2M2 12h2M19.07 19.07l-1.41-1.41M4.93 4.93l1.41 1.41M12 20v2M12 2v2"/></svg> },
          ].map(item => (
            <div
              key={item.id}
              onClick={() => { setSection(item.id as any); if (item.id === "metrics") loadData(); }}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 9px", borderRadius: "var(--r-sm)", color: section === item.id ? "var(--rail-accent)" : "var(--rail-text)", background: section === item.id ? "rgba(224,94,58,0.18)" : "transparent", cursor: "pointer", fontSize: 13, fontWeight: 500, marginBottom: 1, transition: "all 0.14s ease" }}
            >
              {item.icon}{item.label}
              {item.id === "tenants" && (
                <span style={{ marginLeft: "auto", background: "var(--coral)", color: "white", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>
                  {tenants.filter(t => t.is_active).length || "–"}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: "10px 6px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px" }}>
            <div style={{ width: 26, height: 26, background: "var(--rail-accent)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 11, color: "white", flexShrink: 0 }}>SA</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>SuperAdmin</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Acceso total</div>
            </div>
            <button onClick={handleLogout} title="Cerrar sesión" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: 4, display: "flex", borderRadius: 4, transition: "color 0.14s" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            </button>
          </div>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <div style={S.main}>
        {/* Topbar */}
        <div style={S.topbar}>
          <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 18, flex: 1 }}>
            {{ tenants: "Tenants", metrics: "Métricas", setup: "Configuración" }[section]}
          </div>
          <button onClick={loadData} title="Actualizar" style={{ width: 32, height: 32, background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-xs)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text2)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
        </div>

        <div style={S.content}>

          {/* ── SECTION: TENANTS ── */}
          {section === "tenants" && (
            <>
              {/* Metrics strip */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
                {[
                  { label: "Activos", value: metrics?.active_tenants ?? "–", color: "var(--sage)" },
                  { label: "En trial", value: metrics?.trial_tenants ?? "–", color: "var(--amber)" },
                  { label: "Plan Básico", value: metrics?.basic_tenants ?? "–", color: "var(--acc)" },
                  { label: "Plan Pro", value: metrics?.pro_tenants ?? "–", color: "var(--coral)" },
                  { label: "MRR estimado", value: mrr > 0 ? `$${mrr.toLocaleString()}` : "$0", color: "var(--text)", small: true },
                ].map((m, i) => (
                  <div key={i} style={S.metricCard}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "var(--text3)", marginBottom: 8 }}>{m.label}</div>
                    <div style={{ fontFamily: "var(--f-disp)", fontWeight: 800, fontSize: m.small ? 22 : 30, color: m.color, lineHeight: 1 }}>{m.value}</div>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div style={S.tableWrap}>
                {/* Toolbar */}
                <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-xs)", padding: "6px 11px", flex: "1", maxWidth: 280 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." style={{ background: "none", border: "none", outline: "none", fontSize: 13, color: "var(--text)", width: "100%", fontFamily: "var(--f-body)" }} />
                  </div>
                  <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)} style={{ padding: "6px 10px", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-xs)", fontSize: 13, color: "var(--text2)", fontFamily: "var(--f-body)", outline: "none" }}>
                    <option value="">Todos los planes</option>
                    {Object.entries(PLAN_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: "6px 10px", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-xs)", fontSize: 13, color: "var(--text2)", fontFamily: "var(--f-body)", outline: "none" }}>
                    <option value="">Todos los estados</option>
                    <option value="ACTIVE">Activos</option>
                    <option value="SUSPENDED">Suspendidos</option>
                    <option value="TRIAL_EXPIRED">Trial vencido</option>
                  </select>
                  <button style={S.btnAdd} onClick={() => setCreateOpen(true)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Nuevo Tenant
                  </button>
                </div>

                {loading ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>Cargando tenants...</div>
                ) : filtered.length === 0 ? (
                  <div style={{ padding: 50, textAlign: "center", color: "var(--text3)" }}>
                    <div style={{ fontSize: 13 }}>No hay tenants aún.<br/>Crea el primero con <strong>+ Nuevo Tenant</strong></div>
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "var(--s1)" }}>
                          {["Restaurante","Plan","Estado","Módulos","MRR","Creado",""].map((h, i) => (
                            <th key={i} style={{ textAlign: "left", padding: "9px 18px", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "var(--text3)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" as const }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(t => {
                          const planColor = PLAN_COLORS[t.plan] || "var(--text3)";
                          const trialLeft = t.plan === "TRIAL" && t.trial_ends_at
                            ? Math.max(0, Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 86400000))
                            : null;
                          return (
                            <tr key={t.id} style={{ borderBottom: "1px solid var(--border)" }}>
                              <td style={{ padding: "12px 18px" }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{t.business_name}</div>
                                <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text3)", background: "var(--s1)", padding: "1px 5px", borderRadius: 3, display: "inline-block", marginTop: 2 }}>{t.slug}</div>
                              </td>
                              <td style={{ padding: "12px 18px" }}>
                                <span style={S.badge(planColor, planColor + "15", planColor + "40")}>{PLAN_LABELS[t.plan]}</span>
                              </td>
                              <td style={{ padding: "12px 18px" }}>
                                {t.is_active
                                  ? <span style={S.badge("var(--sage)","var(--sage-d)","var(--sage-m)")}>● Activo</span>
                                  : <span style={S.badge("var(--red)","var(--red-d)","var(--red-m)")}>● {t.status === "SUSPENDED" ? "Suspendido" : "Inactivo"}</span>
                                }
                              </td>
                              <td style={{ padding: "12px 18px", fontSize: 12, color: "var(--text3)" }}>
                                {trialLeft !== null
                                  ? <span style={{ color: trialLeft < 5 ? "var(--red)" : "var(--amber)", fontWeight: 600 }}>{trialLeft}d restantes</span>
                                  : `${t.active_modules || 0} activos`
                                }
                              </td>
                              <td style={{ padding: "12px 18px" }}>
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                                  {PLAN_PRICES[t.plan] ? `$${PLAN_PRICES[t.plan]}` : "–"}
                                </span>
                              </td>
                              <td style={{ padding: "12px 18px", fontSize: 12, color: "var(--text3)" }}>
                                {t.created_at ? new Date(t.created_at).toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "2-digit" }) : "–"}
                              </td>
                              <td style={{ padding: "12px 18px" }}>
                                <div style={{ display: "flex", gap: 5 }}>
                                  <button style={S.btnRow} onClick={() => openDetail(t.id)}>Ver</button>
                                  {t.is_active
                                    ? <button style={{ ...S.btnRow, color: "var(--red)", borderColor: "var(--red-m)" }} onClick={() => confirmSuspend(t)}>Suspender</button>
                                    : <button style={{ ...S.btnRow, color: "var(--sage)", borderColor: "var(--sage-m)" }} onClick={() => confirmReactivate(t)}>Reactivar</button>
                                  }
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── SECTION: METRICS ── */}
          {section === "metrics" && metrics && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14, marginBottom: 24 }}>
                {[
                  ["Activos","active_tenants","var(--sage)"],
                  ["En trial","trial_tenants","var(--amber)"],
                  ["Básico","basic_tenants","var(--acc)"],
                  ["Pro","pro_tenants","var(--sage)"],
                  ["Empresarial","enterprise_tenants","var(--coral)"],
                  ["Suspendidos","suspended_tenants","var(--red)"],
                ].map(([label, key, color]) => (
                  <div key={key} style={S.metricCard}>
                    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "var(--text3)", marginBottom: 8 }}>{label}</div>
                    <div style={{ fontFamily: "var(--f-disp)", fontWeight: 800, fontSize: 30, color, lineHeight: 1 }}>
                      {(metrics as any)[key] ?? "0"}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ ...S.tableWrap, padding: 24, maxWidth: 500 }}>
                <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 15, marginBottom: 16 }}>Distribución de planes</div>
                {Object.entries(PLAN_LABELS).map(([k, label]) => {
                  const count = parseInt((metrics as any)[k.toLowerCase() + "_tenants"] || "0");
                  const total = parseInt(metrics.active_tenants || "1") || 1;
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={k} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ fontWeight: 600 }}>{label}</span>
                        <span style={{ color: "var(--text3)" }}>{count} tenant{count !== 1 ? "s" : ""}</span>
                      </div>
                      <div style={{ background: "var(--s2)", borderRadius: 4, height: 8, overflow: "hidden" }}>
                        <div style={{ height: "100%", background: PLAN_COLORS[k], borderRadius: 4, width: `${pct}%`, transition: "width 0.6s" }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 13, color: "var(--text2)", fontWeight: 600 }}>MRR estimado</span>
                  <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, fontSize: 18, color: "var(--text)" }}>${mrr.toLocaleString()}/mes</span>
                </div>
              </div>
            </>
          )}

          {/* ── SECTION: SETUP ── */}
          {section === "setup" && (
            <div style={{ ...S.tableWrap, padding: 28, maxWidth: 560 }}>
              <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Inicialización del sistema multi-tenant</div>
              <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 20, lineHeight: 1.6 }}>
                Crea las tablas globales (<code style={{ fontFamily: "var(--f-mono)", fontSize: 12, background: "var(--s1)", padding: "1px 5px", borderRadius: 3 }}>public.tenants</code>, <code style={{ fontFamily: "var(--f-mono)", fontSize: 12, background: "var(--s1)", padding: "1px 5px", borderRadius: 3 }}>tenant_modules</code>, etc.) en la base de datos. Operación idempotente — se puede ejecutar múltiples veces sin problema.
              </p>
              <button onClick={runSetup} disabled={setupLoading} style={{ ...S.btnPrimary, width: "auto", padding: "9px 22px", opacity: setupLoading ? 0.7 : 1 }}>
                {setupLoading ? "Inicializando..." : "Inicializar tablas multi-tenant"}
              </button>
              {setupMsg === "success" && (
                <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--sage-d)", border: "1px solid var(--sage-m)", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--sage)" }}>
                  ✓ Tablas creadas/verificadas. El sistema está listo.
                </div>
              )}
              {setupMsg.startsWith("error:") && (
                <div style={{ marginTop: 14, padding: "10px 14px", background: "var(--red-d)", border: "1px solid var(--red-m)", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--red)" }}>
                  ✗ {setupMsg.replace("error:", "")}
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ═══════════════ CREATE TENANT MODAL ═══════════════ */}
      {createOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.5)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={e => (e.target as HTMLElement).id === "create-backdrop" && setCreateOpen(false)} id="create-backdrop">
          <div style={{ background: "var(--s0)", borderRadius: "var(--r-xl)", width: "100%", maxWidth: 540, maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow-dialog)" }}>
            {/* Header */}
            <div style={{ padding: "22px 26px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", position: "sticky" as const, top: 0, background: "var(--s0)", zIndex: 1 }}>
              <div>
                <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 20, color: "var(--text)" }}>Nuevo Tenant</div>
                <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 3 }}>Provisionamiento automático · schema + seed en segundos</div>
              </div>
              <button onClick={() => setCreateOpen(false)} style={{ width: 30, height: 30, background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-xs)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text2)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ padding: "22px 26px" }}>
              {/* Plan selector */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "var(--text3)", paddingBottom: 10, borderBottom: "1px solid var(--border)", marginBottom: 14 }}>Plan</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {Object.entries(PLAN_LABELS).map(([k, label]) => (
                    <div key={k} onClick={() => setForm(f => ({ ...f, plan: k }))} style={{ border: `2px solid ${form.plan === k ? "var(--acc)" : "var(--border)"}`, borderRadius: "var(--r-md)", padding: "10px 8px", cursor: "pointer", textAlign: "center" as const, background: form.plan === k ? "var(--acc-d)" : "transparent", transition: "all 0.14s" }}>
                      <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 13, color: form.plan === k ? "var(--acc)" : "var(--text)" }}>{label}</div>
                      <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text3)", marginTop: 2 }}>${PLAN_PRICES[k]}/mes</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fields */}
              {[
                { label: "Nombre del restaurante *", id: "businessName", placeholder: "Restaurante La Palma", type: "text", onChange: (v: string) => handleBusinessNameChange(v) },
              ].map(f => (
                <div key={f.id} style={{ marginBottom: 14 }}>
                  <label style={S.label}>{f.label}</label>
                  <input value={(form as any)[f.id]} onChange={e => f.onChange ? f.onChange(e.target.value) : setForm(p => ({ ...p, [f.id]: e.target.value }))} placeholder={f.placeholder} type={f.type} style={S.input} />
                </div>
              ))}

              {/* Slug with prefix */}
              <div style={{ marginBottom: 14 }}>
                <label style={S.label}>Slug (subdominio) *</label>
                <div style={{ display: "flex", background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
                  <span style={{ padding: "9px 12px", fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--text3)", background: "var(--s2)", borderRight: "1px solid var(--border)", whiteSpace: "nowrap" as const }}>rest-</span>
                  <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"") }))} placeholder="lapalma" style={{ flex: 1, padding: "9px 12px", background: "none", border: "none", outline: "none", fontFamily: "var(--f-mono)", fontSize: 13, color: "var(--text)" }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>Resultado: <strong>rest-{form.slug || "[slug]"}.rmscore.app</strong></div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={S.label}>Email de facturación *</label>
                  <input value={form.billingEmail} onChange={e => setForm(f => ({ ...f, billingEmail: e.target.value }))} placeholder="admin@rest.com" type="email" style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Nombre del admin</label>
                  <input value={form.adminDisplayName} onChange={e => setForm(f => ({ ...f, adminDisplayName: e.target.value }))} placeholder="Gerente General" type="text" style={S.input} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div>
                  <label style={S.label}>Email del admin *</label>
                  <input value={form.adminEmail} onChange={e => setForm(f => ({ ...f, adminEmail: e.target.value }))} placeholder="gerente@rest.com" type="email" style={S.input} />
                </div>
                <div>
                  <label style={S.label}>Password temporal</label>
                  <input value={form.adminPassword} onChange={e => setForm(f => ({ ...f, adminPassword: e.target.value }))} placeholder="TempPass123! si se deja vacío" type="password" style={S.input} />
                </div>
              </div>

              {createError && (
                <div style={{ marginTop: 14, padding: "10px 13px", background: "var(--red-d)", border: "1px solid var(--red-m)", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--red)" }}>{createError}</div>
              )}
            </div>

            <div style={{ padding: "14px 26px 22px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button style={S.btnSec} onClick={() => setCreateOpen(false)}>Cancelar</button>
              <button onClick={submitCreate} disabled={createLoading} style={{ ...S.btnPrimary, width: "auto", padding: "9px 20px", opacity: createLoading ? 0.7 : 1 }}>
                {createLoading ? "Provisionando..." : "Crear y Provisionar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ DETAIL MODAL ═══════════════ */}
      {detailOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.5)", backdropFilter: "blur(4px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--s0)", borderRadius: "var(--r-xl)", width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", boxShadow: "var(--shadow-dialog)" }}>
            <div style={{ padding: "22px 26px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", position: "sticky" as const, top: 0, background: "var(--s0)", zIndex: 1 }}>
              <div>
                <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 20 }}>{detailData?.tenant.business_name ?? "Cargando..."}</div>
                {detailData && <div style={{ fontSize: 13, color: "var(--text3)", marginTop: 2 }}>{detailData.tenant.slug} · {PLAN_LABELS[detailData.tenant.plan]} · {detailData.tenant.is_active ? "Activo" : detailData.tenant.status}</div>}
              </div>
              <button onClick={() => setDetailOpen(false)} style={{ width: 30, height: 30, background: "var(--s1)", border: "1px solid var(--border)", borderRadius: "var(--r-xs)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text2)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {!detailData ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--text3)" }}>Cargando...</div>
            ) : (
              <div style={{ padding: "22px 26px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Información</div>
                    {[
                      ["Schema", detailData.tenant.schema_name, true],
                      ["Plan", PLAN_LABELS[detailData.tenant.plan]],
                      ["Estado", detailData.tenant.status],
                      ["Billing email", detailData.tenant.billing_email || "–"],
                      ["Trial hasta", detailData.tenant.trial_ends_at ? new Date(detailData.tenant.trial_ends_at).toLocaleDateString("es-CR") : "–"],
                      ["Creado", new Date(detailData.tenant.created_at).toLocaleDateString("es-CR")],
                      ...(detailData.tenant.suspend_reason ? [["Razón suspensión", detailData.tenant.suspend_reason]] : []),
                    ].map(([k, v, mono]) => (
                      <div key={k as string} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                        <span style={{ color: "var(--text3)" }}>{k}</span>
                        <span style={{ fontWeight: 500, fontFamily: mono ? "var(--f-mono)" : "inherit", fontSize: mono ? 11 : 13, color: "var(--text)" }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Módulos activos ({detailData.modules.filter(m => m.is_active).length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 6 }}>
                      {detailData.modules.filter(m => m.is_active).map(m => (
                        <span key={m.module_key} style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "var(--sage-d)", color: "var(--sage)", border: "1px solid var(--sage-m)" }}>
                          {m.module_key.replace("CORE_","").replace("MOD_","")}
                        </span>
                      ))}
                    </div>
                    {detailData.logs.length > 0 && (
                      <>
                        <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 14, marginTop: 16, marginBottom: 10 }}>Actividad reciente</div>
                        {detailData.logs.slice(0,4).map((l, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, padding: "6px 10px", background: "var(--s1)", borderRadius: "var(--r-xs)", marginBottom: 5 }}>
                            <span style={{ fontFamily: "var(--f-mono)", background: "var(--s2)", padding: "1px 5px", borderRadius: 3, fontSize: 10, color: "var(--text3)" }}>{l.action}</span>
                            <span style={{ color: l.status === "COMPLETED" ? "var(--sage)" : "var(--red)" }}>{l.status}</span>
                            <span style={{ marginLeft: "auto", color: "var(--text3)" }}>{new Date(l.created_at).toLocaleDateString("es-CR")}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
                {/* Action strip */}
                <div style={{ paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
                  {detailData.tenant.is_active
                    ? <button style={{ ...S.btnRow, color: "var(--red)", borderColor: "var(--red-m)", padding: "7px 13px" }} onClick={() => { setDetailOpen(false); confirmSuspend(detailData.tenant); }}>Suspender</button>
                    : <button style={{ ...S.btnRow, color: "var(--sage)", borderColor: "var(--sage-m)", padding: "7px 13px" }} onClick={() => { setDetailOpen(false); confirmReactivate(detailData.tenant); }}>Reactivar</button>
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════ CONFIRM MODAL ═══════════════ */}
      {confirmOpen && confirmConfig && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(26,18,8,0.5)", backdropFilter: "blur(4px)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "var(--s0)", borderRadius: "var(--r-xl)", width: "100%", maxWidth: 400, boxShadow: "var(--shadow-dialog)", padding: "28px 26px 24px" }}>
            <div style={{ fontFamily: "var(--f-disp)", fontWeight: 700, fontSize: 18, marginBottom: 10, color: "var(--text)" }}>{confirmConfig.title}</div>
            <div style={{ fontSize: 14, color: "var(--text2)", lineHeight: 1.6, marginBottom: confirmConfig.needsReason ? 14 : 20 }}>{confirmConfig.message}</div>
            {confirmConfig.needsReason && (
              <div style={{ marginBottom: 20 }}>
                <label style={S.label}>Razón (requerida)</label>
                <input value={confirmReason} onChange={e => setConfirmReason(e.target.value)} placeholder="Ej: Pago vencido, solicitud del cliente..." style={S.input} />
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button style={S.btnSec} onClick={() => setConfirmOpen(false)}>Cancelar</button>
              <button
                onClick={executeConfirm}
                disabled={confirmLoading}
                style={{
                  padding: "9px 18px", border: "none", borderRadius: "var(--r-sm)",
                  fontFamily: "var(--f-disp)", fontWeight: 600, fontSize: 14, cursor: "pointer",
                  background: confirmConfig.variant === "danger" ? "var(--red)" : confirmConfig.variant === "success" ? "var(--sage)" : "var(--acc)",
                  color: "white", opacity: confirmLoading ? 0.7 : 1,
                }}
              >
                {confirmLoading ? "Procesando..." : confirmConfig.actionLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ TOASTS ═══════════════ */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 999, display: "flex", flexDirection: "column" as const, gap: 8 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: "var(--s0)", border: "1px solid var(--border)", borderLeft: `3px solid ${t.type === "success" ? "var(--sage)" : t.type === "error" ? "var(--red)" : "var(--acc)"}`, borderRadius: "var(--r-md)", padding: "11px 15px", boxShadow: "var(--shadow-lg)", display: "flex", gap: 10, alignItems: "center", minWidth: 260, maxWidth: 340 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{t.title}</div>
              {t.msg && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>{t.msg}</div>}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
```

---

## T003 — Agregar ruta en `client/src/App.tsx`

Buscar en `App.tsx` la sección donde se definen las rutas públicas (cerca de donde está `/qr/:tableCode` o `/reserve`). Agregar:

**Import** al inicio del archivo (junto a los otros imports de páginas):
```tsx
import SuperadminPage from "@/pages/superadmin";
```

**Ruta** dentro del `AppRouter`, en el bloque de rutas públicas (sin autenticación requerida), junto a las otras rutas como `/qr/:tableCode`:
```tsx
<Route path="/superadmin" component={SuperadminPage} />
```

Esta ruta va en el mismo bloque que `/qr/:tableCode` — fuera del layout autenticado, porque tiene su propio mecanismo de auth por token.

---

## T004 — Verificar funcionamiento

Después de aplicar los cambios:

1. Reiniciar el servidor si es necesario
2. Navegar a `/superadmin`
3. Verificar que aparece la pantalla de login con campo de token
4. Ingresar el token `rmscore-superadmin-2026` (o el que esté en SUPERADMIN_TOKEN)
5. Verificar que carga el dashboard con métricas
6. Verificar que el resto de la app sigue funcionando (login PIN, mesas, POS)

**Criterio de aceptación:**
- `/superadmin` muestra login → dashboard completo
- Las demás rutas del sistema no se ven afectadas
- No hay errores de TypeScript en la compilación
