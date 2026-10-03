import { useEffect, useRef, useState } from "react";
import { errorMessage, request } from "../../api/http";
import type { Product } from "../products/product.types";
type Order = { id: string; status: string; totalInMinorUnits: number };
type Checkout = {
  keyId: string;
  providerOrderId: string;
  amount: number;
  currency: string;
  orderId: string;
};
type Confirmation = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};
type Options = {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  handler: (value: Confirmation) => void;
  modal: { ondismiss: () => void };
};
declare global {
  interface Window {
    Razorpay?: new (options: Options) => {
      open(): void;
      close(): void;
      on(event: "payment.failed", handler: () => void): void;
    };
  }
}
let checkoutScript: Promise<void> | undefined;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutScript)
    checkoutScript = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () =>
        window.Razorpay
          ? resolve()
          : reject(new Error("Checkout could not load"));
      script.onerror = () => {
        script.remove();
        reject(new Error("Cannot load Razorpay Checkout"));
      };
      document.head.appendChild(script);
    }).catch((error) => {
      checkoutScript = undefined;
      throw error;
    });
  return checkoutScript;
}
export function CheckoutSection({ products }: { products: Product[] }) {
  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState<string>(() =>
    crypto.randomUUID(),
  );
  const [quantity, setQuantity] = useState(1);
  const [existingId, setExistingId] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const widget = useRef<{ close(): void } | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      widget.current?.close();
    },
    [],
  );
  async function refresh(id = order?.id) {
    if (!id) return;
    try {
      setOrder(await request<Order>("/orders/" + id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function pay(id: string) {
    const details = await request<Checkout>(`/orders/${id}/checkout`, {
      method: "POST",
    });
    await loadCheckout();
    const popup = new window.Razorpay!({
      key: details.keyId,
      order_id: details.providerOrderId,
      amount: details.amount,
      currency: details.currency,
      name: "Commerce Test Checkout",
      modal: {
        ondismiss: () => {
          setBusy(false);
          setNotice("Checkout closed. You can resume the same Order.");
        },
      },
      handler: (result) => {
        void (async () => {
          try {
            await request(`/orders/${id}/checkout/verify`, {
              method: "POST",
                      body: JSON.stringify(result),
            });
            setNotice(
              "Payment signature verified. Waiting for the signed settlement webhook.",
            );
            active.current?.abort();
            const controller = new AbortController();
            active.current = controller;
            for (
              let attempt = 0;
              attempt < 12 && !controller.signal.aborted;
              attempt++
            ) {
              const current = await request<Order>(`/orders/${id}`, {
                          signal: controller.signal,
              });
              setOrder(current);
              if (current.status === "PAID") {
                setNotice("Payment confirmed by the server.");
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, 1500));
            }
            if (!controller.signal.aborted)
              setNotice(
                "Settlement is not confirmed yet. Use Refresh status; do not create a new Order.",
              );
          } catch (e) {
            if (!active.current?.signal.aborted) setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        })();
      },
    });
    popup.on("payment.failed", () => {
      setBusy(false);
      setNotice("Payment attempt failed. Resume this Order to retry.");
      void refresh(id);
    });
    widget.current = popup;
    popup.open();
  }
  async function begin(resume: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = resume
        ? await request<Order>(`/orders/${existingId.trim()}/payment`, {
            method: "POST",
                })
        : await request<Order>("/orders", {
            method: "POST",
                  body: JSON.stringify({
              customerId,
              items: [{ productId, quantity, unitPriceInMinorUnits: 0 }],
            }),
          });
      setOrder(value);
      setExistingId(value.id);
      if (value.status === "PAID") {
        setNotice("This Order is already paid.");
        setBusy(false);
        return;
      }
      await pay(value.id);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <section className="panel checkout-panel" aria-label="Razorpay checkout">
      <div className="page-heading"><div><h1>Checkout</h1><p>Create an order and continue to Razorpay.</p></div><span className="badge test-badge">Razorpay · Test Mode</span></div>
      <p className="muted">Prices are confirmed by the server. No live money is charged in Test Mode.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void begin(false);
        }}
      >
        <label>
          Customer reference
          <input
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          />
        </label>
        <label>
          Product
          {products.length ? <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Select a product</option>
            {products.map(product => <option key={product.id} value={product.id}>{product.name} — {product.sku} — {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(product.priceInMinorUnits / 100)}</option>)}
          </select> : <input required value={productId} placeholder="Product reference (UUID)" onChange={(e) => setProductId(e.target.value)} />}
          <small>Available products reflect the currently loaded Catalog page.</small>
        </label>
        <label>
          Quantity
          <input
            required
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <button disabled={busy} type="submit">
          Create order &amp; pay
        </button>
      </form>
      <details className="disclosure"><summary>Resume existing order</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void begin(true);
        }}
      >
        <label>
          Order reference
          <input
            required
            value={existingId}
            onChange={(e) => setExistingId(e.target.value)}
          />
        </label>
        <button disabled={busy} type="submit">
          Resume checkout
        </button>
      </form>
      </details>
      {order && (
        <p className="order-result">
          Order {order.id} · {order.status} · INR{" "}
          {(order.totalInMinorUnits / 100).toFixed(2)}{" "}
          <button type="button" onClick={() => void refresh()}>
            Refresh status
          </button>
        </p>
      )}
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
