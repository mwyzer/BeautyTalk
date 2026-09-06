import { useCallback, useEffect, useState, type ReactElement } from "react";
import { api } from "../lib/api";
import { dateTime, statusPill } from "../lib/format";

interface CustomerListItem {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  ordersCount: number;
  totalSpentAmount: number;
  createdAt: string;
}

export function CustomersView(): ReactElement {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await api<{ data: CustomerListItem[] }>("/admin/customers?limit=100");
      setCustomers(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p className="muted">{customers.length} registered accounts</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Orders</th>
              <th>Total spent</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>
                    {c.firstName ?? ""} {c.lastName ?? ""}
                  </strong>
                </td>
                <td>{c.email}</td>
                <td>
                  <span className={`pill ${statusPill(c.ordersCount > 0 ? "shipped" : "draft")}`}>{c.ordersCount}</span>
                </td>
                <td>${(c.totalSpentAmount / 100).toFixed(2)}</td>
                <td className="muted small">{dateTime(c.createdAt)}</td>
              </tr>
            ))}
            {!busy && customers.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}