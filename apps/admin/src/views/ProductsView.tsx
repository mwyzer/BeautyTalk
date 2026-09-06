import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from "react";
import type { Product } from "@beautyai/shared";
import { api } from "../lib/api";
import { cents, statusPill } from "../lib/format";

export function ProductsView(): ReactElement {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await api<{ data: Product[] }>("/admin/products?limit=100&includeArchived=false");
      setProducts(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: "active" | "draft"): Promise<void> {
    try {
      await api(`/admin/products/${id}/publish`, { method: "POST", body: { status } });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function archive(id: string): Promise<void> {
    try {
      await api(`/admin/products/${id}`, { method: "DELETE" });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p className="muted">{products.length} items</p>
        </div>
        <button className="btn btn-accent" onClick={() => setShowCreate(true)}>
          New product
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Type</th>
              <th>Price</th>
              <th>Status</th>
              <th>Variants</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.title}</strong>
                  <div className="muted small">/{p.handle}</div>
                </td>
                <td>{p.productType ?? "—"}</td>
                <td>{cents(p.variants[0]?.priceAmount ?? 0)}</td>
                <td>
                  <span className={`pill ${statusPill(p.status)}`}>{p.status}</span>
                </td>
                <td>{p.variants.length}</td>
                <td className="actions">
                  {p.status === "active" ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(p.id, "draft")}>
                      Unpublish
                    </button>
                  ) : (
                    <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(p.id, "active")}>
                      Publish
                    </button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => void archive(p.id)}>
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {!busy && products.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No products yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateProductForm onDone={() => { setShowCreate(false); void load(); }} onCancel={() => setShowCreate(false)} />}
    </div>
  );
}

function CreateProductForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }): ReactElement {
  const [title, setTitle] = useState("");
  const [productType, setProductType] = useState("");
  const [vendor, setVendor] = useState("");
  const [variantTitle, setVariantTitle] = useState("Default");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("0");
  const [inventory, setInventory] = useState("0");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/admin/products", {
        method: "POST",
        body: {
          title,
          description: description || null,
          vendor: vendor || null,
          productType: productType || null,
          status: "draft",
          tags: [],
          variants: [
            {
              title: variantTitle,
              sku,
              priceAmount: Math.round(Number(price) * 100),
              inventoryQty: Math.round(Number(inventory)),
              isDefault: true,
            },
          ],
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New product</h2>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={(e) => void submit(e)}>
          <div className="form-grid">
            <label className="span-2">
              Title *
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
            </label>
            <label>
              Product type
              <input value={productType} onChange={(e) => setProductType(e.target.value)} />
            </label>
            <label>
              Vendor
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </label>
            <label>
              Variant title *
              <input value={variantTitle} onChange={(e) => setVariantTitle(e.target.value)} required />
            </label>
            <label>
              SKU *
              <input value={sku} onChange={(e) => setSku(e.target.value)} required />
            </label>
            <label>
              Price (USD) *
              <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </label>
            <label>
              Inventory *
              <input type="number" min="0" step="1" value={inventory} onChange={(e) => setInventory(e.target.value)} required />
            </label>
            <label className="span-2">
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </label>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Create product"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}