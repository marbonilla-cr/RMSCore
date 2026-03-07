import { useState } from "react";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Eye, EyeOff, CheckCircle } from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_Grande_1772160879830.png";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) { setError("La contraseña debe tener al menos 6 caracteres"); return; }
    if (password !== confirm) { setError("Las contraseñas no coinciden"); return; }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token, newPassword: password });
      setSuccess(true);
      setTimeout(() => setLocation("/"), 3000);
    } catch (err: any) {
      const msg = err?.message || "Error al restablecer";
      setError(msg.includes("Token") ? msg : "Token inválido o expirado");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <img src={logoImg} alt="Logo" style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", margin: "0 auto 16px" }} />
          <p style={{ color: "var(--text2)", fontSize: 14 }}>Enlace inválido. Solicita un nuevo enlace de recuperación.</p>
          <a href="/" style={{ color: "var(--accent)", fontSize: 13, marginTop: 12, display: "inline-block" }}>Volver al inicio</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <style>{`
        .reset-card { width:100%; max-width:360px; }
        .reset-input { width:100%; padding:12px 14px; background:var(--s1); border:1px solid var(--border); border-radius:8px; font-size:15px; color:var(--text); outline:none; font-family:var(--f-body); }
        .reset-input:focus { border-color:var(--accent); }
        .reset-input::placeholder { color:var(--text3); }
        .reset-btn { width:100%; padding:12px; border:none; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; background:var(--accent); color:#fff; font-family:var(--f-body); display:flex; align-items:center; justify-content:center; gap:8px; }
        .reset-btn:disabled { opacity:0.6; cursor:not-allowed; }
        .reset-error { background:hsl(0 80% 95%); border:1px solid hsl(0 70% 85%); color:hsl(0 70% 40%); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:12px; text-align:center; }
        .reset-success { background:hsl(140 60% 95%); border:1px solid hsl(140 50% 80%); color:hsl(140 50% 30%); border-radius:8px; padding:16px; font-size:14px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:8px; }
        .pw-wrapper { position:relative; margin-bottom:12px; }
        .pw-toggle { position:absolute; right:10px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text3); cursor:pointer; padding:4px; }
      `}</style>

      <div className="reset-card">
        <img src={logoImg} alt="Logo" style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", margin: "0 auto 16px", display: "block" }} />
        <h2 style={{ textAlign: "center", fontFamily: "var(--f-disp)", fontWeight: 800, fontSize: 18, color: "var(--text)", marginBottom: 16 }}>
          Restablecer contraseña
        </h2>

        {success ? (
          <div className="reset-success">
            <CheckCircle size={32} />
            <strong>Contraseña actualizada</strong>
            <span>Ya puedes ingresar con tu nueva contraseña. Redirigiendo...</span>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="pw-wrapper">
              <input
                className="reset-input"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Nueva contraseña"
                autoFocus
                data-testid="input-new-password"
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPw(v => !v)}>
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <input
              className="reset-input"
              type={showPw ? "text" : "password"}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Confirmar contraseña"
              data-testid="input-confirm-password"
            />
            {error && <div className="reset-error" style={{ marginTop: 8 }}>{error}</div>}
            <button type="submit" className="reset-btn" disabled={loading} style={{ marginTop: 12 }} data-testid="button-reset-password">
              {loading ? <Loader2 size={18} className="animate-spin" /> : "Actualizar contraseña"}
            </button>
          </form>
        )}

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <a href="/" style={{ color: "var(--text3)", fontSize: 13 }} data-testid="link-back-home">Volver al inicio</a>
        </div>
      </div>
    </div>
  );
}
