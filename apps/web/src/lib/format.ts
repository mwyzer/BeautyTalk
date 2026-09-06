export function cents(value: number | null | undefined): string {
  if (value == null) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}

export function moneyToCents(value: string | null): number {
  return Number(value ?? 0);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(iso));
}