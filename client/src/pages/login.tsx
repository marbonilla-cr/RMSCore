import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { setSessionToken } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LogIn, Loader2 } from "lucide-react";

export default function LoginPage() {
  const isCentralLoginHost =
    typeof window !== "undefined" && window.location.hostname === "login.rmscore.app";
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (window.location.hostname === "login.rmscore.app") {
        const email = username.trim();
        const res = await fetch("/api/auth/central-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
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

      await login(username, password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Error al iniciar sesión";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--bg)" }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img
            src="/icon-192.png"
            alt="RMSCore"
            className="w-28 h-28 rounded-2xl object-cover mb-4"
            data-testid="img-logo"
          />
          <h1 className="text-2xl font-bold" data-testid="text-app-title">
            {isCentralLoginHost ? "RMSCore" : "La Antigua Lechería"}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isCentralLoginHost
              ? "Ingresá con el correo de tu restaurante"
              : "Ingrese sus credenciales para continuar"}
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <h2 className="text-lg font-semibold text-center">Iniciar Sesión</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">
                  {isCentralLoginHost ? "Correo electrónico" : "Usuario o correo"}
                </Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={isCentralLoginHost ? "nombre@correo.com" : "Ej: juan o juan@correo.com"}
                  type={isCentralLoginHost ? "email" : "text"}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  data-testid="input-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingrese su contraseña"
                  autoComplete="current-password"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" data-testid="text-login-error">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-login">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                <span className="ml-2">{loading ? "Ingresando..." : "Ingresar"}</span>
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
