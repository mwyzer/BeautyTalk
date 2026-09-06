export function cents(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function statusPill(status: string): string {
  const map: Record<string, string> = {
    active: "pill-green",
    draft: "pill-gray",
    archived: "pill-gray",
    paid: "pill-green",
    fulfilled: "pill-green",
    cancelled: "pill-red",
    refunded: "pill-red",
    shipped: "pill-blue",
    delivered: "pill-green",
    pending: "pill-amber",
    approved: "pill-blue",
    published: "pill-green",
    rejected: "pill-red",
  };
  return map[status] ?? "pill-gray";
}