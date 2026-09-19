import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "@/lib/api";

export interface AuthUser {
  id: string;
  email: string;
  role: "sales" | "admin";
  dataMode: "mock" | "database";
  employeeId: string;
  name: string;
}

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    apiRequest<AuthUser>("/api/auth/me")
      .then((next) => { setUser(next); setStatus("authenticated"); })
      .catch((error) => { if (!(error instanceof ApiError) || error.status !== 401) console.error(error); setStatus("anonymous"); });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const next = await apiRequest<AuthUser>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    setUser(next);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await apiRequest<void>("/api/auth/logout", { method: "POST" });
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({ user, status, login, logout }), [login, logout, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
};

