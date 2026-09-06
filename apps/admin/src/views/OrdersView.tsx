import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import type { Order } from "@beautyai/shared";
import { api } from "../lib/api";
import { cents, dateTime, statusPill } from "../lib/format";

interface OrderListItem {
  id: string;
  number: number;
  status: string;
  email: string | null;
  total_amount: number;
  currency: string;
  placed_at: string;
}

const ORDER_FILTERS = ["all", "pending", "paid", "fulfilled", "shipped", "delivered", "cancelled", "refunded"];

export function OrdersView(): ReactElement {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await api<{ data: OrderListItem[] }>(
        `/admin/orders?limit=100${filter === "all" ? "" : `&status=${filter}`}`,
      );
      setOrders(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setBusy(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(orderId: string): Promise<void> {
    try {
      const res = await api<{ data: Order }>(`/admin/orders/${orderId}`);
      setSelected(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load order");
    }
  }

  async function act(path: string, body?: unknown): Promise<void> {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/admin/orders/${selected.id}${path}`, { method: "POST", body });
      await open(selected.id);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveNotes(notes: string): Promise<void> {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/admin/orders/${selected.id}`, { method: "PATCH", body: { notes } });
      await open(selected.id);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p className="muted">{orders.length} orders</p>
        </div>
        <div className="filter-row">
          {ORDER_FILTERS.map((f) => (
            <button
              key={f}
              className={filter === f ? "filter-pill active" : "filter-pill"}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Total</th>
              <th>Placed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} onClick={() => void open(o.id)} style={{ cursor: "pointer" }}>
                <td>#{o.number}</td>
                <td>{o.email ?? "—"}</td>
                <td>
                  <span className={`pill ${statusPill(o.status)}`}>{o.status}</span>
                </td>
                <td>{cents(o.total_amount)}</td>
                <td className="muted small">{dateTime(o.placed_at)}</td>
                <td className="muted small">open →</td>
              </tr>
            ))}
            {!busy && orders.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <OrderDetail
          order={selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onFulfill={(tracking?: string) => void act("/fulfill", { carrier: "standard", trackingNumber: tracking })}
          onCancel={() => void act("/cancel")}
          onRefund={(reason?: string) => void act("/refund", { reason })}
          onNotesSaved={(notes: string) => void saveNotes(notes)}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

function OrderDetail({
  order,
  busy,
  onClose,
  onFulfill,
  onCancel,
  onRefund,
  onNotesSaved,
}: {
  order: Order;
  busy: boolean;
  onClose: () => void;
  onFulfill: (tracking?: string) => void;
  onCancel: () => void;
  onRefund: (reason?: string) => void;
  onNotesSaved: (notes: string) => void;
}): ReactElement {
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState(order.notes ?? "");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            Order #{order.number} <span className={`pill ${statusPill(order.status)}`}>{order.status}</span>
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="detail-grid">
          <Field label="Email">{order.email ?? "—"}</Field>
          <Field label="Placed">{dateTime(order.placedAt)}</Field>
          <Field label="Subtotal">{cents(order.subtotalAmount)}</Field>
          <Field label="Total">{cents(order.totalAmount)}</Field>
        </div>

        <h3>Items</h3>
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th>Qty</th>
                <th>Unit</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.productTitle}</td>
                  <td>{i.variantTitle}</td>
                  <td>{i.quantity}</td>
                  <td>{cents(i.unitPriceAmount)}</td>
                  <td>{cents(i.lineTotalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Shipments</h3>
        {order.shipments.length === 0 ? (
          <p className="muted small">None yet.</p>
        ) : (
          <ul className="plain-list">
            {order.shipments.map((s) => (
              <li key={s.id}>
                {s.carrier ?? "—"} {s.trackingNumber ? `· ${s.trackingNumber}` : ""} <span className={`pill ${statusPill(s.status)}`}>{s.status}</span>
              </li>
            ))}
          </ul>
        )}

        <h3>Notes</h3>
        <div className="notes-row">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onNotesSaved(notes)}>
            Save notes
          </button>
        </div>

        <div className="modal-actions row">
          {order.status === "paid" || order.status === "pending" ? (
            <>
              <div className="action-cluster">
                <input placeholder="Tracking # (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} />
                <button className="btn btn-primary" disabled={busy} onClick={() => onFulfill(tracking || undefined)}>
                  Fulfill
                </button>
              </div>
              <button className="btn btn-ghost" disabled={busy} onClick={() => onCancel()}>
                Cancel order
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => onRefund()}>
                Refund
              </button>
            </>
          ) : (
            <p className="muted small">No actions available for a {order.status} order.</p>
          )}
        </div>
      </div>
    </div>
  );
}