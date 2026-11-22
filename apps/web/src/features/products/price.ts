// The API has no currency code; use an explicit two-decimal major-unit display.
export function priceText(minor: number): string {
  return `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}
export function toMinorUnits(text: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim()))
    throw new Error("Enter a price with at most two decimal places.");
  const [whole, fraction = ""] = text.trim().split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (minor === 0) throw new Error("Enter a price greater than zero.");
  if (!Number.isSafeInteger(minor)) throw new Error("Price is too large.");
  return minor;
}
