import { useEffect, useState, type ReactElement } from "react";
import type { Cart } from "@beautyai/shared";
import { API_URL, STORE_SLUG } from "../lib/api";
import { cents } from "../lib/format";

const CART_COOKIE = "bt_cart";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string): void {
  const days = 30;
  const d = new Date();
  d.setTime(d.getTime() + days * 864e5);
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}

function clearCookie(name: string): void {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
}

export default function CartDrawer(): ReactElement {
  const [cart, setCart] = useState<Cart | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const headers = { "X-Tenant-Slug": STORE_SLUG, "Content-Type": "application/json" };

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      throw new Error(body.detail ?? `Request failed (${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return ((await res.json()) as { data: T }).data;
  }

  async function ensureCart(): Promise<Cart> {
    const existing = readCookie(CART_COOKIE);
    if (existing) {
      try {
        const c = await api<Cart>(`/api/v1/carts/${existing}`);
        if (c.id) {
          syncCookie(c);
          return c;
        }
      } catch {
        clearCookie(CART_COOKIE);
      }
    }
    const c = await api<Cart>("/api/v1/carts", { method: "POST" });
    syncCookie(c);
    return c;
  }

  function syncCookie(c: Cart): void {
    writeCookie(CART_COOKIE, c.id);
    const badge = document.querySelector<HTMLElement>("[data-cart-count]");
    if (badge) {
      badge.textContent = String(c.itemCount);
      badge.hidden = c.itemCount === 0;
    }
  }

  async function refresh(): Promise<void> {
    const id = readCookie(CART_COOKIE);
    if (!id) {
      setCart(null);
      return;
    }
    try {
      const c = await api<Cart>(`/api/v1/carts/${id}`);
      syncCookie(c);
      setCart(c);
    } catch {
      setCart(null);
    }
  }

  async function addToCart(variantId: string, quantity: number): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const c = await ensureCart();
      const updated = await api<Cart>(`/api/v1/carts/${c.id}/items`, {
        method: "POST",
        body: JSON.stringify({ variantId, quantity }),
      });
      syncCookie(updated);
      setCart(updated);
      setOpen(true);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not add item");
    } finally {
      setBusy(false);
    }
  }

  async function setQuantity(itemId: string, quantity: number): Promise<void> {
    if (!cart || (quantity < 1 && !window.confirm("Remove this item?"))) {
      if (cart && quantity >= 1) return;
      if (cart) return removeItem(itemId);
    }
    if (!cart) return;
    setBusy(true);
    try {
      const updated = await api<Cart>(`/api/v1/carts/${cart.id}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity }),
      });
      if (quantity === 0) {
        const refreshed = await api<Cart>(`/api/v1/carts/${cart.id}`);
        syncCookie(refreshed);
        setCart(refreshed);
      } else {
        syncCookie(updated);
        setCart(updated);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not update item");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(itemId: string): Promise<void> {
    if (!cart) return;
    setBusy(true);
    try {
      if (cart.items.length === 1) {
        await api(`/api/v1/carts/${cart.id}/items/${itemId}`, { method: "DELETE" });
        clearCookie(CART_COOKIE);
        setCart(null);
        syncCookie({ id: "", itemCount: 0 } as Cart);
      } else {
        const updated = await api<Cart>(`/api/v1/carts/${cart.id}/items/${itemId}`, { method: "DELETE" });
        syncCookie(updated);
        setCart(updated);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not remove item");
    } finally {
      setBusy(false);
    }
  }

  async function checkout(): Promise<void> {
    if (!cart) return;
    setBusy(true);
    setMessage(null);
    try {
      const session = await api<{ sessionId: string; sessionUrl: string | null }>("/api/v1/checkout/sessions", {
        method: "POST",
        body: JSON.stringify({ cartId: cart.id }),
      });
      if (session.sessionUrl) window.location.assign(session.sessionUrl);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Checkout is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    const onAdd = (e: Event): void => {
      const { variantId, quantity = 1 } = (e as CustomEvent<{ variantId: string; quantity?: number }>).detail;
      void addToCart(variantId, quantity);
    };
    const onOpen = (): void => setOpen(true);
    document.addEventListener("cart:add", onAdd);
    document.addEventListener("cart:open", onOpen);
    return () => {
      document.removeEventListener("cart:add", onAdd);
      document.removeEventListener("cart:open", onOpen);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      {open && (
        <div
          className="drawer-backdrop"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div className="drawer" role="dialog" aria-label="Shopping cart" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3>Your Cart</h3>
              <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close cart">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {message && <div className="notice" style={{ margin: "12px 24px 0" }}>{message}</div>}

            {!cart || cart.items.length === 0 ? (
              <div className="empty-cart">
                <p>Your cart is empty.</p>
                <a className="btn btn-ghost" href="/" onClick={() => setOpen(false)}>
                  Browse the collection
                </a>
              </div>
            ) : (
              <>
                <div className="drawer-items">
                  {cart.items.map((item) => (
                    <div className="line" key={item.id}>
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.productTitle} loading="lazy" />
                      ) : (
                        <div style={{ width: 64, height: 80, background: "var(--bg-soft)", borderRadius: 12 }} />
                      )}
                      <div className="line-copy">
                        <div className="t">{item.productTitle}</div>
                        <div className="v">{item.variantTitle}</div>
                        <div className="v">{cents(item.unitPriceAmount)}</div>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                          <span className="qty-control">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void setQuantity(item.id, item.quantity - 1)}
                              aria-label="Decrease quantity"
                            >
                              −
                            </button>
                            <span>{item.quantity}</span>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void setQuantity(item.id, item.quantity + 1)}
                              aria-label="Increase quantity"
                            >
                              +
                            </button>
                          </span>
                          <button type="button" className="line-remove" disabled={busy} onClick={() => void removeItem(item.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="drawer-foot">
                  <div className="drawer-total">
                    <span>Subtotal</span>
                    <span>{cents(cart.subtotalAmount)}</span>
                  </div>
                  <button type="button" className="btn btn-accent btn-block" disabled={busy} onClick={() => void checkout()}>
                    {busy ? "Working…" : "Checkout"}
                  </button>
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => setOpen(false)}>
                    Keep shopping
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}