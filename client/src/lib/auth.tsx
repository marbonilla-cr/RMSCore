import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { setOnUnauthorized, queryClient, setSessionToken, getSessionToken } from "./queryClient";
import { wsManager } from "./ws";

interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  email: string | null;
  hasPin: boolean;
  createdAt: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  pinLogin: (pin: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const loggingOut = useRef(false);

  const forceLogout = useCallback(() => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    wsManager.pause();
    setUser(null);
    setSessionToken(null);
    queryClient.clear();
    setTimeout(() => { loggingOut.current = false; }, 1000);
  }, []);

  useEffect(() => {
    setOnUnauthorized(forceLogout);
  }, [forceLogout]);

  useEffect(() => {
    let mounted = true;

    const fetchUser = async () => {
      try {
        const headers: Record<string, string> = {};
        const savedToken = getSessionToken();
        if (savedToken) {
          headers["X-Session-Token"] = savedToken;
        }
        const res = await fetch("/api/auth/me", { credentials: "include", headers });
        if (!mounted) return;
        if (res.ok) {
          const data = await res.json();
          if (mounted) {
            if (data.permissions) {
              queryClient.setQueryData(["/api/auth/my-permissions"], { permissions: data.permissions, role: data.role });
            }
            setUser(data);
          }
        } else {
          if (mounted) {
            setUser(null);
            setSessionToken(null);
          }
        }
      } catch {
        if (mounted) setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchUser();

    const timeout = setTimeout(() => {
      if (mounted && loading) {
        setLoading(false);
      }
    }, 2000);

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  const [, setLocation] = useLocation();

  const handleLoginResponse = (data: any) => {
    if (data.sessionToken) {
      setSessionToken(data.sessionToken);
    }
    if (data.permissions) {
      queryClient.setQueryData(["/api/auth/my-permissions"], { permissions: data.permissions, role: data.user.role });
    }
    setUser(data.user);
    wsManager.resume();
  };

  const login = async (username: string, password: string): Promise<AuthUser> => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "Login failed");
    }
    const data = await res.json();
    handleLoginResponse(data);
    return data.user;
  };

  const pinLogin = async (pin: string): Promise<AuthUser> => {
    const res = await fetch("/api/auth/pin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
      credentials: "include",
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message || "PIN incorrecto");
    }
    const data = await res.json();
    handleLoginResponse(data);
    return data.user;
  };

  const logout = async () => {
    wsManager.pause();
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    setSessionToken(null);
    queryClient.clear();
    setLocation("/");
  };

  useEffect(() => {
    const isPWA = window.matchMedia("(display-mode: standalone)").matches
      || (window.navigator as any).standalone === true;
    if (!isPWA) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && user) {
        wsManager.pause();
        navigator.sendBeacon("/api/auth/logout");
        setUser(null);
        setSessionToken(null);
        queryClient.clear();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, pinLogin, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
