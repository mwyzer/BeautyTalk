import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { FraudConfig, FraudFlagDetails, FraudFlagListItem, FraudOverview, FraudScanResult, FraudRule } from "@beautyai/shared";
import { api } from "../lib/api";
import { cents, dateTime, statusPill } from "../lib/format";

const FLAG_FILTERS = ["all", "open", "cleared", "blocked"];
const RULE_LABELS: Record<FraudRule, string> = {
  velocity: "Velocity",
  refund_abuse: "Refund abuse",
  address_mismatch: "Address mismatch",
  new_account_burst: "New-account burst",
};

interface FlagListItem {
  id: string;
  orderNumber: number;
  orderStatus: string;
  orderEmail: string | null;
  orderTotalAmount: number;
  orderCurrency: string;
  orderPlacedAt: string;
  customerEmail: string | null;
  customerName: string | null;
  rules: FraudRule[];
  riskScore: number;
  status: string;
  createdAt: string;
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <label className="inline-label">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): ReactElement {
  return (
    <label className="option-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", whiteSpace: "nowrap" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function RuleCard({
  title,
  children,
}: {
  title: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <div className="card">
      <h3 style={{ margin: "0 0 12px" }}>{title}</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>{children}</div>
    </div>
  );
}

export function FraudView(): ReactElement {
  const [config, setConfig] = useState<FraudConfig | null>(null);
  const [flags, setFlags] = useState<FlagListItem[]>([]);
  const [overview, setOverview] = useState<FraudOverview | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<FraudFlagListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    setBusy(true);
    try {
      const [listRes, countRes] = await Promise.all([
        api<{ data: FlagListItem[] }>(`/admin/fraud/flags?limit=100${filter === "all" ? "" : `&status=${filter}`}`),
        api<{ data: FraudOverview }>("/admin/fraud/overview"),
      ]);
      setFlags(listRes.data);
      setOverview(countRes.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fraud flags");
    } finally {
      setBusy(false);
    }
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api<{ data: FraudConfig }>("/admin/fraud/config");
        if (!cancelled) setConfig(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load fraud config");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  const patchConfig = useCallback((patch: Partial<FraudConfig>): void => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const patchRule = useCallback(
    (key: "velocity" | "refundAbuse" | "addressMismatch" | "newAccountBurst", patch: Record<string, unknown>): void => {
      setConfig((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...patch } } : prev));
    },
    [],
  );

  const saveConfig = async (): Promise<void> => {
    if (!config) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await api<{ data: FraudConfig }>("/admin/fraud/config", { method: "PUT", body: config });
      setConfig(data);
      setNotice("Fraud rule configuration saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save fraud config");
    } finally {
      setBusy(false);
    }
  };

  const scan = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await api<{ data: FraudScanResult }>("/admin/fraud/scan", { method: "POST" });
      if (data.queued) {
        setNotice("Fraud scan queued in the background.");
      } else {
        setNotice(`Scan complete — ${data.scannedOrders} orders reviewed, ${data.flagsCreated} new flag(s).`);
      }
      await loadFlags();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run fraud scan");
    } finally {
      setBusy(false);
    }
  };

  async function open(flagId: string): Promise<void> {
    try {
      const res = await api<{ data: FraudFlagListItem }>(`/admin/fraud/flags/${flagId}`);
      setSelected(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load flag");
    }
  }

  async function resolve(status: "cleared" | "blocked", notes: string): Promise<void> {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/admin/fraud/flags/${selected.id}/resolve`, { method: "POST", body: { status, notes } });
      await open(selected.id);
      await loadFlags();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Fraud Detection</h1>
          <p className="muted">
            {overview
              ? `${overview.open} open · ${overview.cleared} cleared · ${overview.blocked} blocked`
              : "Order fraud review queue"}
          </p>
        </div>
        <div className="toolbar">
          <button className="btn" disabled={busy || !config} onClick={() => void saveConfig()}>
            Save rules
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void scan()}>
            Run scan
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {config && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 16 }}>
          <RuleCard title="Detection">
            <NumberField label="Flag at risk score ≥" value={config.minRiskScore} min={1} max={100} onChange={(v) => patchConfig({ minRiskScore: v })} />
            <NumberField label="Look back (days)" value={config.lookbackDays} min={1} max={365} onChange={(v) => patchConfig({ lookbackDays: v })} />
          </RuleCard>

          <RuleCard title="Velocity">
            <Toggle label="Enabled" checked={config.velocity.enabled} onChange={(v) => patchRule("velocity", { enabled: v })} />
            <NumberField label="Weight" value={config.velocity.weight} min={0} max={100} onChange={(v) => patchRule("velocity", { weight: v })} />
            <NumberField label="Orders ≥" value={config.velocity.orders} min={2} max={100} onChange={(v) => patchRule("velocity", { orders: v })} />
            <NumberField label="Within (h)" value={config.velocity.withinHours} min={1} max={168} onChange={(v) => patchRule("velocity", { withinHours: v })} />
          </RuleCard>

          <RuleCard title="Refund abuse">
            <Toggle label="Enabled" checked={config.refundAbuse.enabled} onChange={(v) => patchRule("refundAbuse", { enabled: v })} />
            <NumberField label="Weight" value={config.refundAbuse.weight} min={0} max={100} onChange={(v) => patchRule("refundAbuse", { weight: v })} />
            <NumberField label="Refund ratio ≥" value={config.refundAbuse.refundRatio} min={0} max={1} step={0.05} onChange={(v) => patchRule("refundAbuse", { refundRatio: v })} />
            <NumberField label="Min orders" value={config.refundAbuse.minOrders} min={1} max={100} onChange={(v) => patchRule("refundAbuse", { minOrders: v })} />
          </RuleCard>

          <RuleCard title="Address mismatch">
            <Toggle label="Enabled" checked={config.addressMismatch.enabled} onChange={(v) => patchRule("addressMismatch", { enabled: v })} />
            <NumberField label="Weight" value={config.addressMismatch.weight} min={0} max={100} onChange={(v) => patchRule("addressMismatch", { weight: v })} />
          </RuleCard>

          <RuleCard title="New-account burst">
            <Toggle label="Enabled" checked={config.newAccountBurst.enabled} onChange={(v) => patchRule("newAccountBurst", { enabled: v })} />
            <NumberField label="Weight" value={config.newAccountBurst.weight} min={0} max={100} onChange={(v) => patchRule("newAccountBurst", { weight: v })} />
            <NumberField label="Orders ≥" value={config.newAccountBurst.orders} min={2} max={100} onChange={(v) => patchRule("newAccountBurst", { orders: v })} />
            <NumberField label="Within (h)" value={config.newAccountBurst.withinHours} min={1} max={168} onChange={(v) => patchRule("newAccountBurst", { withinHours: v })} />
            <NumberField label="Account age (days)" value={config.newAccountBurst.accountAgeDays} min={1} max={365} onChange={(v) => patchRule("newAccountBurst", { accountAgeDays: v })} />
          </RuleCard>
        </div>
      )}

      <div className="filter-row">
        {FLAG_FILTERS.map((f) => (
          <button key={f} className={filter === f ? "filter-pill active" : "filter-pill"} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Risk</th>
              <th>Rules</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Flagged</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.id} onClick={() => void open(f.id)} style={{ cursor: "pointer" }}>
                <td>#{f.orderNumber}</td>
                <td>{f.customerEmail ?? f.orderEmail ?? "—"}</td>
                <td>
                  <span className={f.riskScore >= 80 ? "pill pill-red" : f.riskScore >= 60 ? "pill pill-amber" : "pill pill-blue"}>
                    {f.riskScore}
                  </span>
                </td>
                <td className="small">
                  {f.rules.map((r) => (
                    <span key={r} className="pill pill-gray" style={{ marginRight: 4 }}>
                      {RULE_LABELS[r] ?? r}
                    </span>
                  ))}
                </td>
                <td>
                  <span className={`pill ${statusPill(f.status)}`}>{f.status}</span>
                </td>
                <td>{cents(f.orderTotalAmount)}</td>
                <td className="muted small">{dateTime(f.createdAt)}</td>
                <td className="muted small">open →</td>
              </tr>
            ))}
            {!busy && flags.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  No fraud flags{filter === "all" ? "" : ` (${filter})`}. Run a scan to review orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <FlagDetail flag={selected} busy={busy} onClose={() => setSelected(null)} onResolve={(status, notes) => void resolve(status, notes)} />
      )}
    </div>
  );
}

function FlagDetail({
  flag,
  busy,
  onClose,
  onResolve,
}: {
  flag: FraudFlagListItem;
  busy: boolean;
  onClose: () => void;
  onResolve: (status: "cleared" | "blocked", notes: string) => void;
}): ReactElement {
  const [notes, setNotes] = useState(flag.notes ?? "");

  const detailText = (rule: FraudRule): string => {
    const detailKeys: Record<FraudRule, keyof FraudFlagDetails> = {
      velocity: "velocity",
      refund_abuse: "refundAbuse",
      address_mismatch: "addressMismatch",
      new_account_burst: "newAccountBurst",
    };
    const d = flag.details?.[detailKeys[rule]];
    if (!d) return "";
    if ("windowHours" in d && "count" in d) return `${d.count} orders in ${d.windowHours}h`;
    if ("refunded" in d && "total" in d && "ratio" in d) return `${d.refunded}/${d.total} refunded (${Math.round(d.ratio * 100)}%)`;
    if ("distinctAddresses" in d) return `${d.distinctAddresses} addresses differ`;
    return "";
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>
            Order #{flag.orderNumber}{" "}
            <span className={`pill ${flag.riskScore >= 80 ? "pill-red" : flag.riskScore >= 60 ? "pill-amber" : "pill-blue"}`}>
              risk {flag.riskScore}
            </span>{" "}
            <span className={`pill ${statusPill(flag.status)}`}>{flag.status}</span>
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="detail-grid">
          <div className="field">
            <span className="field-label">Customer</span>
            {flag.customerName ?? flag.customerEmail ?? "—"}
          </div>
          <div className="field">
            <span className="field-label">Order status</span>
            <span className={`pill ${statusPill(flag.orderStatus)}`}>{flag.orderStatus}</span>
          </div>
          <div className="field">
            <span className="field-label">Placed</span>
            {dateTime(flag.orderPlacedAt)}
          </div>
          <div className="field">
            <span className="field-label">Total</span>
            {cents(flag.orderTotalAmount)}
          </div>
        </div>

        <h3>Triggered rules</h3>
        <ul className="plain-list">
          {flag.rules.map((r) => (
            <li key={r}>
              <span className="pill pill-gray" style={{ marginRight: 8 }}>
                {RULE_LABELS[r] ?? r}
              </span>
              {detailText(r)}
            </li>
          ))}
          {flag.rules.length === 0 && <li className="muted">No rules recorded.</li>}
        </ul>

        <h3>Review notes</h3>
        <div className="notes-row">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} disabled={flag.status !== "open"} />
        </div>

        <div className="modal-actions row">
          {flag.status === "open" ? (
            <>
              <button className="btn" disabled={busy} onClick={() => onResolve("cleared", notes)}>
                Mark cleared
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => onResolve("blocked", notes)}>
                Block order
              </button>
            </>
          ) : (
            <p className="muted small">
              Reviewed {dateTime(flag.reviewedAt)} — {flag.status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}