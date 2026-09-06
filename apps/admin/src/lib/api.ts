const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000/api/v1";
const TOKEN_KEY = "bt_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiClientError extends Error {
  status: number;
  errors?: Record<string, string>;

  constructor(status: number, message: string, errors?: Record<string, string>) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => ({}))) as {
    detail?: string;
    errors?: Record<string, string>;
  };

  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiClientError(res.status, body.detail ?? `Request failed (${res.status})`, body.errors);
  }
  return body as T;
}

export async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    tokens?: { accessToken?: string };
    detail?: string;
  };
  if (!res.ok || !body.tokens?.accessToken) {
    throw new ApiClientError(res.status, body.detail ?? "Login failed");
  }
  return body.tokens.accessToken;
}

export interface ListMeta {
  page: number;
  limit: number;
  total: number;
}

export async function list<T>(path: string, params?: Record<string, string | number>): Promise<{ data: T[]; meta: ListMeta }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) qs.set(k, String(v));
  const q = qs.toString();
  return api<{ data: T[]; meta: ListMeta }>(`${path}${q ? `?${q}` : ""}`);
}