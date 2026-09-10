import { useCallback, useEffect, useState, type ReactElement } from "react";
import type {
  AdsCampaignRow,
  AnalyticsConnection,
  AnalyticsOverview,
  AnalyticsProvider,
  AnalyticsSync,
  Ga4TrafficRow,
  GscReportRow,
} from "@beautyai/shared";
import { api, list, type ListMeta } from "../lib/api";
import { dateTime, statusPill } from "../lib/format";

type Tab = "overview" | "connections" | "reports";

const PROVIDER_LABEL: Record<AnalyticsProvider, string> = {
  gsc: "Google Search Console",
  ga4: "Google Analytics 4",
  ads: "Google Ads",
};

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function AnalyticsView(): ReactElement {
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "connections", label: "Connections" },
    { key: "reports", label: "Reports" },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Marketing analytics</h1>
          <p className="muted">Pull Search Console, GA4, and Google Ads data into one dashboard.</p>
        </div>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="filter-row">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`btn filter-pill ${tab === t.key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewPanel onError={setError} />}
      {tab === "connections" && <ConnectionsPanel onError={setError} />}
      {tab === "reports" && <ReportsPanel onError={setError} />}
    </div>
  );
}

function DateRangePicker({ value, onChange }: { value: [string, string]; onChange: (v: [string, string]) => void }): ReactElement {
  return (
    <div className="filter-row">
      <label className="inline-label">
        From
        <input type="date" value={value[0]} onChange={(e) => onChange([e.target.value, value[1]])} />
      </label>
      <label className="inline-label">
        To
        <input type="date" value={value[1]} onChange={(e) => onChange([value[0], e.target.value])} />
      </label>
    </div>
  );
}

function OverviewPanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [range, setRange] = useState<[string, string]>([daysAgo(29), daysAgo(0)]);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api<{ data: AnalyticsOverview }>(
        `/admin/analytics/overview?startDate=${range[0]}&endDate=${range[1]}`,
      );
      setOverview(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load analytics");
    }
  }, [range, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const k = overview?.kpis;

  return (
    <div>
      <DateRangePicker value={range} onChange={setRange} />

      <div className="summary-grid">
        <div className="summary-card">
          <div className="muted small">Organic clicks</div>
          <div>{k?.organicClicks.toLocaleString() ?? "—"}</div>
          <div className="muted small">∅ pos {k?.organicPosition ?? "—"} · CTR {(k?.organicCtr ?? 0).toFixed(1)}%</div>
        </div>
        <div className="summary-card">
          <div className="muted small">Organic impressions</div>
          <div>{k?.organicImpressions.toLocaleString() ?? "—"}</div>
          <div className="muted small">Search Console</div>
        </div>
        <div className="summary-card">
          <div className="muted small">Sessions</div>
          <div>{k?.sessions.toLocaleString() ?? "—"}</div>
          <div className="muted small">{k?.users.toLocaleString() ?? "—"} users</div>
        </div>
        <div className="summary-card">
          <div className="muted small">Conversions</div>
          <div>{k?.conversions.toLocaleString() ?? "—"}</div>
          <div className="muted small">GA4 revenue ${(k ? k.conversions : 0).toLocaleString()}</div>
        </div>
        <div className="summary-card">
          <div className="muted small">Ad spend</div>
          <div>{k ? `$${k.adSpend.toLocaleString()}` : "—"}</div>
          <div className="muted small">{k?.adClicks.toLocaleString() ?? "—"} clicks</div>
        </div>
        <div className="summary-card">
          <div className="muted small">Ad revenue</div>
          <div>{k ? `$${k.adRevenue.toLocaleString()}` : "—"}</div>
          <div className="muted small">ROAS {(k?.roas ?? 0).toFixed(2)}×</div>
        </div>
      </div>

      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Daily totals</h2>
            <p className="muted small">Organic search, site traffic, and paid clicks per day.</p>
          </div>
        </div>
        {!overview || overview.series.length === 0 ? (
          <p className="muted small pad">No data yet. Connect a provider and run a sync from the Connections tab.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Clicks</th>
                <th>Impressions</th>
                <th>Sessions</th>
                <th>Ad clicks</th>
                <th>Ad cost</th>
                <th>Ad revenue</th>
              </tr>
            </thead>
            <tbody>
              {overview.series.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{p.clicks.toLocaleString()}</td>
                  <td>{p.impressions.toLocaleString()}</td>
                  <td>{p.sessions.toLocaleString()}</td>
                  <td>{p.adClicks.toLocaleString()}</td>
                  <td>${p.adCost.toLocaleString()}</td>
                  <td>${p.adRevenue.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ConnectionsPanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [connections, setConnections] = useState<AnalyticsConnection[]>([]);
  const [syncs, setSyncs] = useState<AnalyticsSync[]>([]);
  const [busy, setBusy] = useState<AnalyticsProvider | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [meta, setMeta] = useState<ListMeta | null>(null);

  const load = useCallback(async () => {
    try {
      const [conns, syncRes] = await Promise.all([
        api<{ data: AnalyticsConnection[] }>("/admin/analytics/connections"),
        list<AnalyticsSync>("/admin/analytics/syncs", { limit: 20 }),
      ]);
      setConnections(conns.data);
      setSyncs(syncRes.data);
      setMeta(syncRes.meta);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load connections");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function connectDemo(provider: AnalyticsProvider): Promise<void> {
    setBusy(provider);
    try {
      await api("/admin/analytics/connections", { method: "POST", body: { provider, demo: true } });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Demo connect failed");
    } finally {
      setBusy(null);
    }
  }

  async function connectOAuth(provider: AnalyticsProvider): Promise<void> {
    try {
      const { data } = await api<{ data: { url: string | null; configured: boolean } }>(`/admin/analytics/oauth/${provider}`);
      if (!data.url) {
        onError("Google OAuth is not configured on this server. Use demo mode to explore.");
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      onError(err instanceof Error ? err.message : "OAuth start failed");
    }
  }

  async function disconnect(provider: AnalyticsProvider): Promise<void> {
    try {
      await api(`/admin/analytics/connections/${provider}`, { method: "DELETE" });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Disconnect failed");
    }
  }

  async function syncAll(): Promise<void> {
    setSyncing(true);
    try {
      await api("/admin/analytics/syncs", {
        method: "POST",
        body: { providers: ["gsc", "ga4", "ads"] },
      });
      let attempts = 0;
      const timer = window.setInterval(async () => {
        attempts += 1;
        await load();
        const pending = syncs.some((s) => s.status === "running" || s.status === "queued");
        if (attempts > 30 || !pending) {
          window.clearInterval(timer);
          setSyncing(false);
        }
      }, 2_000);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Sync failed");
      setSyncing(false);
    }
  }

  return (
    <div>
      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Data sources</h2>
            <p className="muted small">
              {meta ? `${meta.total} recent syncs · connections store encrypted tokens` : "Connect Google services to sync data."}
            </p>
          </div>
          <button className="btn btn-accent" disabled={syncing} onClick={() => void syncAll()}>
            {syncing ? "Syncing…" : "Sync all"}
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Account</th>
              <th>Last sync</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(Object.keys(PROVIDER_LABEL) as AnalyticsProvider[]).map((provider) => {
              const conn = connections.find((c) => c.provider === provider);
              return (
                <tr key={provider}>
                  <td>
                    <strong>{PROVIDER_LABEL[provider]}</strong>
                  </td>
                  <td>
                    <span className={`pill ${conn ? "pill-green" : "pill-gray"}`}>{conn ? conn.status : "not connected"}</span>
                  </td>
                  <td className="muted small break-word">{conn?.accountId ?? "—"}</td>
                  <td>{dateTime(conn?.lastSyncAt ?? null)}</td>
                  <td>
                    {conn ? (
                      <div className="row-gap justify-end">
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => void connectDemo(provider)}>
                          Re-sync
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => void disconnect(provider)}>
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <div className="row-gap justify-end">
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => void connectDemo(provider)}>
                          {busy === provider ? "Connecting…" : "Demo"}
                        </button>
                        <button className="btn btn-sm btn-accent" onClick={() => void connectOAuth(provider)}>
                          Connect with Google
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {syncing && <div className="alert alert-info">Sync in progress — results appear on the Overview tab.</div>}
      </div>

      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Recent syncs</h2>
            <p className="muted small">Each run pulls the configured range and upserts the matching rows.</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Records</th>
              <th>Started</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {syncs.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No syncs yet.
                </td>
              </tr>
            ) : (
              syncs.map((s) => (
                <tr key={s.id}>
                  <td>{PROVIDER_LABEL[s.provider]}</td>
                  <td>
                    <span className={`pill ${statusPill(s.status)}`}>{s.status}</span>
                  </td>
                  <td>{s.recordsProcessed}</td>
                  <td>{dateTime(s.startedAt)}</td>
                  <td className="muted small">{s.error ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsPanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [range, setRange] = useState<[string, string]>([daysAgo(29), daysAgo(0)]);
  const [gsc, setGsc] = useState<GscReportRow[]>([]);
  const [ga4, setGa4] = useState<Ga4TrafficRow[]>([]);
  const [ads, setAds] = useState<AdsCampaignRow[]>([]);

  const load = useCallback(async () => {
    try {
      const qs = `startDate=${range[0]}&endDate=${range[1]}`;
      const [gscRes, ga4Res, adsRes] = await Promise.all([
        api<{ data: { rows: GscReportRow[] } }>(`/admin/analytics/reports/gsc?${qs}`),
        api<{ data: { rows: Ga4TrafficRow[] } }>(`/admin/analytics/reports/ga4?${qs}`),
        api<{ data: { rows: AdsCampaignRow[] } }>(`/admin/analytics/reports/ads?${qs}`),
      ]);
      setGsc(gscRes.data.rows);
      setGa4(ga4Res.data.rows);
      setAds(adsRes.data.rows);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load reports");
    }
  }, [range, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <DateRangePicker value={range} onChange={setRange} />

      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Search Console — top queries</h2>
            <p className="muted small">Aggregated clicks and impressions by query × page.</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Query</th>
              <th>Page</th>
              <th>Clicks</th>
              <th>Impressions</th>
              <th>CTR</th>
              <th>Position</th>
            </tr>
          </thead>
          <tbody>
            {gsc.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No GSC data for this range.
                </td>
              </tr>
            ) : (
              gsc.slice(0, 100).map((r, i) => (
                <tr key={i}>
                  <td className="break-word">{r.query ?? "—"}</td>
                  <td className="break-word">{r.page ?? "—"}</td>
                  <td>{r.clicks}</td>
                  <td>{r.impressions}</td>
                  <td>{(r.ctr * 100).toFixed(1)}%</td>
                  <td>{r.position.toFixed(1)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>GA4 — traffic by channel</h2>
            <p className="muted small">Sessions, users, and revenue by source × medium.</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Medium</th>
              <th>Sessions</th>
              <th>Users</th>
              <th>Conversion rate</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {ga4.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No GA4 data for this range.
                </td>
              </tr>
            ) : (
              ga4.map((r, i) => (
                <tr key={i}>
                  <td className="break-word">{r.source ?? "—"}</td>
                  <td>{r.medium ?? "—"}</td>
                  <td>{r.sessions.toLocaleString()}</td>
                  <td>{r.users.toLocaleString()}</td>
                  <td>{r.conversionRate.toFixed(1)}%</td>
                  <td>${r.revenueAmount.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Google Ads — campaigns</h2>
            <p className="muted small">Spend, conversions, and return on ad spend by campaign.</p>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Clicks</th>
              <th>Impressions</th>
              <th>Spend</th>
              <th>Conversions</th>
              <th>Value</th>
              <th>ROAS</th>
            </tr>
          </thead>
          <tbody>
            {ads.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  No Ads data for this range.
                </td>
              </tr>
            ) : (
              ads.map((r, i) => (
                <tr key={i}>
                  <td className="break-word">{r.campaignName ?? "—"}</td>
                  <td>{r.clicks}</td>
                  <td>{r.impressions}</td>
                  <td>${r.cost.toLocaleString()}</td>
                  <td>{r.conversions}</td>
                  <td>${r.conversionValue.toLocaleString()}</td>
                  <td>{r.roas.toFixed(2)}×</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}