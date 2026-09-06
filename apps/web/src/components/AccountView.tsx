import { useEffect, useState, type ReactElement } from "react";
import type { CustomerAddress } from "@beautyai/shared";
import { API_URL, STORE_SLUG } from "../lib/api";
import { cents, formatDate } from "../lib/format";

const TOKEN_KEY = "bt_customer_token";

interface OrderSummary {
  id: string;
  number: number;
  status: string;
  total_amount: number;
  currency: string;
  placed_at: string;
}

interface AuthResponse {
  accessToken: string;
  customer: { id: string; email: string; firstName: string | null; lastName: string | null };
}

async function post<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tenant-Slug": STORE_SLUG,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { data?: T; detail?: string; error?: string };
  if (!res.ok) throw new Error(data.detail ?? data.error ?? `Request failed (${res.status})`);
  return data.data as T;
}

async function get<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    headers: { "X-Tenant-Slug": STORE_SLUG, Authorization: `Bearer ${token}` },
  });
  const data = (await res.json().catch(() => ({}))) as { data?: T; detail?: string };
  if (!res.ok) throw new Error(data.detail ?? `Request failed (${res.status})`);
  return data.data as T;
}

export default function AccountView(): ReactElement {
  const [token, setToken] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored) {
      setToken(stored);
      void loadData(stored);
    }
  }, []);

  async function loadData(t: string): Promise<void> {
    try {
      const [o, a] = await Promise.all([
        get<OrderSummary[]>("/me/orders", t),
        get<CustomerAddress[]>("/me/addresses", t),
      ]);
      setOrders(Array.isArray(o) ? o : []);
      setAddresses(Array.isArray(a) ? a : []);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
    }
  }

  async function submit(e: { preventDefault(): void }): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await post<AuthResponse>("/customers/login", { email, password })
          : await post<AuthResponse>("/customers/register", { email, password, firstName: firstName || null, lastName: lastName || null });
      localStorage.setItem(TOKEN_KEY, res.accessToken);
      setToken(res.accessToken);
      setPassword("");
      await loadData(res.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setOrders([]);
    setAddresses([]);
  }

  if (!token) {
    return (
      <section className="section">
        <div className="container container-narrow">
          <div className="acct-card">
            <p className="eyebrow">Customer account</p>
            <h2>{mode === "login" ? "Sign in" : "Create an account"}</h2>
            <p className="muted small">
              {mode === "login"
                ? "Access your order history and saved addresses."
                : "Track orders and check out faster next time."}
            </p>

            {error && <div className="notice">{error}</div>}

            <form className="stack" onSubmit={(e) => void submit(e)}>
              {mode === "register" && (
                <div className="form-grid">
                  <label className="field-label">
                    First name
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </label>
                  <label className="field-label">
                    Last name
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </label>
                </div>
              )}
              <label className="field-label">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </label>
              <label className="field-label">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "login" ? "Your password" : "8+ characters"}
                />
              </label>
              <button className="btn btn-accent btn-block" type="submit" disabled={busy}>
                {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="muted small switch-line">
              {mode === "login" ? "New here?" : "Already have an account?"}{" "}
              <button type="button" className="link-btn" onClick={() => setMode(mode === "login" ? "register" : "login")}>
                {mode === "login" ? "Create an account" : "Sign in instead"}
              </button>
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="container">
        <div className="acct-head">
          <div>
            <p className="eyebrow">Your account</p>
            <h2>{email}</h2>
          </div>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sign out
          </button>
        </div>

        <div className="acct-grid">
          <div className="acct-panel">
            <h3>Order history</h3>
            {orders.length === 0 ? (
              <p className="muted small">No orders yet.</p>
            ) : (
              <ul className="plain-list">
                {orders.map((o) => (
                  <li key={o.id} className="order-row">
                    <span>
                      <strong>#{o.number}</strong>
                      <span className="muted small"> · {formatDate(o.placed_at)}</span>
                    </span>
                    <span className={`pill ${o.status}`}>{o.status}</span>
                    <span>{cents(o.total_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="acct-panel">
            <h3>Saved addresses</h3>
            {addresses.length === 0 ? (
              <p className="muted small">No addresses saved yet.</p>
            ) : (
              <ul className="plain-list">
                {addresses.map((a) => (
                  <li key={a.id} className="addr-row">
                    <strong>
                      {a.firstName ?? ""} {a.lastName ?? ""}
                    </strong>
                    <span className="muted small">
                      {a.address1}, {a.city}, {a.province ? `${a.province}, ` : ""}
                      {a.zip} {a.country}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}