import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, onUnauthorized, type Role, type User } from "../api";
import { Spinner } from "../components/ui";

export const ROLE_LABEL: Record<Role, string> = { applicant: "Researcher", staff: "Clinic" };
export const ROLE_HOME: Record<Role, string> = { applicant: "/apply", staff: "/staff" };

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (role: Role, username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const ME = ["auth", "me"] as const;

/** Session state from GET /api/auth/me; any 401 from the API sends the user back to /login. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;

  const me = useQuery({ queryKey: ME, queryFn: api.me, retry: false, staleTime: Infinity });

  // Drop every cached response of the previous session (e.g. a staff request list) but keep "me".
  const clearData = useCallback(() => {
    qc.cancelQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
  }, [qc]);

  useEffect(() => {
    onUnauthorized(() => {
      qc.setQueryData(ME, null);
      clearData();
      if (!window.location.pathname.startsWith("/login")) navRef.current("/login", { replace: true });
    });
    return () => onUnauthorized(null);
  }, [qc, clearData]);

  const login = useCallback(
    async (role: Role, username: string, password: string) => {
      const { user } = await api.login(role, username, password);
      clearData();
      qc.setQueryData(ME, user);
      return user;
    },
    [qc, clearData],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      clearData();
      qc.setQueryData(ME, null);
      navRef.current("/login", { replace: true });
    }
  }, [qc, clearData]);

  // A failing /me (e.g. backend down) counts as signed out; the login form shows the real error.
  const value = useMemo<AuthState>(
    () => ({ user: me.data ?? null, loading: me.isLoading, login, logout }),
    [me.data, me.isLoading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Route guard: renders children only for a signed-in user with the given role, else redirects to /login. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner className="p-8" label="Checking your session…" />;
  if (!user || user.role !== role) return <Navigate to="/login" replace state={{ from: location.pathname + location.search, role }} />;
  return <>{children}</>;
}

/** "/" goes to the signed-in user's home, or to /login. */
export function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner className="p-8" label="Checking your session…" />;
  return <Navigate to={user ? ROLE_HOME[user.role] : "/login"} replace />;
}
