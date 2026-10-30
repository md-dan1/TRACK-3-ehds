import { LogIn } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError, type Role } from "../api";
import { Logo } from "../components/Logo";
import { Tabs } from "../components/Tabs";
import { Button } from "../components/ui";
import { ROLE_HOME, ROLE_LABEL, useAuth } from "../lib/auth";

interface FromState {
  from?: string;
  role?: Role;
}

export function LoginPage() {
  const location = useLocation();
  const state = (location.state ?? {}) as FromState;
  const { user } = useAuth();
  const [role, setRole] = useState<Role>(state.role ?? (state.from?.startsWith("/staff") ? "staff" : "applicant"));

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <Logo height={40} />
        <span className="text-lg font-semibold text-slate-900">European Health Data Space</span>
      </div>
      <main className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-xl font-semibold text-slate-900">Sign in</h1>
        <Tabs<Role>
          label="Sign in as"
          value={role}
          onChange={setRole}
          tabs={[
            { id: "applicant", label: ROLE_LABEL.applicant },
            { id: "staff", label: ROLE_LABEL.staff },
          ]}
        >
          <LoginForm key={role} role={role} from={state.from} />
        </Tabs>
        {user && (
          <p className="mt-4 border-t border-slate-200 pt-3 text-xs text-slate-600">
            Signed in as {user.display_name || user.username} ({ROLE_LABEL[user.role]}).{" "}
            <Link to={ROLE_HOME[user.role]} className="font-medium text-brand-700 underline">
              Continue
            </Link>
          </p>
        )}
      </main>
    </div>
  );
}

function LoginForm({ role, from }: { role: Role; from?: string }) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    setBusy(true);
    try {
      const user = await login(role, username.trim(), password);
      // Return to the page that asked for a login if it belongs to this role.
      const back = from && (user.role === "staff") === from.startsWith("/staff") ? from : ROLE_HOME[user.role];
      navigate(back, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setError(e.message && e.message !== "HTTP 401" ? e.message : "Wrong username or password.");
      else if (e instanceof ApiError && e.status === 429) setError(e.message && e.message !== "HTTP 429" ? e.message : "Too many sign-in attempts. Please wait a moment and try again.");
      else setError(e instanceof Error ? `Sign-in failed: ${e.message}` : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const id = `login-${role}`;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-4"
      aria-label={`Sign in as ${ROLE_LABEL[role]}`}
    >
      <div>
        <label htmlFor={`${id}-user`} className="mb-1 block text-sm font-medium text-slate-800">
          Username
        </label>
        <input id={`${id}-user`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus className="w-full px-3 py-2" />
      </div>
      <div>
        <label htmlFor={`${id}-pass`} className="mb-1 block text-sm font-medium text-slate-800">
          Password
        </label>
        <input id={`${id}-pass`} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full px-3 py-2" />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-inset ring-red-200">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" loading={busy} className="w-full">
        <LogIn className="h-4 w-4" aria-hidden />
        Sign in
      </Button>
    </form>
  );
}
