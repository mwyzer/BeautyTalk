import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ApiClientError, getToken, login as apiLogin, setToken } from "../lib/api";

export interface AuthState {
  token: string | null;
}

export function useAuthState(): { token: string | null; authed: boolean } {
  const [token, set] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    set(getToken());
    setReady(true);
    const onStorage = (): void => set(getToken());
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { token, authed: ready && Boolean(token) };
}

export function LoginForm({ onLogin, onFailed }: { onLogin: () => void; onFailed?: (msg: string) => void }): ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = await apiLogin(email, password);
      setToken(token);
      onLogin();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Login failed";
      setError(msg);
      onFailed?.(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-card">
      <h1>BeautyTalk Admin</h1>
      <p className="auth-sub">Sign in to manage your store.</p>
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={(e) => void submit(e)}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export function AdminLayout({
  view,
  onNavigate,
  onLogout,
  children,
}: {
  view: string;
  onNavigate: (v: string) => void;
  onLogout: () => void;
  children: ReactNode;
}): ReactElement {
  const nav = [
    { key: "products", label: "Products" },
    { key: "orders", label: "Orders" },
    { key: "customers", label: "Customers" },
    { key: "content", label: "Content" },
    { key: "seo", label: "SEO" },
  ];
  return (
    <div className="admin">
      <aside className="sidebar">
        <div className="sidebar-brand">Beauty<em>Talk</em></div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.key}
              className={view === n.key ? "nav-item active" : "nav-item"}
              onClick={() => onNavigate(n.key)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <button className="nav-item logout" onClick={onLogout}>
          Sign out
        </button>
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}