export type CartItem = {
  productId: string;
  name: string;
  priceInMinorUnits: number;
  quantity: number;
  imageGeneration?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseCart(raw: string | null): CartItem[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value) || value.length > 100) return [];
    const ids = new Set<string>();
    return value
      .filter((item): item is CartItem => {
        if (
          !item ||
          typeof item !== "object" ||
          !uuid.test(item.productId) ||
          ids.has(item.productId) ||
          typeof item.name !== "string" ||
          !Number.isSafeInteger(item.priceInMinorUnits) ||
          item.priceInMinorUnits < 1 ||
          !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 99
        )
          return false;
        ids.add(item.productId);
        return true;
      })
      .map((item) => ({
        productId: item.productId,
        name: item.name.slice(0, 200),
        priceInMinorUnits: item.priceInMinorUnits,
        quantity: item.quantity,
        ...(typeof item.imageGeneration === "string"
          ? { imageGeneration: item.imageGeneration }
          : {}),
      }));
  } catch {
    return [];
  }
}
export function addCartItem(cart: CartItem[], item: Omit<CartItem, "quantity">): CartItem[] {
  const existing = cart.find((line) => line.productId === item.productId);
  if (existing)
    return cart.map((line) =>
      line.productId === item.productId
        ? { ...item, quantity: Math.min(99, line.quantity + 1) }
        : line,
    );
  return cart.length >= 100 ? cart : [...cart, { ...item, quantity: 1 }];
}
export function cartSubtotal(items: CartItem[]): number | null {
  const total = items.reduce((sum, item) => sum + item.priceInMinorUnits * item.quantity, 0);
  return Number.isSafeInteger(total) ? total : null;
}
export function removePurchased(
  cart: CartItem[],
  items: { productId: string; quantity: number }[],
): CartItem[] {
  return cart
    .map((line) => ({
      ...line,
      quantity:
        line.quantity - (items.find((item) => item.productId === line.productId)?.quantity ?? 0),
    }))
    .filter((line) => line.quantity > 0);
}
export function statusLabel(status: string) {
  return (
    (
      {
        CREATED: "Awaiting payment",
        PAYMENT_PENDING: "Payment processing",
        PAYMENT_FAILED: "Payment unsuccessful",
        PAID: "Payment confirmed",
        PROCESSING: "Preparing your order",
        SHIPPED: "On its way",
        DELIVERED: "Delivered",
        CANCELLED: "Cancelled",
      } as Record<string, string>
    )[status] ?? "Status unavailable"
  );
}
export function retainedOrderId(message: string) {
  return /order ([0-9a-f]{8}-[0-9a-f-]{27}) is retained/i.exec(message)?.[1];
}
export const money = (minor: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(minor / 100);
