import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest, setSessionToken } from "@/lib/queryClient";
import { Loader2, Delete, ArrowLeft, Eye, EyeOff } from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_Grande_1772160879830.png";

const LS_KEY = "rms_last_username";

type Screen = "login" | "pin-pad" | "pin-return" | "forgot";

interface UserInfo {
  exists: boolean;
  hasPin: boolean;
  displayName: string;
}

export default function AuthPage() {
  const { login, pinLogin } = useAuth();
  const [screen, setScreen] = useState<Screen>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [pinError, setPinError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [checkingUser, setCheckingUser] = useState(true);
  const [currentTime, setCurrentTime] = useState("");
  const [currentDate, setCurrentDate] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("es-CR", { hour: "2-digit", minute: "2-digit", hour12: false }));
      setCurrentDate(now.toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" }));
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      lookupUser(saved);
    } else {
      setCheckingUser(false);
    }
  }, []);

  const lookupUser = async (u: string) => {
    setCheckingUser(true);
    try {
      const res = await fetch(`/api/auth/user-info?username=${encodeURIComponent(u)}`);
      const data: UserInfo = await res.json();
      if (data.exists && data.hasPin) {
        setUsername(u);
        setUserInfo(data);
        setScreen("pin-return");
      } else {
        localStorage.removeItem(LS_KEY);
        setScreen("login");
      }
    } catch {
      localStorage.removeItem(LS_KEY);
      setScreen("login");
    } finally {
      setCheckingUser(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    const p = password.trim();
    if (!u || !p) { setError("Ingresa usuario y contraseña"); return; }
    setError("");
    setLoading(true);
    try {
      if (window.location.hostname === "login.rmscore.app") {
        const email = u;
        const res = await fetch("/api/auth/central-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: p }),
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.message || "Error al iniciar sesión");
        }
        if (data.tenantUrl && typeof data.tenantUrl === "string") {
          if (data.sessionToken) {
            setSessionToken(data.sessionToken);
          }
          window.location.href = data.tenantUrl;
          return;
        }
        throw new Error(data.message || "Respuesta inválida del servidor");
      }

      await login(u, p);
      localStorage.setItem(LS_KEY, u);
    } catch (err: any) {
      setError(err.message || "Usuario o contraseña incorrectos");
    } finally {
      setLoading(false);
    }
  };

  const submitPin = async (p: string) => {
    setLoading(true);
    setPinError("");
    try {
      const result = await pinLogin(p);
      if (result.username) {
        localStorage.setItem(LS_KEY, result.username);
      }
    } catch (err: any) {
      setPinError(err.message || "PIN incorrecto");
      setPin("");
      setShakeKey(k => k + 1);
    } finally {
      setLoading(false);
    }
  };

  const handleDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setPinError("");
    if (newPin.length === 4) {
      setTimeout(() => submitPin(newPin), 50);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email: email.trim() });
    } catch {}
    setForgotSent(true);
    setLoading(false);
  };

  const switchUser = () => {
    localStorage.removeItem(LS_KEY);
    setUsername("");
    setPassword("");
    setUserInfo(null);
    setPin("");
    setError("");
    setPinError("");
    setScreen("login");
  };

  const goForgot = () => {
    setError("");
    setPinError("");
    setEmail("");
    setForgotSent(false);
    setScreen("forgot");
  };

  const goBackToLogin = () => {
    setPin("");
    setPinError("");
    setScreen("login");
  };

  if (checkingUser) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--text3)" }} />
      </div>
    );
  }

  const pinPadUI = (
    <>
      <div className="pin-dots" key={shakeKey} style={shakeKey > 0 ? { animation: "shake 0.3s ease-in-out" } : undefined}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`pin-dot ${i < pin.length ? "filled" : ""}`} />
        ))}
      </div>
      {pinError && <div className="auth-error">{pinError}</div>}
      <div className="pin-grid">
        {["1","2","3","4","5","6","7","8","9"].map(d => (
          <button key={d} className="pin-key" onClick={() => handleDigit(d)} disabled={loading} data-testid={`pin-key-${d}`}>{d}</button>
        ))}
        <button className="pin-key" onClick={() => { setPin(pin.slice(0, -1)); setPinError(""); }} disabled={loading} data-testid="pin-key-delete">
          <Delete size={20} />
        </button>
        <button className="pin-key" onClick={() => handleDigit("0")} disabled={loading} data-testid="pin-key-0">0</button>
        <button className="pin-key accent" onClick={() => pin.length === 4 && submitPin(pin)} disabled={loading || pin.length < 4} data-testid="pin-key-enter">
          {loading ? <Loader2 size={18} className="animate-spin" /> : "OK"}
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <style>{`
        .auth-card { width:100%; max-width:360px; }
        .auth-logo { width:96px; height:96px; border-radius:50%; object-fit:cover; margin:0 auto 16px; display:block; }
        .auth-time { text-align:center; font-family:var(--f-mono,monospace); font-size:28px; font-weight:700; color:var(--text); letter-spacing:0.04em; margin-bottom:2px; }
        .auth-date { text-align:center; font-size:13px; color:var(--text3); text-transform:capitalize; margin-bottom:20px; }
        .auth-greeting { text-align:center; font-size:16px; color:var(--text2); margin-bottom:16px; }
        .auth-greeting strong { color:var(--text); font-weight:700; }
        .auth-input { width:100%; padding:12px 14px; background:var(--s1); border:1px solid var(--border); border-radius:8px; font-size:15px; color:var(--text); outline:none; font-family:var(--f-body); margin-bottom:12px; }
        .auth-input:focus { border-color:hsl(var(--primary)); }
        .auth-input::placeholder { color:var(--text3); }
        .auth-btn { width:100%; padding:12px; border:none; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; font-family:var(--f-body); display:flex; align-items:center; justify-content:center; gap:8px; transition:opacity .15s; }
        .auth-btn:disabled { opacity:0.6; cursor:not-allowed; }
        .auth-btn-primary { background:hsl(var(--primary)); color:#fff; }
        .auth-btn-primary:hover:not(:disabled) { opacity:0.9; }
        .auth-btn-secondary { background:transparent; color:hsl(var(--primary)); border:1.5px solid hsl(var(--primary)); }
        .auth-btn-secondary:hover:not(:disabled) { background:var(--s1); }
        .auth-error { background:hsl(0 80% 95%); border:1px solid hsl(0 70% 85%); color:hsl(0 70% 40%); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:12px; text-align:center; }
        .auth-link { background:none; border:none; color:hsl(var(--primary)); font-size:13px; cursor:pointer; font-family:var(--f-body); padding:0; text-decoration:underline; }
        .auth-link:hover { opacity:0.8; }
        .auth-link-muted { color:var(--text3); text-decoration:none; }
        .auth-link-muted:hover { color:var(--text2); }
        .auth-links { display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:16px; }
        .auth-divider { display:flex; align-items:center; gap:12px; margin:16px 0; }
        .auth-divider-line { flex:1; height:1px; background:var(--border); }
        .auth-divider-text { font-size:12px; color:var(--text3); white-space:nowrap; }
        .pin-dots { display:flex; justify-content:center; gap:12px; margin-bottom:20px; }
        .pin-dot { width:14px; height:14px; border-radius:50%; border:2px solid var(--border); transition:all .15s; }
        .pin-dot.filled { background:hsl(var(--primary)); border-color:hsl(var(--primary)); }
        .pin-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; max-width:240px; margin:0 auto; }
        .pin-key { width:100%; aspect-ratio:1.2; border:1px solid var(--border); border-radius:12px; background:var(--s1); font-size:22px; font-weight:600; color:#1a1a1a; cursor:pointer; display:flex; align-items:center; justify-content:center; font-family:var(--f-body); transition:background .1s; user-select:none; -webkit-tap-highlight-color:transparent; }
        [data-theme="dark"] .pin-key { color:#ffffff; }
        .pin-key:active { background:var(--s2); }
        .pin-key.accent { background:hsl(var(--primary)); color:#fff; border-color:hsl(var(--primary)); }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
        .auth-success { background:hsl(140 60% 95%); border:1px solid hsl(140 50% 80%); color:hsl(140 50% 30%); border-radius:8px; padding:12px 14px; font-size:13px; text-align:center; margin-bottom:12px; }
        .pw-wrapper { position:relative; margin-bottom:12px; }
        .pw-toggle { position:absolute; right:10px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text3); cursor:pointer; padding:4px; }
      `}</style>

      <div className="auth-card">
        <img src={logoImg} alt="Logo" className="auth-logo" data-testid="img-auth-logo" />
        <div className="auth-time">{currentTime}</div>
        <div className="auth-date">{currentDate}</div>

        {screen === "login" && (
          <div>
            <form onSubmit={handleLoginSubmit}>
              <input
                className="auth-input"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(""); }}
                placeholder="Usuario o correo"
                autoFocus
                autoComplete="username"
                data-testid="input-username"
              />
              <div className="pw-wrapper">
                <input
                  className="auth-input"
                  style={{ marginBottom: 0 }}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="Contraseña"
                  autoComplete="current-password"
                  data-testid="input-password"
                />
                <button type="button" className="pw-toggle" onClick={() => setShowPassword(v => !v)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {error && <div className="auth-error" style={{ marginTop: 8 }}>{error}</div>}
              <button type="submit" className="auth-btn auth-btn-primary" disabled={loading} style={{ marginTop: 12 }} data-testid="button-login">
                {loading ? <Loader2 size={18} className="animate-spin" /> : "Ingresar"}
              </button>
            </form>

            <button
              type="button"
              className="auth-btn auth-btn-secondary"
              style={{ marginTop: 10 }}
              onClick={() => { setPin(""); setPinError(""); setScreen("pin-pad"); }}
              data-testid="button-open-pin"
            >
              Ingresar con PIN
            </button>

            <div className="auth-links">
              <button type="button" className="auth-link auth-link-muted" onClick={goForgot} data-testid="link-forgot">
                ¿Olvidé mi contraseña?
              </button>
            </div>
          </div>
        )}

        {screen === "pin-pad" && (
          <div>
            <p style={{ textAlign: "center", fontSize: 14, color: "var(--text2)", marginBottom: 16 }}>
              Ingresá tu PIN de 4 dígitos
            </p>
            {pinPadUI}
            <div className="auth-links">
              <button className="auth-link auth-link-muted" onClick={goBackToLogin} data-testid="link-back-login" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <ArrowLeft size={14} /> Volver
              </button>
            </div>
          </div>
        )}

        {screen === "pin-return" && userInfo && (
          <div>
            <div className="auth-greeting">Hola, <strong>{userInfo.displayName}</strong></div>
            {pinPadUI}
            <div className="auth-links">
              <button className="auth-link auth-link-muted" onClick={goForgot} data-testid="link-forgot-pin">
                ¿Olvidé mi contraseña?
              </button>
              <button className="auth-link auth-link-muted" onClick={switchUser} data-testid="link-switch-user">
                Cambiar usuario
              </button>
            </div>
          </div>
        )}

        {screen === "forgot" && (
          <div>
            <button className="auth-link auth-link-muted" onClick={goBackToLogin} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 16 }} data-testid="link-back-from-forgot">
              <ArrowLeft size={14} /> Volver al inicio de sesión
            </button>
            {forgotSent ? (
              <div className="auth-success">
                Si ese correo está registrado, recibirás instrucciones en unos minutos.
              </div>
            ) : (
              <form onSubmit={handleForgot}>
                <p style={{ fontSize: 14, color: "var(--text2)", marginBottom: 12, textAlign: "center" }}>
                  Ingresá tu correo electrónico y te enviaremos instrucciones para recuperar tu acceso.
                </p>
                <input
                  className="auth-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  autoFocus
                  data-testid="input-email-forgot"
                />
                <button type="submit" className="auth-btn auth-btn-primary" disabled={loading} style={{ marginTop: 0 }} data-testid="button-send-reset">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : "Enviar instrucciones"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
