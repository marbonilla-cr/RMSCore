import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Delete, Loader2, Clock, LogIn, LogOut, CheckCircle } from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_Grande_1772160879830.png";
import { apiRequest } from "@/lib/queryClient";

interface PinLoginPageProps {
  onSwitchToPassword: () => void;
}

type ClockMode = "login" | "clock";

interface ClockResult {
  success: boolean;
  message: string;
  action?: string;
  displayName?: string;
  workedMinutes?: number;
}

export default function PinLoginPage({ onSwitchToPassword }: PinLoginPageProps) {
  const { pinLogin } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ClockMode>("login");
  const [clockAction, setClockAction] = useState<"clock_in" | "clock_out">("clock_in");
  const [clockResult, setClockResult] = useState<ClockResult | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
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

  const handleDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError("");
    setClockResult(null);

    if (newPin.length === 4) {
      if (mode === "login") {
        submitPin(newPin);
      } else {
        submitClock(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError("");
  };

  const handleClear = () => {
    setPin("");
    setError("");
  };

  const triggerShake = () => {
    setShakeKey(k => k + 1);
  };

  const submitPin = async (p: string) => {
    setLoading(true);
    try {
      await pinLogin(p);
    } catch (err: any) {
      setError(err.message || "PIN incorrecto");
      setPin("");
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const submitClock = async (p: string) => {
    setLoading(true);
    setClockResult(null);
    try {
      let geoData: { lat?: number; lng?: number; accuracy?: number } = {};
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: true });
        });
        geoData = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      } catch {}

      const res = await apiRequest("POST", "/api/auth/pin-clock", {
        pin: p,
        action: clockAction,
        ...geoData,
      });
      const data = await res.json();
      const mins = data.workedMinutes;
      const hoursStr = mins ? `${Math.floor(mins / 60)}h ${mins % 60}m` : "";
      setClockResult({
        success: true,
        message: data.action === "clock_in"
          ? `Entrada registrada para ${data.displayName}`
          : `Salida registrada para ${data.displayName}${hoursStr ? ` (${hoursStr})` : ""}`,
        action: data.action,
        displayName: data.displayName,
        workedMinutes: mins,
      });
      setPin("");
    } catch (err: any) {
      let msg = "Error al marcar";
      try {
        const body = JSON.parse(err.message.replace(/^[^{]*/, ""));
        msg = body.message || msg;
      } catch {
        msg = err.message || msg;
      }
      setError(msg);
      setPin("");
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: ClockMode) => {
    setMode(newMode);
    setPin("");
    setError("");
    setClockResult(null);
  };

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="pin-screen">
      <style>{`
        .pin-screen {
          min-height: 100dvh;
          background: var(--bg);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          font-family: var(--f-body);
          color: var(--text);
          padding: 20px;
        }

        .pin-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 32px;
        }
        .pin-logo {
          width: 72px; height: 72px;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid var(--border-ds);
          margin-bottom: 12px;
        }
        .brand-name {
          font-family: var(--f-disp);
          font-size: 22px;
          font-weight: 800;
          letter-spacing: 0.03em;
          color: var(--text);
          text-align: center;
        }
        .brand-time {
          font-family: var(--f-mono);
          font-size: 48px;
          font-weight: 600;
          color: var(--text);
          letter-spacing: 0.04em;
          margin-top: 6px;
          line-height: 1;
        }
        .brand-date {
          font-family: var(--f-mono);
          font-size: 12px;
          color: var(--text3);
          margin-top: 6px;
          text-transform: capitalize;
        }

        .pin-mode-label {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text2);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .clock-toggle {
          display: flex;
          gap: 8px;
          margin-bottom: 20px;
          width: 100%;
          max-width: 280px;
        }
        .clock-toggle-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 10px 16px;
          border-radius: var(--r-sm);
          font-family: var(--f-disp);
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: all var(--t-fast);
          border: 1.5px solid var(--border-ds);
          background: var(--s2);
          color: var(--text3);
        }
        .clock-toggle-btn.active {
          background: var(--green-d);
          border-color: var(--green-m);
          color: var(--green);
        }

        .pin-dots {
          display: flex;
          gap: 16px;
          margin-bottom: 8px;
        }
        .pin-dot {
          width: 14px; height: 14px;
          border-radius: 50%;
          border: 2px solid var(--border2);
          background: transparent;
          transition: all 0.38s cubic-bezier(.22,.68,0,1.2);
        }
        .pin-dot.filled {
          background: var(--green);
          border-color: var(--green);
          box-shadow: 0 0 10px var(--green-m);
        }
        .pin-dot.error {
          background: var(--red);
          border-color: var(--red);
          box-shadow: 0 0 10px var(--red-d);
        }

        .pin-feedback {
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 4px;
        }
        .pin-error {
          font-family: var(--f-mono);
          font-size: 12px;
          color: var(--red);
        }
        .pin-success {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--f-mono);
          font-size: 12px;
          color: var(--green);
        }
        .pin-loading {
          color: var(--green);
        }

        .pin-grid {
          display: grid;
          grid-template-columns: repeat(3, 72px);
          gap: 14px;
          justify-content: center;
        }
        .pin-btn {
          width: 72px; height: 72px;
          border-radius: 50%;
          background: var(--s2);
          border: 1.5px solid var(--border-ds);
          color: var(--text);
          font-family: var(--f-disp);
          font-size: 28px;
          font-weight: 700;
          transition: all var(--t-fast);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          -webkit-tap-highlight-color: transparent;
        }
        .pin-btn:active {
          background: var(--s3);
          border-color: var(--border2);
          transform: scale(0.92);
        }
        .pin-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .pin-btn.clear-btn {
          font-family: var(--f-mono);
          font-size: 11px;
          font-weight: 500;
          color: var(--text3);
          letter-spacing: 0.05em;
        }
        .pin-btn.delete-btn {
          color: var(--text2);
        }
        .pin-btn.empty-btn {
          visibility: hidden;
        }

        .pin-links {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          margin-top: 28px;
        }
        .pin-link {
          font-family: var(--f-mono);
          font-size: 11px;
          color: var(--text3);
          background: none;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 5px;
          transition: color var(--t-fast);
          letter-spacing: 0.04em;
        }
        .pin-link:active { color: var(--text2); }

        @keyframes pin-shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .pin-shake { animation: pin-shake 0.4s ease; }
      `}</style>

      <div className="pin-brand">
        <img src={logoImg} alt="Logo" className="pin-logo" data-testid="img-logo" />
        <div className="brand-name" data-testid="text-app-title">La Antigua Lechería</div>
        <div className="brand-time">{currentTime}</div>
        <div className="brand-date">{currentDate}</div>
      </div>

      <div className="pin-mode-label">
        {mode === "login" ? (
          <>Ingrese su PIN</>
        ) : (
          <>Marcar {clockAction === "clock_in" ? "Entrada" : "Salida"}</>
        )}
      </div>

      {mode === "clock" && (
        <div className="clock-toggle">
          <button
            className={`clock-toggle-btn ${clockAction === "clock_in" ? "active" : ""}`}
            onClick={() => { setClockAction("clock_in"); setPin(""); setError(""); setClockResult(null); }}
            data-testid="button-select-clock-in"
          >
            <LogIn size={16} /> Entrada
          </button>
          <button
            className={`clock-toggle-btn ${clockAction === "clock_out" ? "active" : ""}`}
            onClick={() => { setClockAction("clock_out"); setPin(""); setError(""); setClockResult(null); }}
            data-testid="button-select-clock-out"
          >
            <LogOut size={16} /> Salida
          </button>
        </div>
      )}

      <div
        className={`pin-dots ${error ? "pin-shake" : ""}`}
        key={shakeKey}
        data-testid="pin-dots"
      >
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            data-testid={`pin-dot-${i}`}
            className={`pin-dot ${i < pin.length ? (error ? "error" : "filled") : ""}`}
          />
        ))}
      </div>

      <div className="pin-feedback">
        {error && (
          <span className="pin-error" data-testid="text-pin-error">{error}</span>
        )}
        {clockResult && clockResult.success && (
          <span className="pin-success" data-testid="text-clock-result">
            <CheckCircle size={14} />
            {clockResult.message}
          </span>
        )}
        {loading && (
          <Loader2 size={20} className="pin-loading animate-spin" />
        )}
      </div>

      <div className="pin-grid">
        {digits.map((d) => (
          <button
            key={d}
            className="pin-btn"
            data-testid={`button-pin-${d}`}
            onClick={() => handleDigit(d)}
            disabled={loading}
          >
            {d}
          </button>
        ))}
        <button
          className="pin-btn clear-btn"
          data-testid="button-pin-clear"
          onClick={handleClear}
          disabled={loading}
        >
          CLR
        </button>
        <button
          className="pin-btn"
          data-testid="button-pin-0"
          onClick={() => handleDigit("0")}
          disabled={loading}
        >
          0
        </button>
        <button
          className="pin-btn delete-btn"
          data-testid="button-pin-delete"
          onClick={handleDelete}
          disabled={loading}
        >
          <Delete size={22} />
        </button>
      </div>

      <div className="pin-links">
        {mode === "login" ? (
          <button
            className="pin-link"
            data-testid="button-switch-to-clock"
            onClick={() => switchMode("clock")}
          >
            <Clock size={13} /> Marcar Entrada / Salida
          </button>
        ) : (
          <button
            className="pin-link"
            data-testid="button-switch-to-login"
            onClick={() => switchMode("login")}
          >
            Volver a Login
          </button>
        )}
        <button
          className="pin-link"
          data-testid="link-password-login"
          onClick={onSwitchToPassword}
        >
          Usar usuario / contraseña
        </button>
      </div>
    </div>
  );
}
