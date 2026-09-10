import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { RecStrategyConfig } from "@beautyai/shared";
import { api } from "../lib/api";

interface RefreshResponse {
  ok?: boolean;
  queued?: boolean;
  jobId?: string;
  counts?: Record<string, number>;
  generatedAt?: string;
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <label className="inline-label">
      {label}
      <input
        type="number"
        min={min}
        max={max}
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
    <label className="option-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function SlotCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <div className="card">
      <div className="muted small">{hint}</div>
      <h3 style={{ margin: "4px 0 12px" }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
    </div>
  );
}

export function RecommendationsView(): ReactElement {
  const [config, setConfig] = useState<RecStrategyConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api<{ data: RecStrategyConfig }>("/admin/recommendations/strategies");
        if (!cancelled) setConfig(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load strategy config");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patchSlot = useCallback(
    (slot: "related" | "boughtTogether" | "home" | "personalized", patch: Record<string, unknown>): void => {
      setConfig((prev) => (prev ? { ...prev, [slot]: { ...prev[slot], ...patch } } : prev));
    },
    [],
  );

  const save = async (): Promise<void> => {
    if (!config) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await api<{ data: RecStrategyConfig }>("/admin/recommendations/strategies", {
        method: "PUT",
        body: config,
      });
      setConfig(data);
      setNotice("Strategy configuration saved. Run “Refresh now” to apply it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save strategy config");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data } = await api<{ data: RefreshResponse }>("/admin/recommendations/refresh", { method: "POST" });
      if (data.queued) {
        setNotice(`Recompute queued in the background${data.jobId ? ` (job ${data.jobId})` : ""}.`);
      } else {
        const counts = Object.entries(data.counts ?? {})
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        setNotice(`Recommendations recomputed at ${new Date(data.generatedAt ?? Date.now()).toISOString().slice(0, 19)} — ${counts || "no rows produced"}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh recommendations");
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return (
      <div>
        <div className="page-head">
          <h1>Recommendations</h1>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="muted">Loading strategy configuration…</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Recommendations</h1>
          <p className="muted">Configure “You May Also Like”, “Customers Also Bought”, and homepage ordering.</p>
        </div>
        <div className="toolbar">
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Save config
          </button>
          <button className="btn" disabled={busy} onClick={() => void refresh()}>
            Refresh now
          </button>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
        <SlotCard title="You May Also Like" hint="related · scored by shared collections & tags">
          <Toggle label="Enabled" checked={config.related.enabled} onChange={(v) => patchSlot("related", { enabled: v })} />
          <NumberField label="Per product" value={config.related.limit} min={1} max={50} onChange={(v) => patchSlot("related", { limit: v })} />
          <NumberField label="Collection weight" value={config.related.weightCollection} min={0} max={100} onChange={(v) => patchSlot("related", { weightCollection: v })} />
          <NumberField label="Tag weight" value={config.related.weightTag} min={0} max={100} onChange={(v) => patchSlot("related", { weightTag: v })} />
        </SlotCard>

        <SlotCard title="Customers Also Bought" hint="bought_together · co-purchase across orders">
          <Toggle label="Enabled" checked={config.boughtTogether.enabled} onChange={(v) => patchSlot("boughtTogether", { enabled: v })} />
          <NumberField label="Per product" value={config.boughtTogether.limit} min={1} max={50} onChange={(v) => patchSlot("boughtTogether", { limit: v })} />
          <NumberField label="Min. co-purchases" value={config.boughtTogether.minPairs} min={1} max={10000} onChange={(v) => patchSlot("boughtTogether", { minPairs: v })} />
        </SlotCard>

        <SlotCard title="Homepage" hint="popular · bestsellers over the window">
          <Toggle label="Enabled" checked={config.home.enabled} onChange={(v) => patchSlot("home", { enabled: v })} />
          <NumberField label="Show" value={config.home.limit} min={1} max={50} onChange={(v) => patchSlot("home", { limit: v })} />
          <NumberField label="Window (days)" value={config.home.windowDays} min={1} max={3650} onChange={(v) => patchSlot("home", { windowDays: v })} />
        </SlotCard>

        <SlotCard title="Personalization" hint="personalized · recent browsing per visitor">
          <Toggle label="Enabled" checked={config.personalized.enabled} onChange={(v) => patchSlot("personalized", { enabled: v })} />
          <NumberField label="Show" value={config.personalized.limit} min={1} max={50} onChange={(v) => patchSlot("personalized", { limit: v })} />
          <NumberField label="Lookback (days)" value={config.personalized.lookbackDays} min={1} max={365} onChange={(v) => patchSlot("personalized", { lookbackDays: v })} />
        </SlotCard>
      </div>

      <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
        The refresh job recomputes scores offline into a precomputed table, so storefront requests stay O(1).
      </p>
    </div>
  );
}