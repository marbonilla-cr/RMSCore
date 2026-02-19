import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Delete, Loader2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import logoImg from "@assets/LOGO-PNG-LECHERIA_1770666183401.png";

const TRIVIAL_PINS = ["0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999", "1234"];

export default function EnrollPinPage() {
  const { user, setUser } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDigit = (digit: string) => {
    if (pin.length >= 4) return;
    const newPin = pin + digit;
    setPin(newPin);
    setError("");

    if (newPin.length === 4) {
      if (step === "enter") {
        if (TRIVIAL_PINS.includes(newPin)) {
          setError("PIN demasiado simple. Intente otro.");
          setPin("");
          return;
        }
        setFirstPin(newPin);
        setPin("");
        setStep("confirm");
      } else {
        if (newPin !== firstPin) {
          setError("Los PIN no coinciden. Intente de nuevo.");
          setPin("");
          setStep("enter");
          setFirstPin("");
          return;
        }
        submitPin(newPin);
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
      const res = await fetch("/api/auth/enroll-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: p }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Error al crear PIN");
      }
      toast({ title: "PIN creado exitosamente" });
      if (user) {
        setUser({ ...user, hasPin: true });
      }
    } catch (err: any) {
      setError(err.message);
      setPin("");
      setStep("enter");
      setFirstPin("");
    } finally {
      setLoading(false);
    }
  };

  const dots = Array.from({ length: 4 }, (_, i) => (
    <div
      key={i}
      className={`w-4 h-4 rounded-full border-2 transition-all ${
        i < pin.length ? "bg-primary border-primary scale-110" : "border-muted-foreground/40"
      }`}
    />
  ));

  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center mb-6">
          <img src={logoImg} alt="La Antigua Lechería" className="w-20 h-20 rounded-full object-cover mb-3" />
          <h1 className="text-xl font-bold">Crear PIN de Acceso</h1>
          <p className="text-muted-foreground text-sm mt-1 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            {step === "enter" ? "Ingrese un PIN de 4 dígitos" : "Confirme su PIN"}
          </p>
          {user && (
            <p className="text-sm text-primary font-medium mt-2" data-testid="text-enroll-user">
              {user.displayName}
            </p>
          )}
        </div>

        <Card>
          <CardContent className="pt-6 pb-4">
            <div className="flex justify-center gap-4 mb-6">
              {dots}
            </div>

            {error && (
              <p className="text-sm text-destructive text-center mb-4" data-testid="text-enroll-error">{error}</p>
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
                  data-testid={`button-enroll-${d}`}
                  onClick={() => handleDigit(d)}
                  disabled={loading}
                >
                  {d}
                </Button>
              ))}
              <Button
                variant="outline"
                className="h-14 text-sm"
                onClick={handleClear}
                disabled={loading}
              >
                Borrar
              </Button>
              <Button
                variant="outline"
                className="h-14 text-xl font-semibold"
                data-testid="button-enroll-0"
                onClick={() => handleDigit("0")}
                disabled={loading}
              >
                0
              </Button>
              <Button
                variant="outline"
                className="h-14"
                onClick={handleDelete}
                disabled={loading}
              >
                <Delete className="w-5 h-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
