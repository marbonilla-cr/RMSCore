import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound, LogOut } from "lucide-react";
import { getSessionToken } from "@/lib/queryClient";

export default function ForcePasswordChangePage() {
  const { user, setUser, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (password.length < 6) {
      setError("Mínimo 6 caracteres");
      return;
    }
    setLoading(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const tok = getSessionToken();
      if (tok) headers["X-Session-Token"] = tok;
      const res = await fetch("/api/auth/forced-password-change", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { message?: string }).message || "No se pudo actualizar");
      }
      const meRes = await fetch("/api/auth/me", {
        credentials: "include",
        headers: tok ? { "X-Session-Token": tok } : {},
      });
      if (meRes.ok) {
        const me = await meRes.json();
        setUser(me);
      } else if (user) {
        setUser({ ...user, forcePasswordChange: false });
      }
      setPassword("");
      setConfirm("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm space-y-3">
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5" />
              <h1 className="text-lg font-semibold">Cambio de contraseña obligatorio</h1>
            </div>
            <p className="text-sm text-muted-foreground font-normal pt-1">
              Por seguridad, debe establecer una nueva contraseña antes de continuar.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="force-np">Nueva contraseña</Label>
                <Input
                  id="force-np"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  data-testid="input-force-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="force-npc">Confirmar contraseña</Label>
                <Input
                  id="force-npc"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className="text-sm text-destructive" data-testid="text-force-password-error">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-force-password-submit">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span className="ml-2">{loading ? "Guardando..." : "Guardar y continuar"}</span>
              </Button>
            </form>
          </CardContent>
        </Card>
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => logout()} type="button">
          <LogOut className="w-4 h-4 mr-2" />
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}
