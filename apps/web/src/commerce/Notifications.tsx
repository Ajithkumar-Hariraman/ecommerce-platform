import { useEffect, useState } from "react";
import { Link, useOutletContext, useSearchParams } from "react-router-dom";
import { request, errorMessage } from "../api/http";
type Page = {
  notifications: {
    id: string;
    orderId: string;
    message: string;
    occurredAt: string;
    readAt: string | null;
  }[];
  pagination: {
    page: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};
export function Notifications() {
  const refreshUnread = useOutletContext<() => void>();
  const [marking, setMarking] = useState<string>();
  const [writeError, setWriteError] = useState("");
  const [query, setQuery] = useSearchParams();
  const raw = Number(query.get("page") ?? 1),
    page = Number.isSafeInteger(raw) && raw > 0 ? raw : 1;
  const [data, setData] = useState<Page>(),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void request<Page>(`/notifications?page=${page}&limit=20`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, revision]);
  function refresh() {
    setWriteError("");
    setRevision((n) => n + 1);
    refreshUnread();
  }

  async function markRead(id: string) {
    setMarking(id);
    setWriteError("");
    try {
      await request<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
      refresh();
    } catch (e) {
      setWriteError(errorMessage(e));
    } finally {
      setMarking(undefined);
    }
  }

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR ACCOUNT</span>
          <h1>Notifications</h1>
          <p className="muted">Payment confirmations and updates for your orders.</p>
        </div>
        <button className="subtle" disabled={loading || !!marking} onClick={refresh}>
          Refresh
        </button>
      </div>
      {writeError && (
        <p className="panel error" role="alert">
          {writeError}
        </p>
      )}
      {loading ? (
        <p className="panel" role="status">
          Loading notifications…
        </p>
      ) : error ? (
        <p className="panel error" role="alert">
          {error}
        </p>
      ) : data?.notifications.length ? (
        <ul className="order-list" style={{ padding: 0, listStyle: "none" }}>
          {data.notifications.map((n) => (
            <li className="panel" key={n.id}>
              <h2>{n.message}</h2>
              <p>{n.readAt ? "Read" : "Unread"}</p>
              {!n.readAt && (
                <button className="subtle" disabled={!!marking} onClick={() => void markRead(n.id)}>
                  {marking === n.id ? "Marking as read…" : "Mark as read"}
                </button>
              )}
              <time dateTime={n.occurredAt}>{new Date(n.occurredAt).toLocaleString("en-IN")}</time>
              <p>
                <Link to={"/orders/" + n.orderId}>View order</Link>
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <section className="panel empty-state">
          <h2>
            {data?.pagination.total ? "No notifications on this page" : "You’re all caught up"}
          </h2>
          {!data?.pagination.total && (
            <p>Payment confirmations will appear here after your order is paid.</p>
          )}
        </section>
      )}
      {!loading && !error && !!data?.pagination.total && (
        <nav className="pagination" aria-label="Notification pages">
          <button
            className="subtle"
            disabled={loading || !data.pagination.hasPreviousPage}
            onClick={() =>
              setQuery({ page: String(Math.min(page - 1, data.pagination.totalPages)) })
            }
          >
            Previous
          </button>
          <span>
            Page {data.pagination.page}
            {data.pagination.totalPages ? ` of ${data.pagination.totalPages}` : ""}
          </span>
          <button
            className="subtle"
            disabled={loading || !data.pagination.hasNextPage}
            onClick={() => setQuery({ page: String(page + 1) })}
          >
            Next
          </button>
        </nav>
      )}
    </>
  );
}
