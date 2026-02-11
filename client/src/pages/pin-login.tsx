import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Delete, Loader2, KeyRound } from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_1770666183401.png";

interface PinLoginPageProps {
  onSwitchToPassword: () => void;
}

export default function PinLoginPage({ onSwitchToPassword }: PinLoginPageProps) {
  const { pinLogin } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError("");

    if (newPin.length === 4) {
      submitPin(newPin);
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
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
            <KeyRound className="w-3.5 h-3.5" />
            Ingrese su PIN
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex justify-center gap-4 mb-6" data-testid="pin-dots">
              {dots}
            </div>

            {error && (
              <p className="text-sm text-destructive text-center mb-4" data-testid="text-pin-error">{error}</p>
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

        <button
          className="w-full mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors text-center"
          data-testid="link-password-login"
          onClick={onSwitchToPassword}
        >
          Usar usuario/contraseña
        </button>
      </div>
    </div>
  );
}
