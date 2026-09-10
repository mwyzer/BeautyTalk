import { useCallback, useEffect, useState, type ReactElement } from "react";
import type { Audit, AuditIssue, AuditStatus, CrawlUrl, SeoScore } from "@beautyai/shared";
import { api, list, type ListMeta } from "../lib/api";
import { dateTime, statusPill } from "../lib/format";

type Tab = "overview" | "audits" | "issues";

interface ScoreResponse {
  latest: SeoScore | null;
  history: SeoScore[];
}

export function SEOView(): ReactElement {
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "audits", label: "Audits" },
    { key: "issues", label: "Fix queue" },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>SEO auditor</h1>
          <p className="muted">Crawl your storefront, surface SEO issues, and track your score over time.</p>
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
      {tab === "audits" && <AuditsPanel onError={setError} />}
      {tab === "issues" && <IssuesPanel onError={setError} />}
    </div>
  );
}

function OverviewPanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [score, setScore] = useState<ScoreResponse>({ latest: null, history: [] });

  const load = useCallback(async () => {
    try {
      const { data } = await api<{ data: ScoreResponse }>("/admin/seo/score");
      setScore(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load SEO score");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const latest = score.latest;
  const categories = latest?.categories;

  return (
    <div>
      <div className="summary-grid">
        <div className="summary-card">
          <div className="muted small">Overall score</div>
          <div className={tenantScoreClass(latest?.score ?? 0)}>{latest?.score ?? "—"}</div>
          <div className="muted small">out of 100</div>
        </div>
        {categories
          ? Object.entries(categories).map(([key, value]) => (
              <div className="summary-card" key={key}>
                <div className="muted small">{key}</div>
                <div className="metric-label">{value}</div>
              </div>
            ))
          : null}
      </div>

      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Score history</h2>
            <p className="muted small">One point per audit run; fixing issues bumps the next score.</p>
          </div>
        </div>
        {score.history.length === 0 ? (
          <p className="muted small pad">No audits yet. Run your first crawl from the Audits tab.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Score</th>
                {categories ? Object.keys(categories).map((c) => <th key={c}>{c}</th>) : null}
              </tr>
            </thead>
            <tbody>
              {score.history.map((s) => (
                <tr key={s.id}>
                  <td>{dateTime(s.createdAt)}</td>
                  <td>
                    <strong className={tenantScoreClass(s.score)}>{s.score}</strong>
                  </td>
                  {Object.values(s.categories).map((v, i) => (
                    <td key={`${s.id}-${i}`}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function tenantScoreClass(score: number): string {
  if (score >= 80) return "score score-good";
  if (score >= 50) return "score score-mid";
  return "score score-bad";
}

function AuditsPanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [name, setName] = useState("");
  const [crawlDepth, setCrawlDepth] = useState(3);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await list<Audit>("/admin/seo/audits", { limit: 50 });
      setAudits(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load audits");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function trigger(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/admin/seo/audits", {
        method: "POST",
        body: { name: name || undefined, crawlDepth },
      });
      setName("");
      setRunning(true);
      poll();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to start audit");
    } finally {
      setBusy(false);
    }
  }

  function poll(): void {
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      await load();
      const latest = audits[0];
      if (attempts > 40 || !latest || latest.status === "completed" || latest.status === "failed") {
        window.clearInterval(timer);
        setRunning(false);
      }
    }, 1_500);
  }

  return (
    <div className="table-card">
      <div className="page-head">
        <div>
          <h2>Audit runs</h2>
          <p className="muted small">Each crawl fetches the storefront, checks pages for SEO issues, and records a score.</p>
        </div>
        <span className="pill pill-blue">robots.txt respected</span>
      </div>

      <form className="filter-row" onSubmit={(e) => void trigger(e)}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Audit name (optional)"
          maxLength={120}
        />
        <label className="inline-label">
          Depth
          <select value={crawlDepth} onChange={(e) => setCrawlDepth(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-accent" disabled={busy || running} type="submit">
          {busy ? "Starting…" : "Run audit"}
        </button>
      </form>

      {running && <div className="alert alert-info">Crawl in progress — this takes a few seconds per page.</div>}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Progress</th>
            <th>URLs</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {audits.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No audits yet.
              </td>
            </tr>
          ) : (
            audits.map((a) => (
              <tr key={a.id}>
                <td>
                  <strong>{a.name ?? "Untitled audit"}</strong>
                </td>
                <td>
                  <span className={`pill ${statusPill(a.status)}`}>{a.status}</span>
                </td>
                <td>{a.totalUrls > 0 ? Math.round(a.progress) : 0}%</td>
                <td>{a.totalUrls}</td>
                <td>{dateTime(a.startedAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function IssuesPanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [auditId, setAuditId] = useState("");
  const [issues, setIssues] = useState<AuditIssue[]>([]);
  const [urls, setUrls] = useState<CrawlUrl[]>([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAudits = useCallback(async () => {
    try {
      const { data } = await list<Audit>("/admin/seo/audits", { limit: 50 });
      setAudits(data);
      if (!auditId && data.length > 0) setAuditId(data[0]!.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load audits");
    }
  }, [auditId, onError]);

  const loadAll = useCallback(async () => {
    if (!auditId) return;
    setBusy(true);
    try {
      const [issuesRes, urlsRes] = await Promise.all([
        list<AuditIssue>(`/admin/seo/audits/${auditId}/issues`, { status: statusFilter, limit: 200 }),
        list<CrawlUrl>(`/admin/seo/audits/${auditId}/urls`, { limit: 200 }),
      ]);
      setIssues(issuesRes.data);
      setMeta(issuesRes.meta);
      setUrls(urlsRes.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setBusy(false);
    }
  }, [auditId, statusFilter, onError]);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function act(id: string, action: "fix" | "dismiss"): Promise<void> {
    try {
      await api(`/admin/seo/audits/${auditId}/issues/${id}/${action}`, { method: "POST" });
      void loadAll();
    } catch (err) {
      onError(err instanceof Error ? err.message : `${action} failed`);
    }
  }

  return (
    <div className="table-card">
      <div className="page-head">
        <div>
          <h2>Fix queue</h2>
          <p className="muted small">
            {meta ? `${meta.total} issues` : "Select an audit"} · severity × crawl frequency drives ordering
          </p>
        </div>
        <label className="inline-label">
          Audit
          <select value={auditId} onChange={(e) => setAuditId(e.target.value)}>
            {audits.map((a) => (
              <option key={a.id} value={a.id}>
                {(a.name ?? "Untitled").slice(0, 40)} — {a.status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="filter-row">
        {["open", "fixed", "dismissed"].map((s) => (
          <button
            key={s}
            className={`btn filter-pill ${statusFilter === s ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {busy ? (
        <p className="muted small pad">Loading…</p>
      ) : (
        <div>
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>URL</th>
                <th>Severity</th>
                <th>Impact</th>
                <th>Recommended fix</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {issues.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No issues with this filter.
                  </td>
                </tr>
              ) : (
                issues.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <strong>{i.type}</strong>
                    </td>
                    <td className="break-word">{i.url ?? "—"}</td>
                    <td>
                      <span className={`pill ${severityPill(i.severity)}`}>{i.severity}</span>
                    </td>
                    <td>−{i.impactScore}</td>
                    <td className="muted small">{i.recommendedFix?.label ?? "Manual review"}</td>
                    <td>
                      {i.status === "open" ? (
                        <div className="row-gap">
                          <button className="btn btn-sm" onClick={() => void act(i.id, "fix")}>
                            Auto-fix
                          </button>
                          <button className="btn btn-sm btn-ghost" onClick={() => void act(i.id, "dismiss")}>
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <span className="muted small">{i.status}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <h3 className="subhead">Crawled URLs</h3>
          <table>
            <thead>
              <tr>
                <th>URL</th>
                <th>Title</th>
                <th>Words</th>
                <th>H1</th>
                <th>Alt missing</th>
                <th>Broken</th>
              </tr>
            </thead>
            <tbody>
              {urls.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No crawled URLs yet.
                  </td>
                </tr>
              ) : (
                urls.map((u) => (
                  <tr key={u.id}>
                    <td className="break-word">{u.url}</td>
                    <td>{u.title ?? "—"}</td>
                    <td>{u.wordCount ?? "—"}</td>
                    <td>{u.hasH1 ? "✓" : "—"}</td>
                    <td>{u.imagesWithoutAlt ?? "—"}</td>
                    <td>{u.brokenLinks ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function severityPill(severity: string): string {
  const map: Record<string, string> = { high: "pill-red", medium: "pill-amber", low: "pill-gray" };
  return map[severity] ?? "pill-gray";
}