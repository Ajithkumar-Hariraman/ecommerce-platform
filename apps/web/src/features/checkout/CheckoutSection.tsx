import { SimulatorActions } from "./SimulatorActions";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ordersApi, type Order, type CheckoutConfig } from "../../api/orders";
import { ApiError, errorMessage, request } from "../../api/http";
import { useCart } from "../../commerce/CartProvider";
import { cartSubtotal, money, retainedOrderId, statusLabel } from "../../commerce/cart";
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
        window.Razorpay ? resolve() : reject(new Error("Checkout could not load"));
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
export function CheckoutSection() {
  const cart = useCart();
  const [query, setQuery] = useSearchParams();
  const resumeId = query.get("order");
  const [config, setConfig] = useState<CheckoutConfig>();
  const [configError, setConfigError] = useState("");
  const actionInProgress = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void ordersApi
      .checkoutConfig(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setConfig(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setConfigError(errorMessage(e));
      });
    return () => controller.abort();
  }, []);
  const [order, setOrder] = useState<Order | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(!!resumeId),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const widget = useRef<{ close(): void } | null>(null),
    mounted = useRef(true),
    settled = useRef<string | null>(null),
    pending = useRef<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      widget.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!resumeId) {
      setOrder(null);
      setLoading(false);
      return;
    }
    if (order?.id === resumeId) {
      setLoading(false);
      return;
    }
    setOrder(null);
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void ordersApi
      .get(resumeId, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setOrder(value);
          setNotice(value.status === "PAID" ? "Your payment is confirmed." : "");
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [resumeId]);
  useEffect(() => {
    if (order && order.status !== "PAID") pending.current = order.id;
    if (order?.status === "PAID" && pending.current === order.id && settled.current !== order.id) {
      settled.current = order.id;
      cart.purchased(order.items);
    }
  }, [order, cart]);
  useEffect(() => {
    if (
      !order ||
      (order.status !== "PAYMENT_PENDING" &&
        !(config?.provider === "razorpay" && order.status === "PAYMENT_FAILED"))
    ) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void ordersApi
        .get(order.id, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) updateOrder(value);
        })
        .catch(() => {});
    }, 2500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [order?.id, order?.status, config?.provider]);
  async function simulate(outcome: "succeed" | "fail") {
    if (!order || !config?.simulationEnabled || actionInProgress.current) return;
    actionInProgress.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = await ordersApi.simulate(order.id, outcome);
      if (mounted.current) {
        setOrder(value);
        setNotice(
          value.status === "PAID"
            ? "Your simulated payment is confirmed. No money was charged."
            : value.status === "PAYMENT_FAILED"
              ? "Simulation finished with a failed payment. No money was charged."
              : "Waiting for the simulator confirmation. Refresh this order before retrying.",
        );
      }
    } catch (e) {
      if (mounted.current) {
        await refresh(order.id);
        setError(errorMessage(e));
      }
    } finally {
      actionInProgress.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const currentItems = order?.items ?? cart.items;
  const total = order?.totalInMinorUnits ?? cartSubtotal(cart.items);
  function updateOrder(value: Order) {
    setOrder((current) => current?.id === value.id && current.version <= value.version ? value : current);
  }
  async function refresh(id = order?.id) {
    if (!id) return;
    setError("");
    try {
      const value = await ordersApi.get(id);
      if (mounted.current) updateOrder(value);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    }
  }
  async function pay(id: string) {
    if (config?.provider !== "razorpay")
      throw new Error("Razorpay is not configured for this checkout");
    let details: Checkout;
    try {
      details = await request<Checkout>(`/orders/${id}/checkout`, { method: "POST" });
    } catch (error) {
      await refresh(id);
      throw error;
    }
    await loadCheckout();
    if (!mounted.current) return;
    let submitted = false;
    const popup = new window.Razorpay!({
      key: details.keyId,
      order_id: details.providerOrderId,
      amount: details.amount,
      currency: details.currency,
      name: "Commerce",
      modal: {
        ondismiss: () => {
          if (submitted || !mounted.current || widget.current !== popup) return;
          widget.current = null;
          setBusy(false);
          setNotice("Payment window closed. Your order is saved and you can continue later.");
          void refresh(id);
        },
      },
      handler: (result) => {
        if (submitted || !mounted.current || widget.current !== popup) return;
        submitted = true;
        setNotice("Checking payment status…");
        void (async () => {
          try {
            const confirmation = await request<{ paymentStatus: "PAID" | "AWAITING_CAPTURE" }>(
              `/orders/${id}/checkout/verify`,
              { method: "POST", body: JSON.stringify(result) },
            );
            await refresh(id);
            if (mounted.current)
              setNotice(confirmation.paymentStatus === "AWAITING_CAPTURE"
                ? "Payment was authorized. Wait for capture confirmation before trying again."
                : "");
          } catch {
            await refresh(id);
            if (mounted.current)
              setError("We couldn’t confirm payment yet. Check your saved order status.");
          } finally {
            widget.current = null;
            if (mounted.current) setBusy(false);
          }
        })();
      },
    });
    popup.on("payment.failed", () => {
      if (mounted.current && widget.current === popup && !submitted) {
        setNotice("This payment attempt failed. You can try again in checkout or close the payment window.");
        void refresh(id);
      }
    });
    widget.current = popup;
    popup.open();
  }
  async function begin() {
    if (
      !config ||
      busy ||
      actionInProgress.current ||
      (config.provider === "local" && !config.simulationEnabled)
    )
      return;
    actionInProgress.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const value = order
        ? await ordersApi.resume(order.id)
        : await ordersApi.create(
            cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          );
      if (!mounted.current) return;
      setOrder(value);
      setQuery({ order: value.id }, { replace: true });
      if (value.status === "PAID") {
        setNotice("Your payment is already confirmed.");
        setBusy(false);
        return;
      }
      if (config.provider === "local") {
        setNotice(
          value.status === "PAYMENT_FAILED"
            ? "This simulation has finished. Start a new order to try another payment."
            : "Order saved. Choose a simulated payment outcome below; no money will be charged.",
        );
        setBusy(false);
      } else await pay(value.id);
    } catch (e) {
      if (!mounted.current) return;
      const retained = e instanceof Error ? retainedOrderId(e.message) : undefined;
      if (retained) setQuery({ order: retained }, { replace: true });
      setError(
        e instanceof ApiError && (e.status === 502 || e.status === 503)
          ? "Payment is temporarily unavailable. Your order is saved in My Orders; continue it there instead of placing another order."
          : errorMessage(e),
      );
      setBusy(false);
    } finally {
      actionInProgress.current = false;
    }
  }
  if (loading)
    return (
      <p className="panel empty-state" role="status">
        Loading your checkout…
      </p>
    );
  if (resumeId && !order)
    return (
      <section className="panel empty-state">
        <h1>Checkout unavailable</h1>
        <p role="alert">{error || "We couldn’t load this order."}</p>
        <Link to="/orders">Go to My Orders</Link>
      </section>
    );
  if (!order && !cart.items.length)
    return (
      <section className="panel empty-state">
        <h1>Your cart is empty</h1>
        <p>Add a product to begin checkout.</p>
        <Link className="button-link" to="/products">
          Browse products
        </Link>
      </section>
    );
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">ALMOST YOURS</span>
          <h1>{order?.status === "PAID" ? "Thank you for your order" : "Checkout"}</h1>
          <p className="muted">
            {order
              ? `Order #${order.id.slice(0, 8).toUpperCase()}`
              : "Review your items before continuing to secure payment."}
          </p>
        </div>
        <Link to="/orders">My orders</Link>
      </div>
      <div className="checkout-grid">
        <section className="panel">
          <h2>Your items</h2>
          <ul className="cart-lines">
            {currentItems.map((item, index) => {
              const name =
                ("name" in item ? item.name : undefined) ??
                cart.items.find((line) => line.productId === item.productId)?.name ??
                "Purchased product";
              return (
                <li key={index}>
                  <Link to={"/products/" + item.productId}>{name}</Link>
                  <span>Quantity {item.quantity}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted">
            {config?.provider === "local"
              ? "Local payment simulation. No money is charged."
              : config?.provider === "razorpay"
                ? "Razorpay Test Mode. Use test payment details only."
                : "Loading payment options…"}{" "}
            Final prices are confirmed by the server.
          </p>
        </section>
        <aside className="panel order-summary">
          <h2>{order?.status === "PAID" ? "Payment confirmed" : "Order summary"}</h2>
          <div className="summary-total">
            <span>{order ? "Total" : "Estimated subtotal"}</span>
            <strong>{total === null ? "Confirmed at checkout" : money(total)}</strong>
          </div>
          {order && (
            <p role="status">
              {order.status === "PAYMENT_PENDING" && config?.provider === "local"
                ? "Awaiting simulated payment"
                : statusLabel(order.status)}
            </p>
          )}
          {configError && <p role="alert">{configError}</p>}
          {order && total !== null && total <= 0 && (
            <p role="alert">
              Saved order pricing needs repair before payment. Your order has been retained.
            </p>
          )}
          {config?.provider === "local" && !config.simulationEnabled && (
            <p role="alert">Local simulation is unavailable in this environment.</p>
          )}
          {order?.status === "PAID" ? (
            <Link className="button-link" to={"/orders/" + order.id}>
              View your order
            </Link>
          ) : config?.provider === "local" &&
            order &&
            ["PAYMENT_PENDING", "PAYMENT_FAILED"].includes(order.status) ? (
            <SimulatorActions
              status={order.status}
              busy={busy || !config.simulationEnabled || total === null || total <= 0}
              onOutcome={(outcome) => void simulate(outcome)}
            />
          ) : (
            <button
              disabled={
                busy || !config || (config.provider === "local" && !config.simulationEnabled)
              }
              onClick={() => void begin()}
            >
              {busy
                ? "Processing…"
                : order
                  ? "Continue payment"
                  : config?.provider === "local"
                    ? "Place order & simulate payment"
                    : "Place order & pay"}
            </button>
          )}
          {order && (
            <button className="subtle" disabled={busy} onClick={() => void refresh()}>
              Refresh status
            </button>
          )}
        </aside>
      </div>
      {notice && order?.status !== "PAID" && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && order?.status !== "PAID" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
