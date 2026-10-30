import { LogOut, UserRound } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { Role } from "../api";
import { ROLE_HOME, useAuth } from "../lib/auth";
import { Logo } from "./Logo";
import { Button, focusRing } from "./ui";

/** Nav tabs; `active` also covers the detail pages that belong to a tab (e.g. a request opened from Old requests). */
const NAV: Record<Role, { to: string; label: string; active: (path: string) => boolean; right?: boolean }[]> = {
  applicant: [
    { to: "/apply", label: "New request", active: (p) => p === "/apply" },
    { to: "/my", label: "Old requests", active: (p) => p === "/my" || p.startsWith("/requests/") },
  ],
  staff: [
    { to: "/staff", label: "Dashboard", active: (p) => p === "/staff" || p.startsWith("/staff/dashboard") },
    { to: "/staff/logs", label: "Logs", active: (p) => p.startsWith("/staff/logs") || p.startsWith("/staff/requests/") },
    { to: "/staff/benchmark", label: "Benchmark", active: (p) => p.startsWith("/staff/benchmark"), right: true },
  ],
};

/** Page navigation: tabs on a full-width blue bar under the header; the active tab merges into the page background. */
function NavBar({ role }: { role: Role }) {
  const { pathname } = useLocation();
  return (
    <nav aria-label={role === "staff" ? "Staff pages" : "Applicant pages"} className="bg-brand-700">
      <ul className="mx-auto flex max-w-7xl flex-wrap gap-1 px-4 pt-2">
        {NAV[role].map((n) => {
          const active = n.active(pathname);
          return (
            <li key={n.to} className={`flex ${n.right ? "ml-auto" : ""}`}>
              <Link
                to={n.to}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center whitespace-nowrap rounded-t-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset ${
                  active ? "bg-slate-50 text-slate-900 focus-visible:ring-brand-600" : "text-white hover:bg-brand-600 focus-visible:ring-white"
                }`}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  // The header is fixed; publish its height (it grows when the nav wraps) for the spacer and sticky offsets.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () => document.documentElement.style.setProperty("--header-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [user]);

  if (!user) return null; // guarded by RequireRole
  const role = user.role;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Skip to content
      </a>
      <header ref={headerRef} className="fixed inset-x-0 top-0 z-40">
        <div className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
            <NavLink to={ROLE_HOME[role]} className={`flex items-center gap-3 ${focusRing}`}>
              <Logo height={32} />
              <span className="text-sm font-semibold text-slate-900">European Health Data Space</span>
            </NavLink>

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <UserRound className="h-4 w-4 text-slate-500" aria-hidden />
                {user.display_name || user.username}
              </span>
              <Button
                size="sm"
                loading={signingOut}
                onClick={async () => {
                  setSigningOut(true);
                  try {
                    await logout();
                  } finally {
                    setSigningOut(false);
                  }
                }}
              >
                {!signingOut && <LogOut className="h-3.5 w-3.5" aria-hidden />}
                Sign out
              </Button>
            </div>
          </div>
        </div>
        <NavBar role={role} />
      </header>
      <div aria-hidden style={{ height: "var(--header-h, 6rem)" }} className="flex-none" />
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
