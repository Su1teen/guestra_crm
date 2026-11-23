import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import type { Permission, StaffRole } from "@shared/permissions";

export interface AuthUser {
  id: string;
  email: string;
  role: StaffRole | "sales";
  roleLabel?: string;
  /** Server-computed; the UI only hides what the API would refuse anyway. */
  permissions: Permission[];
  propertyIds: string[];
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
  /** Demo (mock) sessions see every action; database sessions follow their role. */
  can: (permission: Permission) => boolean;
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

  const can = useCallback((permission: Permission) => !user || user.dataMode !== "database" || (user.permissions ?? []).includes(permission), [user]);
  const value = useMemo(() => ({ user, status, login, logout, can }), [can, login, logout, status, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
};

