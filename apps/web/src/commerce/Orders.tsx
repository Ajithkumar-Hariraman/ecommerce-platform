import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ordersApi, type Order, type OrderList } from "../api/orders";
import { downloadOrderDocument, errorMessage } from "../api/http";
import { money, statusLabel } from "./cart";
export function Orders({ admin = false }: { admin?: boolean }) {
  const [query, setQuery] = useSearchParams();
  const n = Number(query.get("page") ?? 1),
    page = Number.isSafeInteger(n) && n > 0 ? n : 1;
  const [data, setData] = useState<OrderList>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void ordersApi
      .list(page, admin, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [page, admin, revision]);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{admin ? "OPERATIONS" : "YOUR ACCOUNT"}</span>
          <h1>{admin ? "Orders" : "My orders"}</h1>
          <p className="muted">
            {admin
              ? "Review orders and payment status."
              : "Follow every order from checkout to confirmation."}
          </p>
        </div>
        <button className="subtle" disabled={busy} onClick={() => setRevision((n) => n + 1)}>
          Refresh orders
        </button>
      </div>
      {busy ? (
        <p role="status" className="panel empty-state">
          Loading orders…
        </p>
      ) : error ? (
        <p role="alert" className="error panel">
          {error}
        </p>
      ) : !data?.orders.length ? (
        <section className="panel empty-state">
          <h2>No orders on this page</h2>
          <p>Your orders will appear here after checkout.</p>
          <Link to="/products">Browse the collection</Link>
        </section>
      ) : (
        <div className="order-list">
          {data.orders.map((order) => (
            <article className="panel order-card" key={order.id}>
              <div>
                <h2>
                  <Link to={(admin ? "/admin/orders/" : "/orders/") + order.id}>
                    Order #{order.id.slice(0, 8).toUpperCase()}
                  </Link>
                </h2>
                <time dateTime={order.createdAt}>
                  {new Date(order.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}
                </time>
              </div>
              <span className="badge">{statusLabel(order.status)}</span>
              <strong>{money(order.totalInMinorUnits)}</strong>
              <Link className="text-link" to={(admin ? "/admin/orders/" : "/orders/") + order.id}>
                View details →
              </Link>
            </article>
          ))}
        </div>
      )}
      {data && (
        <nav className="pagination" aria-label="Order pages">
          <button
            className="subtle"
            disabled={busy || !data.pagination.hasPreviousPage}
            onClick={() => setQuery({ page: String(page - 1) })}
          >
            Previous
          </button>
          <p>
            Page {data.pagination.page}
            {data.pagination.totalPages ? ` of ${data.pagination.totalPages}` : ""}
          </p>
          <button
            className="subtle"
            disabled={busy || !data.pagination.hasNextPage}
            onClick={() => setQuery({ page: String(page + 1) })}
          >
            Next
          </button>
        </nav>
      )}
    </>
  );
}
export function OrderDetails({ admin = false }: { admin?: boolean }) {
  const { id } = useParams();
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [downloading, setDownloading] = useState(false),
    [documentError, setDocumentError] = useState("");
  async function download(kind: "invoice" | "receipt") {
    setDownloading(true);
    setDocumentError("");
    try {
      await downloadOrderDocument(id!, kind);
    } catch (e) {
      setDocumentError(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setOrder(undefined);
    void ordersApi
      .get(id!, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setOrder(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [id, revision]);
  if (error)
    return (
      <section className="panel empty-state">
        <h1>Order unavailable</h1>
        <p role="alert">{error}</p>
        <Link to={admin ? "/admin/orders" : "/orders"}>Back to orders</Link>
      </section>
    );
  if (!order)
    return (
      <p role="status" className="panel empty-state">
        Loading your order…
      </p>
    );
  return (
    <>
      <Link to={admin ? "/admin/orders" : "/orders"}>← Back to orders</Link>
      <div className="section-heading">
        <div>
          <h1>Order #{order.id.slice(0, 8).toUpperCase()}</h1>
          <time dateTime={order.createdAt}>
            {new Date(order.createdAt).toLocaleString("en-IN")}
          </time>
        </div>
        <button className="subtle" onClick={() => setRevision((n) => n + 1)}>
          Refresh status
        </button>
      </div>
      <section className="panel">
        <p className="notice" role="status">
          {statusLabel(order.status)}
        </p>
        <ul className="cart-lines">
          {order.items.map((item, index) => (
            <li key={index}>
              <Link to={"/products/" + item.productId}>
                {item.name ?? "View purchased product"}
              </Link>
              <span>Quantity {item.quantity}</span>
              <strong>{money(item.lineTotalInMinorUnits)}</strong>
            </li>
          ))}
        </ul>
        <div className="summary-total">
          <span>Order total</span>
          <strong>{money(order.totalInMinorUnits)}</strong>
        </div>
        <div className="actions">
          <button
            className="subtle"
            disabled={downloading}
            onClick={() => void download("invoice")}
          >
            {downloading ? "Preparing document…" : "Download invoice"}
          </button>
          {order.status === "PAID" && (
            <button
              className="subtle"
              disabled={downloading}
              onClick={() => void download("receipt")}
            >
              Download receipt
            </button>
          )}
        </div>
        {documentError && (
          <p className="error" role="alert">
            {documentError}
          </p>
        )}
        {!admin && ["CREATED", "PAYMENT_PENDING", "PAYMENT_FAILED"].includes(order.status) && (
          <Link className="button-link" to={"/checkout?order=" + order.id}>
            Continue payment
          </Link>
        )}
      </section>
    </>
  );
}
