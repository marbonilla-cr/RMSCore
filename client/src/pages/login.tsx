import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LogIn, Loader2 } from "lucide-react";
import logoImg from "@assets/LOGO-PNG-LECHERIA_Grande_1772160879830.png";

export default function LoginPage() {
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
      await login(username, password);
    } catch (err: any) {
      setError(err.message || "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src={logoImg} alt="La Antigua Lechería" className="w-28 h-28 rounded-full object-cover mb-4" data-testid="img-logo" />
          <h1 className="text-2xl font-bold" data-testid="text-app-title">La Antigua Lechería</h1>
          <p className="text-muted-foreground text-sm mt-1">Ingrese sus credenciales para continuar</p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <h2 className="text-lg font-semibold text-center">Iniciar Sesión</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Usuario</Label>
                <Input
                  id="username"
                  data-testid="input-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ingrese su usuario"
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
                <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
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
