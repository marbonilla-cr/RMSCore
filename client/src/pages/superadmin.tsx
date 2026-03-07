import { useState, useEffect, useCallback } from "react";

// ─── ESTILOS EMBEBIDOS (independientes del layout principal) ──────────────────
const LINEN_STYLES = `
  .sa-root {
    --sa-bg: #f7f3ee; --sa-s0: #ffffff; --sa-s1: #f0ebe3; --sa-s2: #e6dfd5;
    --sa-border: #ddd5c8; --sa-acc: #1d4ed8; --sa-acc-d: rgba(29,78,216,0.08);
    --sa-coral: #e05e3a; --sa-sage: #4a7c59; --sa-sage-d: rgba(74,124,89,0.09);
    --sa-sage-m: rgba(74,124,89,0.22); --sa-amber: #c9841a;
    --sa-red: #dc2626; --sa-red-d: rgba(220,38,38,0.08); --sa-red-m: rgba(220,38,38,0.20);
    --sa-text: #1a1208; --sa-text2: #5a4e40; --sa-text3: #9c8e7e;
    --sa-rail: #1a1208; --sa-rail-text: rgba(255,255,255,0.40);
    --sa-rail-accent: #e05e3a;
    --sa-f-disp: 'Outfit', sans-serif; --sa-f-body: 'IBM Plex Sans', sans-serif;
    --sa-f-mono: 'IBM Plex Mono', monospace;
    --sa-r-xs: 6px; --sa-r-sm: 10px; --sa-r-md: 14px; --sa-r-xl: 24px;
    --sa-shadow-dialog: 0 20px 60px rgba(26,18,8,0.18), 0 0 0 1px #ddd5c8;
    font-family: 'IBM Plex Sans', sans-serif; font-size: 14px;
    line-height: 1.5; color: #1a1208; -webkit-font-smoothing: antialiased;
  }
  .sa-root * { box-sizing: border-box; }
  .sa-root button, .sa-root input, .sa-root select { font-family: inherit; }
  .sa-nav-item { transition: background 0.14s, color 0.14s; }
  .sa-nav-item:hover { background: rgba(255,255,255,0.08) !important; color: rgba(255,255,255,0.75) !important; }
  .sa-tr { transition: background 0.12s; }
  .sa-tr:hover { background: #f0ebe3 !important; }
  .sa-tr:hover .sa-row-actions { opacity: 1 !important; }
  .sa-row-actions { opacity: 0; transition: opacity 0.14s; }
  .sa-plan-opt { transition: all 0.14s; cursor: pointer; }
  .sa-plan-opt:hover { border-color: var(--sa-acc) !important; }
  .sa-plan-opt.active { border-color: var(--sa-acc); background: rgba(29,78,216,0.06); }
  .sa-overlay { animation: saFadeIn 0.18s ease both; }
  .sa-modal  { animation: saSlideUp 0.26s cubic-bezier(.22,.68,0,1.2) both; }
  .sa-toast  { animation: saSlideRight 0.26s cubic-bezier(.22,.68,0,1.2) both; }
  @keyframes saFadeIn    { from{opacity:0} to{opacity:1} }
  @keyframes saSlideUp   { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  @keyframes saSlideRight{ from{opacity:0;transform:translateX(14px)} to{opacity:1;transform:translateX(0)} }
  .sa-root ::-webkit-scrollbar{width:4px;height:4px}
  .sa-root ::-webkit-scrollbar-thumb{background:#cfc5b6;border-radius:4px}
`;

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const TOKEN_KEY = "rms_superadmin_token";

const PLANS = ["TRIAL","BASIC","PRO","ENTERPRISE"] as const;
type Plan = typeof PLANS[number];

const PLAN_LABELS: Record<Plan,string>  = { TRIAL:"Trial", BASIC:"Básico", PRO:"Pro", ENTERPRISE:"Empresarial" };
const PLAN_PRICES: Record<Plan,number>  = { TRIAL:0, BASIC:50, PRO:120, ENTERPRISE:250 };
const PLAN_COLORS: Record<Plan,string>  = { TRIAL:"#c9841a", BASIC:"#1d4ed8", PRO:"#4a7c59", ENTERPRISE:"#e05e3a" };

// Módulos incluidos por plan — idéntico a provision-service.ts
const PLAN_MODULES: Record<Plan, string[]> = {
  TRIAL:      ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD"],
  BASIC:      ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD"],
  PRO:        ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD","MOD_INVENTORY","MOD_HR","MOD_RESERVATIONS","MOD_LOYALTY","MOD_ANALYTICS"],
  ENTERPRISE: ["CORE_TABLES","CORE_POS","CORE_QR","CORE_DASHBOARD","MOD_INVENTORY","MOD_HR","MOD_RESERVATIONS","MOD_LOYALTY","MOD_ANALYTICS","MOD_QBO","MOD_MULTI_LOCATION","MOD_API"],
};

const MODULE_LABELS: Record<string,string> = {
  CORE_TABLES:"Mesas + KDS", CORE_POS:"POS + Caja", CORE_QR:"QR Autoorden", CORE_DASHBOARD:"Dashboard",
  MOD_INVENTORY:"Inventario", MOD_HR:"RRHH", MOD_RESERVATIONS:"Reservaciones",
  MOD_LOYALTY:"Loyalty", MOD_ANALYTICS:"Sales Cube", MOD_QBO:"QuickBooks",
  MOD_MULTI_LOCATION:"Multi-ubicación", MOD_API:"API Access",
};

// ─── TIPOS ────────────────────────────────────────────────────────────────────
interface Tenant {
  id: number; slug: string; business_name: string; schema_name: string;
  plan: string; status: string; is_active: boolean;
  trial_ends_at: string|null; suspended_at: string|null;
  suspend_reason: string|null; billing_email: string|null;
  created_at: string; active_modules?: number;
}
interface Metrics {
  active_tenants:string; trial_tenants:string; basic_tenants:string;
  pro_tenants:string; enterprise_tenants:string; suspended_tenants:string;
}
interface TenantDetail {
  tenant: Tenant;
  modules: { module_key:string; is_active:boolean }[];
  logs: { action:string; status:string; created_at:string }[];
}

// ─── ICONOS SVG ───────────────────────────────────────────────────────────────
const Ico = {
  home:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  chart:   <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  gear:    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M4.93 19.07l1.41-1.41M20 12h2M2 12h2M19.07 19.07l-1.41-1.41M4.93 4.93l1.41 1.41M12 20v2M12 2v2"/></svg>,
  refresh: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
  logout:  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>,
  plus:    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  close:   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  eye:     <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  eyeOff:  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/></svg>,
  search:  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  upgrade: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="17 11 12 6 7 11"/><line x1="12" y1="6" x2="12" y2="18"/></svg>,
};

// ─── COMPONENTE PRINCIPAL ─────────────────────────────────────────────────────
export default function SuperadminPage() {

  // Inyectar estilos + fuentes una sola vez
  useEffect(() => {
    if (!document.getElementById("sa-styles")) {
      const el = document.createElement("style");
      el.id = "sa-styles"; el.textContent = LINEN_STYLES;
      document.head.appendChild(el);
    }
    if (!document.querySelector('link[href*="Outfit"]')) {
      const lk = document.createElement("link");
      lk.rel = "stylesheet";
      lk.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
      document.head.appendChild(lk);
    }
  }, []);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const [token,       setToken]       = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [tokenInput,  setTokenInput]  = useState("");
  const [tokenVis,    setTokenVis]    = useState(false);
  const [authed,      setAuthed]      = useState(false);
  const [authErr,     setAuthErr]     = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [metrics,  setMetrics]  = useState<Metrics|null>(null);
  const [tenants,  setTenants]  = useState<Tenant[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [section,  setSection]  = useState<"tenants"|"metrics"|"setup"|"migrations">("tenants");

  // ── Modals ───────────────────────────────────────────────────────────────────
  const [createOpen,   setCreateOpen]   = useState(false);
  const [detailOpen,   setDetailOpen]   = useState(false);
  const [detailData,   setDetailData]   = useState<TenantDetail|null>(null);
  const [planOpen,     setPlanOpen]     = useState(false);   // ← modal cambio de plan
  const [planTenant,   setPlanTenant]   = useState<Tenant|null>(null);
  const [planSelected, setPlanSelected] = useState<Plan>("PRO");
  const [planLoading,  setPlanLoading]  = useState(false);
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [confirmCfg,   setConfirmCfg]   = useState<{
    title:string; message:string; label:string; variant:"danger"|"success"|"primary";
    needsReason?:boolean; onConfirm:(reason?:string)=>Promise<void>;
  }|null>(null);
  const [confirmReason,  setConfirmReason]  = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);

  // ── Create form ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    plan:"TRIAL", businessName:"", slug:"", billingEmail:"",
    adminEmail:"", adminPassword:"", adminDisplayName:"",
    orderDailyStart:"1", orderGlobalStart:"1", invoiceStart:"1",
    trialBasePlan:"BASIC",
  });
  const [createLoading, setCreateLoading] = useState(false);
  const [createError,   setCreateError]   = useState("");
  const [pwVisible,     setPwVisible]     = useState(false);
  const [credDialog,    setCredDialog]    = useState<{slug:string;businessName:string;username:string;password:string;pin:string}|null>(null);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [search,       setSearch]       = useState("");
  const [filterPlan,   setFilterPlan]   = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  // ── Reprovision ─────────────────────────────────────────────────────────────
  const [reprovOpen, setReprovOpen]     = useState(false);
  const [reprovTenant, setReprovTenant] = useState<Tenant|null>(null);
  const [reprovForm, setReprovForm]     = useState({ adminEmail:"", adminPassword:"", adminDisplayName:"", orderDailyStart:"1", orderGlobalStart:"1", invoiceStart:"1" });
  const [reprovLoading, setReprovLoading] = useState(false);
  const [reprovError, setReprovError]   = useState("");

  // ── Migrations ──────────────────────────────────────────────────────────────
  const [migrationStatus, setMigrationStatus] = useState<any[]>([]);
  const [migrationLoading, setMigrationLoading] = useState(false);

  // ── Password Reset ─────────────────────────────────────────────────────────
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetResult, setResetResult] = useState<""|"ok"|"err">("");
  const [resetErr, setResetErr] = useState("");

  // ── Setup ────────────────────────────────────────────────────────────────────
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupResult,  setSetupResult]  = useState<""|"ok"|"err">("");
  const [setupErr,     setSetupErr]     = useState("");

  // ── Toasts ───────────────────────────────────────────────────────────────────
  const [toasts, setToasts] = useState<{id:number;type:string;title:string;msg:string}[]>([]);

  // ── API helper ───────────────────────────────────────────────────────────────
  const api = useCallback(async (method:string, path:string, body?:unknown) => {
    const r = await fetch(path, {
      method,
      headers:{ "Content-Type":"application/json", "X-Superadmin-Token": token || tokenInput },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || "Error del servidor");
    return data;
  }, [token, tokenInput]);

  const toast = useCallback((type:string, title:string, msg="") => {
    const id = Date.now();
    setToasts(p => [...p,{id,type,title,msg}]);
    setTimeout(() => setToasts(p => p.filter(t=>t.id!==id)), 4500);
  }, []);

  // ── Load data ────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [t, m] = await Promise.all([
        api("GET","/api/superadmin/tenants"),
        api("GET","/api/superadmin/metrics"),
      ]);
      setTenants(t); setMetrics(m);
    } catch(e:any){ toast("error","Error al cargar",e.message); }
    finally { setLoading(false); }
  }, [api, toast]);

  // Auto-auth si hay token guardado
  useEffect(() => {
    if (!token) return;
    fetch("/api/superadmin/metrics",{ headers:{"X-Superadmin-Token":token} })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(m => { setAuthed(true); setMetrics(m); loadData(); })
      .catch(()=>{ localStorage.removeItem(TOKEN_KEY); setToken(""); });
  }, []); // eslint-disable-line

  // ── Login ────────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!tokenInput.trim()) return;
    setAuthLoading(true); setAuthErr("");
    try {
      const r = await fetch("/api/superadmin/metrics",{ headers:{"X-Superadmin-Token":tokenInput.trim()} });
      if (!r.ok) throw new Error();
      const m = await r.json();
      setToken(tokenInput.trim());
      localStorage.setItem(TOKEN_KEY, tokenInput.trim());
      setMetrics(m); setAuthed(true); loadData();
    } catch { setAuthErr("Token incorrecto. Verifica SUPERADMIN_TOKEN en Replit Secrets."); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(""); setTokenInput(""); setAuthed(false);
    setTenants([]); setMetrics(null);
  };

  // ── Slug auto-gen ─────────────────────────────────────────────────────────────
  const onBizName = (v:string) => {
    const auto = v.toLowerCase()
      .replace(/[áàä]/g,"a").replace(/[éèë]/g,"e").replace(/[íìï]/g,"i")
      .replace(/[óòö]/g,"o").replace(/[úùü]/g,"u").replace(/ñ/g,"n")
      .replace(/[^a-z0-9]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,30);
    setForm(f=>({...f, businessName:v, ...(f.slug?{}:{slug:auto})}));
  };

  // ── Create tenant ─────────────────────────────────────────────────────────────
  const submitCreate = async () => {
    if (!form.businessName||!form.slug||!form.billingEmail||!form.adminEmail){
      setCreateError("Completa todos los campos con *"); return;
    }
    setCreateLoading(true); setCreateError("");
    try {
      const actualPw = form.adminPassword||"TempPass123!";
      const result = await api("POST","/api/superadmin/tenants",{
        ...form, slug:`rest-${form.slug}`,
        adminPassword: actualPw,
        adminDisplayName: form.adminDisplayName||form.businessName,
        orderDailyStart: parseInt(form.orderDailyStart)||1,
        orderGlobalStart: parseInt(form.orderGlobalStart)||1,
        invoiceStart: parseInt(form.invoiceStart)||1,
        trialBasePlan: form.plan==="TRIAL" ? form.trialBasePlan : undefined,
      });
      setCreateOpen(false);
      const bizName = form.businessName;
      const slugVal = `rest-${form.slug}`;
      setForm({plan:"TRIAL",businessName:"",slug:"",billingEmail:"",adminEmail:"",adminPassword:"",adminDisplayName:"",orderDailyStart:"1",orderGlobalStart:"1",invoiceStart:"1",trialBasePlan:"BASIC"});
      setPwVisible(false);
      if (result.credentials) {
        setCredDialog({ slug:slugVal, businessName:bizName, username:result.credentials.username, password:result.credentials.password, pin:result.credentials.pin });
      } else {
        toast("success","¡Tenant creado!",bizName);
      }
      await loadData();
    } catch(e:any){ setCreateError(e.message); }
    finally { setCreateLoading(false); }
  };

  // ── Detail ───────────────────────────────────────────────────────────────────
  const openDetail = async (id:number) => {
    setDetailOpen(true); setDetailData(null);
    setResetEmail(""); setResetResult(""); setResetErr("");
    try {
      const data = await api("GET",`/api/superadmin/tenants/${id}`);
      setDetailData(data);
      setResetEmail(data.tenant.billing_email || "");
    }
    catch(e:any){ toast("error","Error",e.message); setDetailOpen(false); }
  };

  const submitPasswordReset = async () => {
    if (!detailData || !resetEmail.trim()) { setResetErr("Email requerido"); return; }
    setResetLoading(true); setResetResult(""); setResetErr("");
    try {
      await api("POST",`/api/superadmin/tenants/${detailData.tenant.id}/send-password-reset`,{ email: resetEmail.trim() });
      setResetResult("ok");
      toast("success","Correo enviado",`Reset enviado a ${resetEmail.trim()}`);
    } catch(e:any){ setResetResult("err"); setResetErr(e.message); }
    finally { setResetLoading(false); }
  };

  // ── CAMBIO DE PLAN ────────────────────────────────────────────────────────────
  const openPlanChange = (t:Tenant) => {
    setPlanTenant(t);
    setPlanSelected((PLANS.includes(t.plan as Plan) ? t.plan : "PRO") as Plan);
    setPlanOpen(true);
  };

  const submitPlanChange = async () => {
    if (!planTenant) return;
    if (planSelected === planTenant.plan) { setPlanOpen(false); return; }
    setPlanLoading(true);
    try {
      await api("PATCH",`/api/superadmin/tenants/${planTenant.id}/plan`,{ plan: planSelected });
      toast("success","Plan actualizado",`${planTenant.business_name} → ${PLAN_LABELS[planSelected]}`);
      setPlanOpen(false);
      // Si el detail está abierto, recargar
      if (detailOpen && detailData?.tenant.id === planTenant.id) {
        openDetail(planTenant.id);
      }
      await loadData();
    } catch(e:any){ toast("error","Error al cambiar plan",e.message); }
    finally { setPlanLoading(false); }
  };

  // ── Confirm actions ───────────────────────────────────────────────────────────
  const doSuspend = (t:Tenant) => {
    setConfirmReason(""); setConfirmCfg({
      title:"Suspender tenant", label:"Suspender", variant:"danger", needsReason:true,
      message:`Se bloqueará el acceso a "${t.business_name}". El restaurante no podrá ingresar.`,
      onConfirm: async(r) => { await api("POST",`/api/superadmin/tenants/${t.id}/suspend`,{reason:r}); toast("success","Suspendido",t.business_name); await loadData(); },
    }); setConfirmOpen(true);
  };
  const doReactivate = (t:Tenant) => {
    setConfirmReason(""); setConfirmCfg({
      title:"Reactivar tenant", label:"Reactivar", variant:"success",
      message:`Se restaurará el acceso a "${t.business_name}".`,
      onConfirm: async() => { await api("POST",`/api/superadmin/tenants/${t.id}/reactivate`); toast("success","Reactivado",t.business_name); await loadData(); },
    }); setConfirmOpen(true);
  };
  const execConfirm = async () => {
    if (!confirmCfg) return;
    if (confirmCfg.needsReason && !confirmReason.trim()){ toast("error","Razón requerida",""); return; }
    setConfirmLoading(true);
    try { await confirmCfg.onConfirm(confirmReason.trim()||undefined); setConfirmOpen(false); }
    catch(e:any){ toast("error","Error",e.message); }
    finally { setConfirmLoading(false); }
  };

  // ── Reprovision ──────────────────────────────────────────────────────────────
  const openReprovision = (t: Tenant) => {
    setReprovTenant(t);
    setReprovForm({ adminEmail:"", adminPassword:"", adminDisplayName:t.business_name, orderDailyStart:"1", orderGlobalStart:"1", invoiceStart:"1" });
    setReprovError("");
    setReprovOpen(true);
  };

  const submitReprovision = async () => {
    if (!reprovTenant) return;
    if (!reprovForm.adminEmail || !reprovForm.adminPassword || !reprovForm.adminDisplayName) {
      setReprovError("Email, password y nombre del admin son requeridos"); return;
    }
    setReprovLoading(true); setReprovError("");
    try {
      await api("POST",`/api/superadmin/tenants/${reprovTenant.id}/reprovision`,{
        adminEmail: reprovForm.adminEmail,
        adminPassword: reprovForm.adminPassword,
        adminDisplayName: reprovForm.adminDisplayName,
        orderDailyStart: parseInt(reprovForm.orderDailyStart)||1,
        orderGlobalStart: parseInt(reprovForm.orderGlobalStart)||1,
        invoiceStart: parseInt(reprovForm.invoiceStart)||1,
      });
      setReprovOpen(false);
      toast("success","Tenant re-provisionado",reprovTenant.business_name);
      await loadData();
    } catch(e:any){ setReprovError(e.message); }
    finally { setReprovLoading(false); }
  };

  // ── Migrations ──────────────────────────────────────────────────────────────
  const [migrationFiles, setMigrationFiles] = useState<string[]>([]);
  const [markingSchema, setMarkingSchema] = useState<string|null>(null);

  const loadMigrationStatus = async () => {
    setMigrationLoading(true);
    try {
      const data = await api("GET","/api/superadmin/migration-status");
      setMigrationStatus(data.tenants || []);
      setMigrationFiles(data.files || []);
    } catch(e:any){ toast("error","Error al cargar migraciones",e.message); }
    finally { setMigrationLoading(false); }
  };

  const markAsApplied = async (schemaName: string) => {
    if (migrationFiles.length === 0) { toast("error","Sin archivos","No hay archivos de migración"); return; }
    setMarkingSchema(schemaName);
    try {
      await api("POST","/api/superadmin/migrations/mark-applied",{ schemaName, filenames: migrationFiles });
      toast("success","Migraciones marcadas",schemaName);
      await loadMigrationStatus();
    } catch(e:any){ toast("error","Error al marcar",e.message); }
    finally { setMarkingSchema(null); }
  };

  // ── Setup ────────────────────────────────────────────────────────────────────
  const runSetup = async () => {
    setSetupLoading(true); setSetupResult(""); setSetupErr("");
    try { await api("POST","/api/superadmin/setup"); setSetupResult("ok"); toast("success","Setup completado",""); }
    catch(e:any){ setSetupResult("err"); setSetupErr(e.message); }
    finally { setSetupLoading(false); }
  };

  // ── Filtered tenants ─────────────────────────────────────────────────────────
  const filtered = tenants.filter(t => {
    const q = search.toLowerCase();
    return (!q || t.business_name.toLowerCase().includes(q) || t.slug.includes(q))
      && (!filterPlan   || t.plan   === filterPlan)
      && (!filterStatus || (filterStatus==="ACTIVE" ? t.is_active : t.status===filterStatus));
  });

  const mrr = tenants.reduce((s,t)=> s+(t.is_active?(PLAN_PRICES[t.plan as Plan]||0):0), 0);

  // ── Estilos reutilizables ─────────────────────────────────────────────────────
  const S = {
    input:      { width:"100%", padding:"9px 12px", background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-sm)", fontSize:14, color:"var(--sa-text)", outline:"none" } as React.CSSProperties,
    btnPrimary: { padding:"9px 20px", background:"var(--sa-acc)", color:"white", border:"none", borderRadius:"var(--sa-r-sm)", fontFamily:"var(--sa-f-disp)", fontWeight:600, fontSize:14, cursor:"pointer" } as React.CSSProperties,
    btnSec:     { padding:"9px 16px", background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-sm)", fontFamily:"var(--sa-f-disp)", fontWeight:600, fontSize:14, color:"var(--sa-text2)", cursor:"pointer" } as React.CSSProperties,
    lbl:        { display:"block", fontSize:12, fontWeight:600, color:"var(--sa-text2)", marginBottom:5, letterSpacing:"0.02em" } as React.CSSProperties,
    card:       { background:"var(--sa-s0)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-md)", padding:"16px 20px" } as React.CSSProperties,
    tableWrap:  { background:"var(--sa-s0)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-md)", overflow:"hidden" } as React.CSSProperties,
    overlay:    { position:"fixed", inset:0, background:"rgba(26,18,8,0.55)", backdropFilter:"blur(4px)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 } as React.CSSProperties,
    modal:      { background:"var(--sa-s0)", borderRadius:"var(--sa-r-xl)", width:"100%", maxWidth:540, maxHeight:"90vh", overflowY:"auto", boxShadow:"var(--sa-shadow-dialog)" } as React.CSSProperties,
    modalHdr:   { padding:"22px 26px 18px", borderBottom:"1px solid var(--sa-border)", display:"flex", alignItems:"flex-start", justifyContent:"space-between", position:"sticky", top:0, background:"var(--sa-s0)", zIndex:1 } as React.CSSProperties,
    closeBtn:   { width:30, height:30, background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-xs)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"var(--sa-text2)" } as React.CSSProperties,
  };

  const badge = (color:string, bg:string, border:string): React.CSSProperties =>
    ({ display:"inline-flex", alignItems:"center", gap:4, padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:600, color, background:bg, border:`1px solid ${border}` });

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER: LOGIN
  // ════════════════════════════════════════════════════════════════════════════
  if (!authed) return (
    <div className="sa-root" style={{ minHeight:"100dvh", display:"flex", alignItems:"center", justifyContent:"center", background:"#1a1208", backgroundImage:"radial-gradient(ellipse 80% 60% at 50% -10%, rgba(224,94,58,0.18), transparent)", padding:20 }}>
      <div style={{ width:"100%", maxWidth:400, background:"var(--sa-s0)", borderRadius:"var(--sa-r-xl)", padding:"36px 36px 32px", boxShadow:"var(--sa-shadow-dialog)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:28 }}>
          <div style={{ width:36, height:36, background:"var(--sa-coral)", borderRadius:"var(--sa-r-sm)", display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontFamily:"var(--sa-f-disp)", fontWeight:800, fontSize:16 }}>R</div>
          <div>
            <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:18 }}>RMS<span style={{ color:"var(--sa-coral)" }}>Core</span></div>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase" as const, color:"var(--sa-text3)" }}>SuperAdmin</div>
          </div>
        </div>
        <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:24, marginBottom:22 }}>Panel de Operaciones</div>
        <label style={S.lbl}>Token de acceso</label>
        <div style={{ display:"flex", background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-sm)", overflow:"hidden", marginBottom:4 }}>
          <input type={tokenVis?"text":"password"} value={tokenInput} onChange={e=>setTokenInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="Ingrese el token" autoFocus
            style={{ flex:1, padding:"9px 12px", background:"none", border:"none", outline:"none", fontFamily:"var(--sa-f-mono)", fontSize:13, color:"var(--sa-text)", letterSpacing:"0.04em" }} />
          <button onClick={()=>setTokenVis(v=>!v)} style={{ padding:"0 12px", background:"none", border:"none", color:"var(--sa-text3)", cursor:"pointer", display:"flex", alignItems:"center" }}>
            {tokenVis ? Ico.eyeOff : Ico.eye}
          </button>
        </div>
        <div style={{ fontSize:11, color:"var(--sa-text3)", marginBottom:14 }}>Configurado como SUPERADMIN_TOKEN en Replit Secrets</div>
        {authErr && <div style={{ background:"var(--sa-red-d)", border:"1px solid var(--sa-red-m)", borderRadius:"var(--sa-r-sm)", padding:"10px 13px", fontSize:13, color:"var(--sa-red)", marginBottom:12 }}>{authErr}</div>}
        <button onClick={handleLogin} disabled={authLoading} style={{ ...S.btnPrimary, width:"100%", opacity:authLoading?0.7:1 }}>
          {authLoading?"Verificando...":"Ingresar al Panel"}
        </button>
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════════
  // RENDER: APP
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="sa-root" style={{ display:"flex", minHeight:"100dvh" }}>

      {/* ── SIDEBAR ── */}
      <nav style={{ width:216, minHeight:"100dvh", background:"var(--sa-rail)", display:"flex", flexDirection:"column", position:"fixed", left:0, top:0, zIndex:100 }}>
        <div style={{ padding:"18px 14px 14px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:30, height:30, background:"var(--sa-coral)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", color:"white", fontFamily:"var(--sa-f-disp)", fontWeight:800, fontSize:13, flexShrink:0 }}>R</div>
            <div>
              <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:15, color:"white" }}>RMSCore</div>
              <div style={{ fontSize:9, fontWeight:600, color:"var(--sa-rail-accent)", letterSpacing:"0.06em", textTransform:"uppercase" as const }}>SuperAdmin</div>
            </div>
          </div>
        </div>
        <div style={{ padding:"10px 6px", flex:1 }}>
          {([
            {id:"tenants", label:"Tenants",    icon:Ico.home  },
            {id:"metrics", label:"Métricas",   icon:Ico.chart },
            {id:"migrations", label:"Versiones de Schema", icon:Ico.gear },
            {id:"setup",   label:"Setup",      icon:Ico.gear  },
          ] as const).map(item=>(
            <div key={item.id} className="sa-nav-item"
              onClick={()=>{ setSection(item.id as any); if(item.id==="metrics") loadData(); if(item.id==="migrations") loadMigrationStatus(); }}
              style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 9px", borderRadius:"var(--sa-r-sm)", marginBottom:1, cursor:"pointer", fontSize:13, fontWeight:500, color:section===item.id?"var(--sa-rail-accent)":"var(--sa-rail-text)", background:section===item.id?"rgba(224,94,58,0.18)":"transparent" }}>
              {item.icon}{item.label}
              {item.id==="tenants" && (
                <span style={{ marginLeft:"auto", background:"var(--sa-coral)", color:"white", fontSize:10, fontWeight:700, padding:"1px 6px", borderRadius:10 }}>
                  {tenants.filter(t=>t.is_active).length}
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding:"10px 6px", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 9px" }}>
            <div style={{ width:26, height:26, background:"var(--sa-rail-accent)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:11, color:"white", flexShrink:0 }}>SA</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:600, color:"rgba(255,255,255,0.7)" }}>SuperAdmin</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.3)" }}>Acceso total</div>
            </div>
            <button onClick={handleLogout} title="Salir" style={{ background:"none", border:"none", color:"rgba(255,255,255,0.3)", cursor:"pointer", padding:4, display:"flex", borderRadius:4 }}>{Ico.logout}</button>
          </div>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <div style={{ marginLeft:216, flex:1, display:"flex", flexDirection:"column" }}>
        {/* Topbar */}
        <div style={{ height:54, background:"var(--sa-s0)", borderBottom:"1px solid var(--sa-border)", display:"flex", alignItems:"center", padding:"0 24px", position:"sticky", top:0, zIndex:50 }}>
          <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:18, flex:1 }}>
            {{tenants:"Tenants",metrics:"Métricas",setup:"Configuración",migrations:"Versiones de Schema"}[section]}
          </div>
          <button onClick={loadData} style={{ width:32, height:32, background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-xs)", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", color:"var(--sa-text2)" }}>{Ico.refresh}</button>
        </div>

        <div style={{ padding:24 }}>

          {/* ════ TENANTS ════ */}
          {section==="tenants" && <>
            {/* Metrics strip */}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))", gap:14, marginBottom:22 }}>
              {[
                {label:"Activos",     value:metrics?.active_tenants??"–",  color:"var(--sa-sage)"  },
                {label:"En trial",    value:metrics?.trial_tenants??"–",   color:"var(--sa-amber)" },
                {label:"Plan Básico", value:metrics?.basic_tenants??"–",   color:"var(--sa-acc)"   },
                {label:"Plan Pro",    value:metrics?.pro_tenants??"–",     color:"var(--sa-coral)" },
                {label:"MRR est.",    value:mrr>0?`$${mrr.toLocaleString()}`:"$0", color:"var(--sa-text)", sm:true},
              ].map((m,i)=>(
                <div key={i} style={S.card}>
                  <div style={{ fontSize:10, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" as const, color:"var(--sa-text3)", marginBottom:8 }}>{m.label}</div>
                  <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:800, fontSize:(m as any).sm?22:30, color:m.color, lineHeight:1 }}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div style={S.tableWrap}>
              {/* Toolbar */}
              <div style={{ padding:"12px 18px", borderBottom:"1px solid var(--sa-border)", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" as const }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-xs)", padding:"6px 11px", flex:"1 1 180px", maxWidth:280 }}>
                  {Ico.search}
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar..." style={{ background:"none", border:"none", outline:"none", fontSize:13, color:"var(--sa-text)", width:"100%" }} />
                </div>
                <select value={filterPlan} onChange={e=>setFilterPlan(e.target.value)} style={{ padding:"6px 10px", background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-xs)", fontSize:13, color:"var(--sa-text2)", outline:"none" }}>
                  <option value="">Todos los planes</option>
                  {PLANS.map(p=><option key={p} value={p}>{PLAN_LABELS[p]}</option>)}
                </select>
                <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{ padding:"6px 10px", background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-xs)", fontSize:13, color:"var(--sa-text2)", outline:"none" }}>
                  <option value="">Todos los estados</option>
                  <option value="ACTIVE">Activos</option>
                  <option value="SUSPENDED">Suspendidos</option>
                </select>
                <button onClick={()=>setCreateOpen(true)} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", background:"var(--sa-acc)", color:"white", border:"none", borderRadius:"var(--sa-r-xs)", fontFamily:"var(--sa-f-disp)", fontWeight:600, fontSize:13, cursor:"pointer", marginLeft:"auto" }}>
                  {Ico.plus} Nuevo Tenant
                </button>
              </div>

              {loading ? (
                <div style={{ padding:40, textAlign:"center", color:"var(--sa-text3)" }}>Cargando...</div>
              ) : filtered.length===0 ? (
                <div style={{ padding:50, textAlign:"center", color:"var(--sa-text3)", fontSize:13 }}>
                  No hay tenants. Crea el primero con <strong>+ Nuevo Tenant</strong>
                </div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"var(--sa-s1)" }}>
                        {["Restaurante","Plan","Estado","MRR","Creado",""].map((h,i)=>(
                          <th key={i} style={{ textAlign:"left", padding:"9px 18px", fontSize:10, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" as const, color:"var(--sa-text3)", borderBottom:"1px solid var(--sa-border)", whiteSpace:"nowrap" as const }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(t=>{
                        const pc = PLAN_COLORS[t.plan as Plan]||"#888";
                        const tLeft = t.plan==="TRIAL"&&t.trial_ends_at ? Math.max(0,Math.ceil((new Date(t.trial_ends_at).getTime()-Date.now())/86400000)) : null;
                        return (
                          <tr key={t.id} className="sa-tr" style={{ borderBottom:"1px solid var(--sa-border)" }}>
                            <td style={{ padding:"12px 18px" }}>
                              <div style={{ fontWeight:600, fontSize:13 }}>{t.business_name}</div>
                              <div style={{ fontFamily:"var(--sa-f-mono)", fontSize:10, color:"var(--sa-text3)", background:"var(--sa-s1)", padding:"1px 5px", borderRadius:3, display:"inline-block", marginTop:2 }}>{t.slug}</div>
                            </td>
                            <td style={{ padding:"12px 18px" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                                <span style={badge(pc,pc+"18",pc+"50")}>{PLAN_LABELS[t.plan as Plan]||t.plan}</span>
                                {/* Botón cambiar plan */}
                                <button onClick={()=>openPlanChange(t)} title="Cambiar plan"
                                  style={{ display:"flex", alignItems:"center", gap:3, padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-border)", background:"var(--sa-s0)", color:"var(--sa-text3)" }}>
                                  {Ico.upgrade}
                                </button>
                              </div>
                            </td>
                            <td style={{ padding:"12px 18px" }}>
                              {t.is_active
                                ? <span style={badge("var(--sa-sage)","var(--sa-sage-d)","var(--sa-sage-m)")}>● Activo</span>
                                : t.status==="FAILED"
                                  ? <span style={badge("var(--sa-red)","var(--sa-red-d)","var(--sa-red-m)")}>● Fallido</span>
                                  : <span style={badge("var(--sa-red)","var(--sa-red-d)","var(--sa-red-m)")}>● {t.status==="SUSPENDED"?"Suspendido":"Inactivo"}</span>
                              }
                              {tLeft!==null && <div style={{ fontSize:11, color:tLeft<5?"var(--sa-red)":"var(--sa-amber)", fontWeight:600, marginTop:2 }}>{tLeft}d trial</div>}
                            </td>
                            <td style={{ padding:"12px 18px", fontFamily:"var(--sa-f-mono)", fontSize:13, fontWeight:600 }}>
                              {PLAN_PRICES[t.plan as Plan]?`$${PLAN_PRICES[t.plan as Plan]}`:"–"}
                            </td>
                            <td style={{ padding:"12px 18px", fontSize:12, color:"var(--sa-text3)" }}>
                              {t.created_at?new Date(t.created_at).toLocaleDateString("es-CR",{day:"2-digit",month:"short",year:"2-digit"}):"–"}
                            </td>
                            <td style={{ padding:"12px 18px" }}>
                              <div className="sa-row-actions" style={{ display:"flex", gap:5 }}>
                                <button style={{ padding:"4px 9px", borderRadius:"var(--sa-r-xs)", fontSize:11, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-border)", background:"var(--sa-s0)", color:"var(--sa-text2)" }} onClick={()=>openDetail(t.id)}>Ver</button>
                                {(t.status==="FAILED"||t.status==="ACTIVE") &&
                                  <button style={{ padding:"4px 9px", borderRadius:"var(--sa-r-xs)", fontSize:11, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-amber)", background:"var(--sa-s0)", color:"var(--sa-amber)" }} onClick={()=>openReprovision(t)}>🔄 Re-provisionar</button>
                                }
                                {t.status!=="FAILED" && (t.is_active
                                  ? <button style={{ padding:"4px 9px", borderRadius:"var(--sa-r-xs)", fontSize:11, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-red-m)", background:"var(--sa-s0)", color:"var(--sa-red)" }} onClick={()=>doSuspend(t)}>Suspender</button>
                                  : <button style={{ padding:"4px 9px", borderRadius:"var(--sa-r-xs)", fontSize:11, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-sage-m)", background:"var(--sa-s0)", color:"var(--sa-sage)" }} onClick={()=>doReactivate(t)}>Reactivar</button>
                                )}
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
          </>}

          {/* ════ METRICS ════ */}
          {section==="metrics" && metrics && <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))", gap:14, marginBottom:22 }}>
              {([["Activos","active_tenants","var(--sa-sage)"],["En trial","trial_tenants","var(--sa-amber)"],["Básico","basic_tenants","var(--sa-acc)"],["Pro","pro_tenants","var(--sa-sage)"],["Empresarial","enterprise_tenants","var(--sa-coral)"],["Suspendidos","suspended_tenants","var(--sa-red)"]] as const).map(([l,k,c])=>(
                <div key={k} style={S.card}>
                  <div style={{ fontSize:10, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" as const, color:"var(--sa-text3)", marginBottom:8 }}>{l}</div>
                  <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:800, fontSize:30, color:c, lineHeight:1 }}>{(metrics as any)[k]??0}</div>
                </div>
              ))}
            </div>
            <div style={{ ...S.tableWrap, padding:24, maxWidth:460 }}>
              <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:15, marginBottom:16 }}>Distribución de planes</div>
              {PLANS.map(k=>{
                const count = parseInt((metrics as any)[(k.toLowerCase()==="enterprise"?"enterprise":k.toLowerCase())+"_tenants"]||"0");
                const total = Math.max(parseInt(metrics.active_tenants||"1"),1);
                return (
                  <div key={k} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                      <span style={{ fontWeight:600 }}>{PLAN_LABELS[k]}</span>
                      <span style={{ color:"var(--sa-text3)" }}>{count} tenant{count!==1?"s":""}</span>
                    </div>
                    <div style={{ background:"var(--sa-s2)", borderRadius:4, height:8, overflow:"hidden" }}>
                      <div style={{ height:"100%", background:PLAN_COLORS[k], borderRadius:4, width:`${Math.round((count/total)*100)}%`, transition:"width 0.5s" }}/>
                    </div>
                  </div>
                );
              })}
              <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid var(--sa-border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:13, fontWeight:600, color:"var(--sa-text2)" }}>MRR estimado</span>
                <span style={{ fontFamily:"var(--sa-f-mono)", fontWeight:700, fontSize:18 }}>${mrr.toLocaleString()}/mes</span>
              </div>
            </div>
          </>}

          {/* ════ VERSIONES DE SCHEMA ════ */}
          {section==="migrations" && (
            <div style={{ maxWidth:900 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
                <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:16 }}>Versiones de Schema</div>
                <button onClick={loadMigrationStatus} style={{ ...S.btnSec, padding:"5px 12px", fontSize:12 }}>
                  {migrationLoading?"Cargando...":"Actualizar"}
                </button>
              </div>
              {migrationStatus.length===0 && !migrationLoading && (
                <div style={{ ...S.card, textAlign:"center", color:"var(--sa-text3)", padding:40 }}>
                  Haz clic en "Actualizar" para cargar el estado de migraciones
                </div>
              )}
              {migrationStatus.length>0 && (
                <div style={S.tableWrap}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"var(--sa-s1)" }}>
                        {["Tenant","Plan","Schema","Aplicadas","Pendientes","Última migración","Estado","Acciones"].map((h,i)=>(
                          <th key={i} style={{ textAlign:"left", padding:"9px 14px", fontSize:10, fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" as const, color:"var(--sa-text3)", borderBottom:"1px solid var(--sa-border)", whiteSpace:"nowrap" as const }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {migrationStatus.map((s:any)=>(
                        <tr key={s.schemaName} className="sa-tr" style={{ borderBottom:"1px solid var(--sa-border)" }}>
                          <td style={{ padding:"10px 14px", fontSize:13, fontWeight:500 }}>{s.slug||"–"}</td>
                          <td style={{ padding:"10px 14px" }}>
                            <span style={badge(PLAN_COLORS[s.plan as Plan]||"#888",(PLAN_COLORS[s.plan as Plan]||"#888")+"18",(PLAN_COLORS[s.plan as Plan]||"#888")+"50")}>{PLAN_LABELS[s.plan as Plan]||s.plan}</span>
                          </td>
                          <td style={{ padding:"10px 14px", fontFamily:"var(--sa-f-mono)", fontSize:11 }}>{s.schemaName}</td>
                          <td style={{ padding:"10px 14px", fontFamily:"var(--sa-f-mono)", fontSize:13, fontWeight:600 }}>{s.appliedCount}</td>
                          <td style={{ padding:"10px 14px", fontFamily:"var(--sa-f-mono)", fontSize:13, fontWeight:600, color:s.pendingCount>0?"var(--sa-amber)":"var(--sa-text3)" }}>{s.pendingCount}</td>
                          <td style={{ padding:"10px 14px", fontSize:12, color:"var(--sa-text3)" }}>
                            {s.lastAppliedAt ? new Date(s.lastAppliedAt).toLocaleDateString("es-CR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "–"}
                          </td>
                          <td style={{ padding:"10px 14px" }}>
                            {s.pendingCount===0
                              ? <span style={badge("var(--sa-sage)","var(--sa-sage-d)","var(--sa-sage-m)")}>Al día</span>
                              : <span style={badge("var(--sa-amber)","var(--sa-amber)"+"18","var(--sa-amber)"+"50")}>Pendiente</span>
                            }
                          </td>
                          <td style={{ padding:"10px 14px" }}>
                            {s.pendingCount>0 && (
                              <button
                                data-testid={`button-mark-applied-${s.schemaName}`}
                                onClick={()=>markAsApplied(s.schemaName)}
                                disabled={markingSchema===s.schemaName}
                                style={{ padding:"5px 12px", fontSize:11, fontWeight:600, fontFamily:"var(--sa-f-disp)", background:"var(--sa-acc)", color:"white", border:"none", borderRadius:"var(--sa-r-xs)", cursor:"pointer", opacity:markingSchema===s.schemaName?0.6:1, whiteSpace:"nowrap" as const }}
                              >
                                {markingSchema===s.schemaName?"Marcando...":"Marcar como aplicadas"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ════ SETUP ════ */}
          {section==="setup" && (
            <div style={{ ...S.tableWrap, padding:28, maxWidth:520 }}>
              <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:16, marginBottom:10 }}>Inicialización multi-tenant</div>
              <p style={{ fontSize:13, color:"var(--sa-text2)", marginBottom:20, lineHeight:1.7 }}>
                Crea las tablas globales (<code style={{ fontFamily:"var(--sa-f-mono)", fontSize:12, background:"var(--sa-s1)", padding:"1px 5px", borderRadius:3 }}>tenants</code>, <code style={{ fontFamily:"var(--sa-f-mono)", fontSize:12, background:"var(--sa-s1)", padding:"1px 5px", borderRadius:3 }}>tenant_modules</code>) en la base de datos. Operación idempotente — se puede ejecutar múltiples veces sin riesgo.
              </p>
              <button onClick={runSetup} disabled={setupLoading} style={{ ...S.btnPrimary, opacity:setupLoading?0.7:1 }}>
                {setupLoading?"Inicializando...":"Inicializar tablas multi-tenant"}
              </button>
              {setupResult==="ok"  && <div style={{ marginTop:14, padding:"10px 14px", background:"var(--sa-sage-d)", border:"1px solid var(--sa-sage-m)", borderRadius:"var(--sa-r-sm)", fontSize:13, color:"var(--sa-sage)" }}>✓ Tablas listas.</div>}
              {setupResult==="err" && <div style={{ marginTop:14, padding:"10px 14px", background:"var(--sa-red-d)", border:"1px solid var(--sa-red-m)", borderRadius:"var(--sa-r-sm)", fontSize:13, color:"var(--sa-red)" }}>✗ {setupErr}</div>}
            </div>
          )}

        </div>
      </div>

      {/* ════════════════ MODAL: CREAR TENANT ════════════════ */}
      {createOpen && (
        <div className="sa-overlay" style={S.overlay} onClick={e=>{if(e.target===e.currentTarget)setCreateOpen(false)}}>
          <div className="sa-modal" style={S.modal}>
            <div style={S.modalHdr}>
              <div>
                <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:20 }}>Nuevo Tenant</div>
                <div style={{ fontSize:13, color:"var(--sa-text3)", marginTop:3 }}>Provisionamiento automático</div>
              </div>
              <button style={S.closeBtn} onClick={()=>setCreateOpen(false)}>{Ico.close}</button>
            </div>
            <div style={{ padding:"20px 26px" }}>
              {/* Plan selector */}
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" as const, color:"var(--sa-text3)", paddingBottom:10, borderBottom:"1px solid var(--sa-border)", marginBottom:14 }}>Plan</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, marginBottom:20 }}>
                {PLANS.map(k=>(
                  <div key={k} className={`sa-plan-opt${form.plan===k?" active":""}`} onClick={()=>setForm(f=>({...f,plan:k}))}
                    style={{ border:`2px solid ${form.plan===k?"var(--sa-acc)":"var(--sa-border)"}`, borderRadius:"var(--sa-r-md)", padding:"10px 8px", textAlign:"center" as const, background:form.plan===k?"var(--sa-acc-d)":"transparent" }}>
                    <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:13, color:form.plan===k?"var(--sa-acc)":"var(--sa-text)" }}>{PLAN_LABELS[k]}</div>
                    <div style={{ fontFamily:"var(--sa-f-mono)", fontSize:10, color:"var(--sa-text3)", marginTop:2 }}>${PLAN_PRICES[k]}/mes</div>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={S.lbl}>Nombre del restaurante *</label>
                <input value={form.businessName} onChange={e=>onBizName(e.target.value)} placeholder="Restaurante La Palma" style={S.input}/>
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={S.lbl}>Slug *</label>
                <div style={{ display:"flex", background:"var(--sa-s1)", border:"1px solid var(--sa-border)", borderRadius:"var(--sa-r-sm)", overflow:"hidden" }}>
                  <span style={{ padding:"9px 11px", fontFamily:"var(--sa-f-mono)", fontSize:12, color:"var(--sa-text3)", background:"var(--sa-s2)", borderRight:"1px solid var(--sa-border)", whiteSpace:"nowrap" as const }}>rest-</span>
                  <input value={form.slug} onChange={e=>setForm(f=>({...f,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"")}))} placeholder="lapalma" style={{ flex:1, padding:"9px 11px", background:"none", border:"none", outline:"none", fontFamily:"var(--sa-f-mono)", fontSize:13, color:"var(--sa-text)" }}/>
                </div>
                <div style={{ fontSize:11, color:"var(--sa-text3)", marginTop:3 }}>→ <strong>rest-{form.slug||"[slug]"}.rmscore.app</strong></div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                <div><label style={S.lbl}>Email facturación *</label><input value={form.billingEmail} onChange={e=>setForm(f=>({...f,billingEmail:e.target.value}))} placeholder="admin@rest.com" type="email" style={S.input}/></div>
                <div><label style={S.lbl}>Nombre del admin</label><input value={form.adminDisplayName} onChange={e=>setForm(f=>({...f,adminDisplayName:e.target.value}))} placeholder="Gerente" style={S.input}/></div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                <div><label style={S.lbl}>Email del admin *</label><input value={form.adminEmail} onChange={e=>setForm(f=>({...f,adminEmail:e.target.value}))} placeholder="gerente@rest.com" type="email" style={S.input}/></div>
                <div><label style={S.lbl}>Password temporal</label>
                  <div style={{ position:"relative" }}>
                    <input value={form.adminPassword} onChange={e=>setForm(f=>({...f,adminPassword:e.target.value}))} placeholder="TempPass123! si vacío" type={pwVisible?"text":"password"} style={S.input}/>
                    <button type="button" onClick={()=>setPwVisible(v=>!v)} style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--sa-text3)", padding:4 }}>{pwVisible?Ico.eyeOff:Ico.eye}</button>
                  </div>
                </div>
              </div>
              {form.plan==="TRIAL" && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" as const, color:"var(--sa-text3)", paddingBottom:8, borderBottom:"1px solid var(--sa-border)", marginBottom:10 }}>Plan base del trial</div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
                    {(["BASIC","PRO","ENTERPRISE"] as Plan[]).map(k=>(
                      <div key={k} className={`sa-plan-opt${form.trialBasePlan===k?" active":""}`} onClick={()=>setForm(f=>({...f,trialBasePlan:k}))}
                        style={{ border:`2px solid ${form.trialBasePlan===k?"var(--sa-acc)":"var(--sa-border)"}`, borderRadius:"var(--sa-r-md)", padding:"8px", textAlign:"center" as const, background:form.trialBasePlan===k?"var(--sa-acc-d)":"transparent" }}>
                        <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:12, color:form.trialBasePlan===k?"var(--sa-acc)":"var(--sa-text)" }}>{PLAN_LABELS[k]}</div>
                        <div style={{ fontFamily:"var(--sa-f-mono)", fontSize:9, color:"var(--sa-text3)", marginTop:2 }}>{PLAN_MODULES[k].length} módulos</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" as const, color:"var(--sa-text3)", paddingBottom:8, borderBottom:"1px solid var(--sa-border)", marginBottom:12 }}>Consecutivos iniciales</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
                <div><label style={S.lbl}>Orden diario</label><input value={form.orderDailyStart} onChange={e=>setForm(f=>({...f,orderDailyStart:e.target.value}))} type="number" min="1" style={S.input}/></div>
                <div><label style={S.lbl}>Orden global</label><input value={form.orderGlobalStart} onChange={e=>setForm(f=>({...f,orderGlobalStart:e.target.value}))} type="number" min="1" style={S.input}/></div>
                <div><label style={S.lbl}>Factura</label><input value={form.invoiceStart} onChange={e=>setForm(f=>({...f,invoiceStart:e.target.value}))} type="number" min="1" style={S.input}/></div>
              </div>
              {createError && <div style={{ marginTop:14, padding:"10px 13px", background:"var(--sa-red-d)", border:"1px solid var(--sa-red-m)", borderRadius:"var(--sa-r-sm)", fontSize:13, color:"var(--sa-red)" }}>{createError}</div>}
            </div>
            <div style={{ padding:"14px 26px 22px", borderTop:"1px solid var(--sa-border)", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button style={S.btnSec} onClick={()=>setCreateOpen(false)}>Cancelar</button>
              <button onClick={submitCreate} disabled={createLoading} style={{ ...S.btnPrimary, opacity:createLoading?0.7:1 }}>
                {createLoading?"Provisionando...":"Crear y Provisionar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ MODAL: CREDENCIALES ════════════════ */}
      {credDialog && (
        <div className="sa-overlay" style={{ ...S.overlay, zIndex:300 }} onClick={e=>{if(e.target===e.currentTarget)setCredDialog(null)}}>
          <div className="sa-modal" style={{ ...S.modal, maxWidth:460 }}>
            <div style={S.modalHdr}>
              <div>
                <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:20 }}>Tenant creado</div>
                <div style={{ fontSize:13, color:"var(--sa-text3)", marginTop:3 }}>{credDialog.businessName}</div>
              </div>
              <button style={S.closeBtn} onClick={()=>setCredDialog(null)}>{Ico.close}</button>
            </div>
            <div style={{ padding:"20px 26px" }}>
              <div style={{ background:"#fffbeb", border:"1px solid #f5e6b8", borderRadius:"var(--sa-r-sm)", padding:"10px 14px", marginBottom:16, fontSize:12, color:"#92400e" }}>
                ⚠️ Guarda esta información. No se mostrará nuevamente.
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <tbody>
                  {[
                    ["URL de acceso", `https://${credDialog.slug}.rmscore.app`],
                    ["Usuario", credDialog.username],
                    ["Contraseña", credDialog.password],
                    ["PIN", credDialog.pin],
                  ].map(([label, value]) => (
                    <tr key={label}>
                      <td style={{ padding:"8px 12px", fontSize:12, color:"var(--sa-text3)", borderBottom:"1px solid var(--sa-border)", whiteSpace:"nowrap" as const }}>{label}</td>
                      <td style={{ padding:"8px 12px", fontSize:14, fontWeight:600, fontFamily:"var(--sa-f-mono)", color:"var(--sa-text)", borderBottom:"1px solid var(--sa-border)" }}>{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding:"14px 26px 22px", borderTop:"1px solid var(--sa-border)", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button style={S.btnSec} onClick={()=>setCredDialog(null)}>Cerrar</button>
              <button style={S.btnPrimary} onClick={()=>{
                const t = `${credDialog.businessName}\nURL: https://${credDialog.slug}.rmscore.app\nUsuario: ${credDialog.username}\nContraseña: ${credDialog.password}\nPIN: ${credDialog.pin}`;
                navigator.clipboard.writeText(t).then(()=>toast("success","Copiado","Credenciales copiadas al portapapeles")).catch(()=>toast("error","Error","No se pudo copiar"));
              }}>Copiar credenciales</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ MODAL: CAMBIAR PLAN ════════════════ */}
      {planOpen && planTenant && (
        <div className="sa-overlay" style={{ ...S.overlay, zIndex:250 }} onClick={e=>{if(e.target===e.currentTarget)setPlanOpen(false)}}>
          <div className="sa-modal" style={{ ...S.modal, maxWidth:500 }}>
            <div style={S.modalHdr}>
              <div>
                <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:20 }}>Cambiar Plan</div>
                <div style={{ fontSize:13, color:"var(--sa-text3)", marginTop:3 }}>{planTenant.business_name}</div>
              </div>
              <button style={S.closeBtn} onClick={()=>setPlanOpen(false)}>{Ico.close}</button>
            </div>
            <div style={{ padding:"20px 26px" }}>

              {/* Plan actual */}
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:"var(--sa-s1)", borderRadius:"var(--sa-r-sm)", marginBottom:18, fontSize:13 }}>
                <span style={{ color:"var(--sa-text3)" }}>Plan actual:</span>
                <span style={{ fontWeight:700, color:PLAN_COLORS[planTenant.plan as Plan]||"var(--sa-text)" }}>{PLAN_LABELS[planTenant.plan as Plan]||planTenant.plan}</span>
                <span style={{ fontFamily:"var(--sa-f-mono)", fontSize:11, color:"var(--sa-text3)", marginLeft:"auto" }}>${PLAN_PRICES[planTenant.plan as Plan]||0}/mes</span>
              </div>

              {/* Selector de plan nuevo */}
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" as const, color:"var(--sa-text3)", marginBottom:12 }}>Selecciona el nuevo plan</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:10, marginBottom:20 }}>
                {PLANS.filter(p=>p!=="TRIAL").map(k=>{
                  const isSelected = planSelected===k;
                  const isCurrent  = planTenant.plan===k;
                  const pc = PLAN_COLORS[k];
                  return (
                    <div key={k} onClick={()=>setPlanSelected(k)}
                      style={{ border:`2px solid ${isSelected?pc:"var(--sa-border)"}`, borderRadius:"var(--sa-r-md)", padding:"14px 16px", cursor:"pointer", background:isSelected?pc+"10":"transparent", position:"relative" as const, transition:"all 0.14s" }}>
                      {isCurrent && (
                        <div style={{ position:"absolute", top:8, right:8, fontSize:9, fontWeight:700, color:pc, background:pc+"20", padding:"1px 6px", borderRadius:10, letterSpacing:"0.04em" }}>ACTUAL</div>
                      )}
                      <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:16, color:isSelected?pc:"var(--sa-text)", marginBottom:4 }}>{PLAN_LABELS[k]}</div>
                      <div style={{ fontFamily:"var(--sa-f-mono)", fontSize:13, color:"var(--sa-text3)", marginBottom:10 }}>${PLAN_PRICES[k]}/mes</div>
                      {/* Módulos incluidos */}
                      <div style={{ display:"flex", flexDirection:"column" as const, gap:3 }}>
                        {PLAN_MODULES[k].map(m=>(
                          <div key={m} style={{ fontSize:11, color:"var(--sa-text2)", display:"flex", alignItems:"center", gap:5 }}>
                            <span style={{ color:"var(--sa-sage)", fontSize:10 }}>✓</span>
                            {MODULE_LABELS[m]||m}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Aviso de cambio */}
              {planSelected !== planTenant.plan && (
                <div style={{ padding:"10px 14px", background:"var(--sa-amber)"+"15", border:"1px solid var(--sa-amber)"+"40", borderRadius:"var(--sa-r-sm)", fontSize:12, color:"var(--sa-text2)", marginBottom:4 }}>
                  Los módulos del tenant se actualizarán automáticamente al confirmar.
                  {PLAN_MODULES[planSelected].length < PLAN_MODULES[planTenant.plan as Plan||"TRIAL"].length && (
                    <span style={{ color:"var(--sa-red)", fontWeight:600 }}> Módulos que no están en el nuevo plan quedarán desactivados.</span>
                  )}
                </div>
              )}
            </div>
            <div style={{ padding:"14px 26px 22px", borderTop:"1px solid var(--sa-border)", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button style={S.btnSec} onClick={()=>setPlanOpen(false)}>Cancelar</button>
              <button onClick={submitPlanChange} disabled={planLoading||planSelected===planTenant.plan}
                style={{ ...S.btnPrimary, opacity:(planLoading||planSelected===planTenant.plan)?0.5:1 }}>
                {planLoading?"Actualizando...":planSelected===planTenant.plan?"Sin cambios":"Confirmar cambio"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ MODAL: DETALLE ════════════════ */}
      {detailOpen && (
        <div className="sa-overlay" style={{ ...S.overlay, zIndex:210 }} onClick={e=>{if(e.target===e.currentTarget)setDetailOpen(false)}}>
          <div className="sa-modal" style={{ ...S.modal, maxWidth:620 }}>
            <div style={S.modalHdr}>
              <div>
                <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:20 }}>{detailData?.tenant.business_name??"Cargando..."}</div>
                {detailData && <div style={{ fontSize:13, color:"var(--sa-text3)", marginTop:2 }}>{detailData.tenant.slug} · {PLAN_LABELS[detailData.tenant.plan as Plan]||detailData.tenant.plan} · {detailData.tenant.is_active?"Activo":detailData.tenant.status}</div>}
              </div>
              <button style={S.closeBtn} onClick={()=>setDetailOpen(false)}>{Ico.close}</button>
            </div>
            {!detailData ? (
              <div style={{ padding:40, textAlign:"center", color:"var(--sa-text3)" }}>Cargando...</div>
            ) : (
              <div style={{ padding:"22px 26px" }}>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20, marginBottom:20 }}>
                  <div>
                    {([
                      ["Schema",   detailData.tenant.schema_name,  true ],
                      ["Plan",     PLAN_LABELS[detailData.tenant.plan as Plan]||detailData.tenant.plan, false],
                      ["Estado",   detailData.tenant.status,       false],
                      ["Billing",  detailData.tenant.billing_email||"–", false],
                      ["Trial",    detailData.tenant.trial_ends_at?new Date(detailData.tenant.trial_ends_at).toLocaleDateString("es-CR"):"–", false],
                      ...(detailData.tenant.plan==="TRIAL"&&(detailData.tenant as any).trial_base_plan?[["Plan base",(PLAN_LABELS as any)[(detailData.tenant as any).trial_base_plan]||(detailData.tenant as any).trial_base_plan,false]]:[] as any),
                      ["Creado",   new Date(detailData.tenant.created_at).toLocaleDateString("es-CR"), false],
                      ...(detailData.tenant.suspend_reason?[["Razón",detailData.tenant.suspend_reason,false]]:[] as any),
                    ] as [string,string,boolean][]).map(([k,v,mono])=>(
                      <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"7px 0", borderBottom:"1px solid var(--sa-border)", fontSize:13 }}>
                        <span style={{ color:"var(--sa-text3)" }}>{k}</span>
                        <span style={{ fontWeight:500, fontFamily:mono?"var(--sa-f-mono)":"inherit", fontSize:mono?11:13 }}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:14, marginBottom:10 }}>Módulos activos</div>
                    <div style={{ display:"flex", flexWrap:"wrap" as const, gap:6, marginBottom:16 }}>
                      {detailData.modules.filter(m=>m.is_active).map(m=>(
                        <span key={m.module_key} style={{ padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:600, background:"var(--sa-sage-d)", color:"var(--sa-sage)", border:"1px solid var(--sa-sage-m)" }}>
                          {MODULE_LABELS[m.module_key]||m.module_key}
                        </span>
                      ))}
                      {detailData.modules.filter(m=>m.is_active).length===0 && <span style={{ fontSize:12, color:"var(--sa-text3)" }}>Ninguno</span>}
                    </div>
                    {detailData.logs.length>0 && <>
                      <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:14, marginBottom:8 }}>Actividad</div>
                      {detailData.logs.slice(0,5).map((l,i)=>(
                        <div key={i} style={{ display:"flex", gap:8, fontSize:11, padding:"6px 10px", background:"var(--sa-s1)", borderRadius:"var(--sa-r-xs)", marginBottom:4 }}>
                          <span style={{ fontFamily:"var(--sa-f-mono)", background:"var(--sa-s2)", padding:"1px 5px", borderRadius:3, fontSize:10, color:"var(--sa-text3)" }}>{l.action}</span>
                          <span style={{ color:l.status==="COMPLETED"?"var(--sa-sage)":"var(--sa-red)" }}>{l.status}</span>
                          <span style={{ marginLeft:"auto", color:"var(--sa-text3)" }}>{new Date(l.created_at).toLocaleDateString("es-CR")}</span>
                        </div>
                      ))}
                    </>}
                  </div>
                </div>
                <div style={{ paddingTop:16, borderTop:"1px solid var(--sa-border)", marginBottom:16 }}>
                  <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:14, marginBottom:10 }}>Restablecer contraseña del admin</div>
                  <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
                    <div style={{ flex:1 }}>
                      <label style={S.lbl}>Email de destino</label>
                      <input
                        value={resetEmail}
                        onChange={e=>setResetEmail(e.target.value)}
                        placeholder="admin@restaurante.com"
                        type="email"
                        style={S.input}
                        data-testid="input-reset-email"
                      />
                    </div>
                    <button
                      onClick={submitPasswordReset}
                      disabled={resetLoading}
                      data-testid="button-send-password-reset"
                      style={{ padding:"9px 16px", borderRadius:"var(--sa-r-sm)", fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-acc)", background:"var(--sa-acc-d)", color:"var(--sa-acc)", whiteSpace:"nowrap" as const, opacity:resetLoading?0.7:1 }}>
                      {resetLoading?"Enviando...":"Enviar correo de restablecimiento"}
                    </button>
                  </div>
                  {resetResult==="ok" && <div style={{ marginTop:8, padding:"8px 12px", background:"var(--sa-sage-d)", border:"1px solid var(--sa-sage-m)", borderRadius:"var(--sa-r-sm)", fontSize:12, color:"var(--sa-sage)" }}>Correo de restablecimiento enviado exitosamente.</div>}
                  {resetResult==="err" && <div style={{ marginTop:8, padding:"8px 12px", background:"var(--sa-red-d)", border:"1px solid var(--sa-red-m)", borderRadius:"var(--sa-r-sm)", fontSize:12, color:"var(--sa-red)" }}>{resetErr}</div>}
                </div>

                <div style={{ paddingTop:16, borderTop:"1px solid var(--sa-border)", display:"flex", gap:8 }}>
                  <button onClick={()=>{ setDetailOpen(false); openPlanChange(detailData.tenant); }}
                    style={{ display:"flex", alignItems:"center", gap:5, padding:"7px 13px", borderRadius:"var(--sa-r-sm)", fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-border)", background:"var(--sa-s0)", color:"var(--sa-text2)" }}>
                    {Ico.upgrade} Cambiar plan
                  </button>
                  {(detailData.tenant.status==="FAILED"||detailData.tenant.status==="ACTIVE") &&
                    <button style={{ padding:"7px 13px", borderRadius:"var(--sa-r-sm)", fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-amber)", background:"var(--sa-s0)", color:"var(--sa-amber)" }} onClick={()=>{setDetailOpen(false);openReprovision(detailData.tenant);}}>🔄 Re-provisionar</button>
                  }
                  {detailData.tenant.status!=="FAILED" && (detailData.tenant.is_active
                    ? <button style={{ padding:"7px 13px", borderRadius:"var(--sa-r-sm)", fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-red-m)", background:"var(--sa-s0)", color:"var(--sa-red)" }} onClick={()=>{setDetailOpen(false);doSuspend(detailData.tenant);}}>Suspender</button>
                    : <button style={{ padding:"7px 13px", borderRadius:"var(--sa-r-sm)", fontSize:12, fontWeight:600, cursor:"pointer", border:"1px solid var(--sa-sage-m)", background:"var(--sa-s0)", color:"var(--sa-sage)" }} onClick={()=>{setDetailOpen(false);doReactivate(detailData.tenant);}}>Reactivar</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ════════════════ MODAL: RE-PROVISIONAR ════════════════ */}
      {reprovOpen && reprovTenant && (
        <div className="sa-overlay" style={{ ...S.overlay, zIndex:260 }} onClick={e=>{if(e.target===e.currentTarget)setReprovOpen(false)}}>
          <div className="sa-modal" style={S.modal}>
            <div style={S.modalHdr}>
              <div>
                <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:20 }}>Re-provisionar Tenant</div>
                <div style={{ fontSize:13, color:"var(--sa-text3)", marginTop:3 }}>{reprovTenant.business_name} · {reprovTenant.slug}</div>
              </div>
              <button style={S.closeBtn} onClick={()=>setReprovOpen(false)}>{Ico.close}</button>
            </div>
            <div style={{ padding:"20px 26px" }}>
              <div style={{ padding:"10px 14px", background:"var(--sa-amber)"+"18", border:"1px solid var(--sa-amber)"+"40", borderRadius:"var(--sa-r-sm)", fontSize:12, color:"var(--sa-text2)", marginBottom:18, lineHeight:1.7 }}>
                Este proceso eliminará el schema existente y lo re-creará desde cero con las tablas actuales. Se perderán todos los datos del tenant.
              </div>
              <div style={{ marginBottom:14 }}>
                <label style={S.lbl}>Nombre del admin *</label>
                <input value={reprovForm.adminDisplayName} onChange={e=>setReprovForm(f=>({...f,adminDisplayName:e.target.value}))} placeholder="Gerente" style={S.input}/>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                <div><label style={S.lbl}>Email del admin *</label><input value={reprovForm.adminEmail} onChange={e=>setReprovForm(f=>({...f,adminEmail:e.target.value}))} placeholder="admin@rest.com" type="email" style={S.input}/></div>
                <div><label style={S.lbl}>Password *</label><input value={reprovForm.adminPassword} onChange={e=>setReprovForm(f=>({...f,adminPassword:e.target.value}))} placeholder="TempPass123!" type="password" style={S.input}/></div>
              </div>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase" as const, color:"var(--sa-text3)", paddingBottom:8, borderBottom:"1px solid var(--sa-border)", marginBottom:12 }}>Consecutivos iniciales</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
                <div><label style={S.lbl}>Orden diario</label><input value={reprovForm.orderDailyStart} onChange={e=>setReprovForm(f=>({...f,orderDailyStart:e.target.value}))} type="number" min="1" style={S.input}/></div>
                <div><label style={S.lbl}>Orden global</label><input value={reprovForm.orderGlobalStart} onChange={e=>setReprovForm(f=>({...f,orderGlobalStart:e.target.value}))} type="number" min="1" style={S.input}/></div>
                <div><label style={S.lbl}>Factura</label><input value={reprovForm.invoiceStart} onChange={e=>setReprovForm(f=>({...f,invoiceStart:e.target.value}))} type="number" min="1" style={S.input}/></div>
              </div>
              {reprovError && <div style={{ marginTop:14, padding:"10px 13px", background:"var(--sa-red-d)", border:"1px solid var(--sa-red-m)", borderRadius:"var(--sa-r-sm)", fontSize:13, color:"var(--sa-red)" }}>{reprovError}</div>}
            </div>
            <div style={{ padding:"14px 26px 22px", borderTop:"1px solid var(--sa-border)", display:"flex", justifyContent:"flex-end", gap:10 }}>
              <button style={S.btnSec} onClick={()=>setReprovOpen(false)}>Cancelar</button>
              <button onClick={submitReprovision} disabled={reprovLoading}
                style={{ padding:"9px 20px", background:"var(--sa-amber)", color:"white", border:"none", borderRadius:"var(--sa-r-sm)", fontFamily:"var(--sa-f-disp)", fontWeight:600, fontSize:14, cursor:"pointer", opacity:reprovLoading?0.7:1 }}>
                {reprovLoading?"Re-provisionando...":"🔄 Re-provisionar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ MODAL: CONFIRMAR ════════════════ */}
      {confirmOpen && confirmCfg && (
        <div className="sa-overlay" style={{ ...S.overlay, zIndex:300 }}>
          <div className="sa-modal" style={{ ...S.modal, maxWidth:400 }}>
            <div style={{ padding:"28px 26px 24px" }}>
              <div style={{ fontFamily:"var(--sa-f-disp)", fontWeight:700, fontSize:18, marginBottom:10 }}>{confirmCfg.title}</div>
              <div style={{ fontSize:14, color:"var(--sa-text2)", lineHeight:1.6, marginBottom:confirmCfg.needsReason?14:20 }}>{confirmCfg.message}</div>
              {confirmCfg.needsReason && (
                <div style={{ marginBottom:20 }}>
                  <label style={S.lbl}>Razón (requerida)</label>
                  <input value={confirmReason} onChange={e=>setConfirmReason(e.target.value)} placeholder="Ej: Pago vencido..." style={S.input}/>
                </div>
              )}
              <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
                <button style={S.btnSec} onClick={()=>setConfirmOpen(false)}>Cancelar</button>
                <button onClick={execConfirm} disabled={confirmLoading}
                  style={{ padding:"9px 18px", border:"none", borderRadius:"var(--sa-r-sm)", fontFamily:"var(--sa-f-disp)", fontWeight:600, fontSize:14, cursor:"pointer", color:"white", opacity:confirmLoading?0.7:1,
                    background:confirmCfg.variant==="danger"?"var(--sa-red)":confirmCfg.variant==="success"?"var(--sa-sage)":"var(--sa-acc)" }}>
                  {confirmLoading?"Procesando...":confirmCfg.label}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════ TOASTS ════════════════ */}
      <div style={{ position:"fixed", bottom:24, right:24, zIndex:999, display:"flex", flexDirection:"column", gap:8 }}>
        {toasts.map(t=>(
          <div key={t.id} className="sa-toast" style={{ background:"var(--sa-s0)", border:"1px solid var(--sa-border)", borderLeft:`3px solid ${t.type==="success"?"var(--sa-sage)":t.type==="error"?"var(--sa-red)":"var(--sa-acc)"}`, borderRadius:"var(--sa-r-md)", padding:"11px 15px", boxShadow:"0 4px 16px rgba(26,18,8,0.12)", minWidth:260, maxWidth:340 }}>
            <div style={{ fontWeight:600, fontSize:13 }}>{t.title}</div>
            {t.msg && <div style={{ fontSize:12, color:"var(--sa-text2)", marginTop:2 }}>{t.msg}</div>}
          </div>
        ))}
      </div>

    </div>
  );
}
