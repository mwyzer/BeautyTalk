import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { BrandTone, ContentDraft, ContentType, ContentVersion } from "@beautyai/shared";
import { api, list, type ListMeta } from "../lib/api";
import { dateTime, statusPill } from "../lib/format";

type Tab = "generate" | "drafts" | "tone";

export function ContentView(): ReactElement {
  const [tab, setTab] = useState<Tab>("generate");
  const [error, setError] = useState<string | null>(null);

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "generate", label: "Generate" },
    { key: "drafts", label: "Drafts" },
    { key: "tone", label: "Brand tone" },
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Content engine</h1>
          <p className="muted">AI copy for product descriptions, meta tags, and brand voice.</p>
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
      {tab === "generate" && <GeneratePanel onError={setError} />}
      {tab === "drafts" && <DraftsPanel onError={setError} />}
      {tab === "tone" && <TonePanel onError={setError} />}
    </div>
  );
}

// ===== Brand tone =====

function TonePanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [tone, setTone] = useState<BrandTone | null>(null);
  const [name, setName] = useState("");
  const [voice, setVoice] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [language, setLanguage] = useState("en");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api<{ data: BrandTone | null }>("/admin/content/brand-tone");
      setTone(data);
      setName(data?.name ?? "");
      setVoice(data?.voice ?? "");
      setForbidden(data?.forbiddenWords.join(", ") ?? "");
      setLanguage(data?.language ?? "en");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load brand tone");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api<{ data: BrandTone }>("/admin/content/brand-tone", {
        method: "PUT",
        body: {
          name: name || undefined,
          voice: voice || undefined,
          forbiddenWords: forbidden.split(",").map((s) => s.trim()).filter(Boolean),
          language: language || undefined,
        },
      });
      setTone(data);
      onError("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save brand tone");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="table-card">
      <div className="page-head">
        <div>
          <h2>Brand voice</h2>
          {tone ? <p className="muted small">Last updated {dateTime(tone.updatedAt)}</p> : <p className="muted small">No tone configured yet.</p>}
        </div>
        <span className="pill pill-blue">{language.toUpperCase()}</span>
      </div>
      <form onSubmit={(e) => void save(e)}>
        <div className="form-grid">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Glow Voice" maxLength={80} />
          </label>
          <label>
            Language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="de">Deutsch</option>
              <option value="fr">Français</option>
            </select>
          </label>
          <label className="span-2">
            Voice
            <textarea value={voice} onChange={(e) => setVoice(e.target.value)} rows={2} placeholder="e.g. warm and honest, clinical yet approachable" />
          </label>
          <label className="span-2">
            Forbidden words (comma-separated)
            <input value={forbidden} onChange={(e) => setForbidden(e.target.value)} placeholder="miracle, cure, guaranteed" />
          </label>
        </div>
        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save tone"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ===== Generation =====

interface ProductOption {
  id: string;
  title: string;
}

interface GenerateResult {
  queued?: boolean;
  jobId?: string;
  drafts?: ContentDraft[];
  cached?: number;
}

function GeneratePanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [type, setType] = useState<ContentType>("product_description");
  const [regenerate, setRegenerate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [credits, setCredits] = useState<{ used: number; quotaLimit: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [{ data }, creditsRes] = await Promise.all([
        api<{ data: { id: string; title: string }[] }>("/admin/products?limit=100&includeArchived=false"),
        api<{ data: { used: number; quotaLimit: number } }>("/admin/content/credits"),
      ]);
      setProducts(data.map((p) => ({ id: p.id, title: p.title })));
      setCredits(creditsRes.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load products");
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = selected.size;
  const canGenerate = !busy && count > 0;

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await api<{ data: GenerateResult }>("/admin/content/generate", {
        method: "POST",
        body: { type, targetIds: [...selected], regenerate },
      });
      setResult(res.data);
      const creditsRes = await api<{ data: { used: number; quotaLimit: number } }>("/admin/content/credits");
      setCredits(creditsRes.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {credits && (
        <div className="alert">
          Credits used: <strong>{credits.used}</strong>
          {credits.quotaLimit !== -1 ? ` / ${credits.quotaLimit}` : " (unlimited)"}
        </div>
      )}
      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Generate copy</h2>
            <p className="muted small">Select products and generate drafts. Drafts are never published automatically.</p>
          </div>
        </div>
        <form onSubmit={(e) => void generate(e)}>
          <div className="form-grid">
            <label>
              Content type
              <select value={type} onChange={(e) => setType(e.target.value as ContentType)}>
                <option value="product_description">Product description</option>
                <option value="meta">Meta title &amp; description</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={regenerate} onChange={(e) => setRegenerate(e.target.checked)} /> Regenerate even if drafts exist
            </label>
          </div>
          <h3 className="muted small">Target products ({count} selected)</h3>
          <div className="plain-list">
            {products.map((p) => (
              <label key={p.id} className="plain-list">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /> {p.title}
              </label>
            ))}
            {!busy && products.length === 0 && <p className="empty">No products yet — create one under Products.</p>}
          </div>
          <div className="modal-actions">
            <button type="submit" className="btn btn-primary" disabled={!canGenerate}>
              {busy ? "Generating…" : `Generate (${count})`}
            </button>
          </div>
        </form>
      </div>

      {result && (
        <div className="table-card">
          <h3>Result</h3>
          {result.queued ? (
            <p className="muted">Queued for async generation — job <strong>{result.jobId}</strong>. Check the Drafts tab shortly.</p>
          ) : (
            <p className="muted">
              {result.drafts?.length ?? 0} draft(s) created{result.cached ? ` (${result.cached} cached from earlier runs)` : ""}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ===== Drafts =====

const STATUS_FILTERS = ["all", "draft", "approved", "published", "rejected"] as const;

function DraftsPanel({ onError }: { onError: (m: string) => void }): ReactElement {
  const [drafts, setDrafts] = useState<ContentDraft[]>([]);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [versions, setVersions] = useState<ContentVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<ListMeta | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params: Record<string, string> = {};
      if (status !== "all") params.status = status;
      const res = await list<ContentDraft>("/admin/content/drafts", params);
      setDrafts(res.data);
      setMeta(res.meta);
      setVersions(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load drafts");
    } finally {
      setBusy(false);
    }
  }, [status, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(id: string, path: string): Promise<void> {
    try {
      await api(`/admin/content/drafts/${id}${path}`, { method: "POST" });
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function toggleExpand(id: string): Promise<void> {
    setExpanded((prev) => (prev === id ? null : id));
    setVersions(null);
    if (expanded !== id) {
      try {
        const { data } = await api<{ data: ContentVersion[] }>(`/admin/content/drafts/${id}/versions`);
        setVersions(data);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to load versions");
      }
    }
  }

  async function restore(draftId: string, version: number): Promise<void> {
    try {
      await api(`/admin/content/drafts/${draftId}/versions/${version}/restore`, { method: "POST" });
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Restore failed");
    }
  }

  return (
    <div>
      <div className="filter-row">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={`btn filter-pill ${status === s ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="table-card">
        <div className="page-head">
          <div>
            <h2>Drafts</h2>
            <p className="muted small">{meta?.total ?? 0} total</p>
          </div>
        </div>
        {busy && drafts.length === 0 ? (
          <p className="empty">Loading…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Target</th>
                <th>Status</th>
                <th>Summary</th>
                <th>Updated</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {drafts.map((d) => (
                <DraftRow
                  key={d.id}
                  draft={d}
                  isExpanded={expanded === d.id}
                  versions={expanded === d.id ? versions : null}
                  onExpand={() => void toggleExpand(d.id)}
                  onAct={action}
                  onRestore={restore}
                  onError={onError}
                  onSaved={() => void load()}
                />
              ))}
              {!busy && drafts.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No drafts here yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  isExpanded,
  versions,
  onExpand,
  onAct,
  onRestore,
  onError,
  onSaved,
}: {
  draft: ContentDraft;
  isExpanded: boolean;
  versions: ContentVersion[] | null;
  onExpand: () => void;
  onAct: (id: string, path: string) => Promise<void>;
  onRestore: (id: string, version: number) => Promise<void>;
  onError: (m: string) => void;
  onSaved: () => void;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.body ?? "");
  const [metaTitle, setMetaTitle] = useState(draft.metaTitle ?? "");
  const [metaDescription, setMetaDescription] = useState(draft.metaDescription ?? "");

  useEffect(() => {
    setBody(draft.body ?? "");
    setMetaTitle(draft.metaTitle ?? "");
    setMetaDescription(draft.metaDescription ?? "");
  }, [draft]);

  async function saveEdit(): Promise<void> {
    try {
      await api(`/admin/content/drafts/${draft.id}`, {
        method: "PATCH",
        body: {
          body: body || null,
          metaTitle: metaTitle || null,
          metaDescription: metaDescription || null,
        },
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Save failed");
    }
  }

  const summary = draft.type === "meta" ? (draft.metaTitle ?? "") : (draft.body ?? "").slice(0, 60);

  return (
    <>
      <tr onClick={onExpand}>
        <td>
          <span className={`pill ${statusPill(draft.status)}`}>{draft.type}</span>
        </td>
        <td>{draft.targetType === "product" ? (draft.targetId ?? "—").slice(0, 8) : draft.targetType ?? "—"}</td>
        <td>
          <span className={`pill ${statusPill(draft.status)}`}>{draft.status}</span>
        </td>
        <td className="small muted">{summary || "—"}</td>
        <td className="small muted">{dateTime(draft.updatedAt)}</td>
        <td className="actions">
          {draft.status === "draft" && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setEditing((v) => !v); }}>
                Edit
              </button>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); void onAct(draft.id, "/approve"); }}>
                Approve
              </button>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); void onAct(draft.id, "/reject"); }}>
                Reject
              </button>
            </>
          )}
          {draft.status === "approved" && (
            <>
              <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); void onAct(draft.id, "/publish"); }}>
                Publish
              </button>
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); void onAct(draft.id, "/reject"); }}>
                Reject
              </button>
            </>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={6}>
            {editing ? (
              <div className="form-grid">
                <label className="span-2">
                  body
                  <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
                </label>
                <label>
                  Meta title (≤ 60)
                  <input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} maxLength={60} />
                </label>
                <label>
                  Meta description (≤ 160)
                  <input value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} maxLength={160} />
                </label>
                <div className="span-2 modal-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => void saveEdit()}>
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {draft.body && <p>{draft.body}</p>}
                {(draft.metaTitle || draft.metaDescription) && (
                  <p className="small muted">
                    <strong>{draft.metaTitle}</strong> — {draft.metaDescription}
                  </p>
                )}
                {draft.llmModel && <p className="small muted">Model: {draft.llmModel}</p>}
                {versions && (
                  <div className="plain-list">
                    <h4 className="muted small">Version history</h4>
                    {versions.length === 0 && <p className="small muted">No saved versions yet.</p>}
                    {versions.map((v) => (
                      <div key={v.id} className="notes-row">
                        <span className="small muted">v{v.version} · {v.changeSummary}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => void onRestore(draft.id, v.version)}>
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}