import { useState, type ReactElement } from "react";
import type { ProductVariant } from "@beautyai/shared";
import { cents } from "../lib/format";

interface Props {
  variants: ProductVariant[];
}

export default function ProductBuy({ variants }: Props): ReactElement {
  const [variantId, setVariantId] = useState<string>(variants[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const variant = variants.find((v) => v.id === variantId) ?? variants[0];
  const soldOut = !variant || variant.inventoryQty <= 0;
  const lowStock = variant && variant.inventoryQty > 0 && variant.inventoryQty <= 5;

  const add = (): void => {
    if (!variant) return;
    document.dispatchEvent(new CustomEvent("cart:add", { detail: { variantId: variant.id, quantity } }));
  };

  return (
    <div>
      {variants.length > 1 && (
        <>
          <div className="variant-label">Options</div>
          <div className="option-row">
            {variants.map((v) => (
              <button
                type="button"
                className="pill"
                data-selected={v.id === variantId ? "true" : "false"}
                key={v.id}
                onClick={() => {
                  setVariantId(v.id);
                  setQuantity(1);
                }}
              >
                {v.title}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="pdp-price">{variant ? cents(variant.priceAmount) : ""}</div>
      {variant?.compareAtPrice && (
        <div style={{ color: "var(--ink-soft)", fontSize: 14, textDecoration: "line-through" }}>
          {cents(variant.compareAtPrice)}
        </div>
      )}

      <div className="meta-row" style={{ marginTop: 8 }}>
        {soldOut ? (
          <span className="stock-low">Out of stock</span>
        ) : lowStock ? (
          <span className="stock-low">Only {variant.inventoryQty} left</span>
        ) : (
          <span className="in-stock">In stock</span>
        )}
        {variant?.sku && <span>SKU: {variant.sku}</span>}
      </div>

      <div className="qty-row">
        <label className="variant-label" htmlFor="qty">Quantity</label>
        <input
          id="qty"
          className="qty-input"
          type="number"
          min={1}
          max={variant?.inventoryQty ?? 1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
        />
      </div>

      <button type="button" className="btn btn-accent" style={{ width: 260 }} disabled={soldOut} onClick={add}>
        Add to cart
      </button>
    </div>
  );
}