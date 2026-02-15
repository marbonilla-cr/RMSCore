import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Delete, Loader2, KeyRound, Clock, LogIn, LogOut, CheckCircle, XCircle } from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_1770666183401.png";
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

  const submitPin = async (p: string) => {
    setLoading(true);
    try {
      await pinLogin(p);
    } catch (err: any) {
      setError(err.message || "PIN incorrecto");
      setPin("");
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

  const dots = Array.from({ length: 4 }, (_, i) => (
    <div
      key={i}
      data-testid={`pin-dot-${i}`}
      className={`w-4 h-4 rounded-full border-2 transition-all ${
        i < pin.length ? "bg-primary border-primary scale-110" : "border-muted-foreground/40"
      }`}
    />
  ));

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center mb-6">
          <img src={logoImg} alt="La Antigua Lechería" className="w-20 h-20 rounded-full object-cover mb-3" data-testid="img-logo" />
          <h1 className="text-xl font-bold" data-testid="text-app-title">La Antigua Lechería</h1>
          {mode === "login" ? (
            <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
              <KeyRound className="w-3.5 h-3.5" />
              Ingrese su PIN
            </p>
          ) : (
            <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Marcar {clockAction === "clock_in" ? "Entrada" : "Salida"}
            </p>
          )}
        </div>

        {mode === "clock" && (
          <div className="flex gap-2 mb-3">
            <Button
              variant={clockAction === "clock_in" ? "default" : "outline"}
              className="flex-1 toggle-elevate"
              onClick={() => { setClockAction("clock_in"); setPin(""); setError(""); setClockResult(null); }}
              data-testid="button-select-clock-in"
            >
              <LogIn className="w-4 h-4 mr-1" /> Entrada
            </Button>
            <Button
              variant={clockAction === "clock_out" ? "default" : "outline"}
              className="flex-1 toggle-elevate"
              onClick={() => { setClockAction("clock_out"); setPin(""); setError(""); setClockResult(null); }}
              data-testid="button-select-clock-out"
            >
              <LogOut className="w-4 h-4 mr-1" /> Salida
            </Button>
          </div>
        )}

        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex justify-center gap-4 mb-6" data-testid="pin-dots">
              {dots}
            </div>

            {error && (
              <p className="text-sm text-destructive text-center mb-4" data-testid="text-pin-error">{error}</p>
            )}

            {clockResult && clockResult.success && (
              <div className="flex items-center justify-center gap-2 mb-4 text-sm" data-testid="text-clock-result">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-green-700 dark:text-green-400">{clockResult.message}</span>
              </div>
            )}

            {loading && (
              <div className="flex justify-center mb-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {digits.map((d) => (
                <Button
                  key={d}
                  variant="outline"
                  className="h-14 text-xl font-semibold"
                  data-testid={`button-pin-${d}`}
                  onClick={() => handleDigit(d)}
                  disabled={loading}
                >
                  {d}
                </Button>
              ))}
              <Button
                variant="outline"
                className="h-14 text-sm"
                data-testid="button-pin-clear"
                onClick={handleClear}
                disabled={loading}
              >
                Borrar
              </Button>
              <Button
                variant="outline"
                className="h-14 text-xl font-semibold"
                data-testid="button-pin-0"
                onClick={() => handleDigit("0")}
                disabled={loading}
              >
                0
              </Button>
              <Button
                variant="outline"
                className="h-14"
                data-testid="button-pin-delete"
                onClick={handleDelete}
                disabled={loading}
              >
                <Delete className="w-5 h-5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col items-center gap-2 mt-4">
          {mode === "login" ? (
            <button
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              data-testid="button-switch-to-clock"
              onClick={() => switchMode("clock")}
            >
              <Clock className="w-3.5 h-3.5" /> Marcar Entrada / Salida
            </button>
          ) : (
            <button
              className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              data-testid="button-switch-to-login"
              onClick={() => switchMode("login")}
            >
              <KeyRound className="w-3.5 h-3.5" /> Volver a Login
            </button>
          )}
          <button
            className="text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
            data-testid="link-password-login"
            onClick={onSwitchToPassword}
          >
            Usar usuario/contraseña
          </button>
        </div>
      </div>
    </div>
  );
}
