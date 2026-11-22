import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useSession } from "../auth/session";
import { canManageCatalog, canManageOrders } from "../auth/access";
import { categoriesApi } from "../api/categories";
import { productsApi } from "../api/products";
import { ordersApi } from "../api/orders";
import { errorMessage } from "../api/http";
import { ProductPage } from "../features/products/ProductPage";
import { CategorySection } from "../features/categories/CategorySection";
import type { Category } from "../features/categories/category.types";
const ignoreProducts = () => {};
export function AdminLayout() {
  const session = useSession();
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <span className="eyebrow">COMMERCE OPERATIONS</span>
        <nav aria-label="Administration">
          <NavLink end to="/admin">
            Overview
          </NavLink>
          {canManageCatalog(session.roles) && (
            <>
              <NavLink to="/admin/products">Products</NavLink>
              <NavLink to="/admin/categories">Categories</NavLink>
            </>
          )}
          {canManageOrders(session.roles) && <NavLink to="/admin/orders">Orders</NavLink>}
          <Link to="/">← Storefront</Link>
        </nav>
      </aside>
      <section className="admin-content">
        <Outlet />
      </section>
    </div>
  );
}
export function AdminDashboard() {
  const session = useSession(),
    catalog = canManageCatalog(session.roles),
    orders = canManageOrders(session.roles);
  const [counts, setCounts] = useState<{ products?: number; orders?: number }>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      catalog
        ? productsApi.list("ALL", 1).then((data) => ({ products: data.pagination.total }))
        : Promise.resolve({}),
      orders
        ? ordersApi.list(1, true).then((data) => ({ orders: data.pagination.total }))
        : Promise.resolve({}),
    ])
      .then((values) => {
        if (active) setCounts(Object.assign({}, ...values));
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [catalog, orders]);
  return (
    <>
      <span className="eyebrow">OPERATIONS</span>
      <h1>Welcome to your workspace</h1>
      <p className="muted">Manage the catalog and review order activity.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="dashboard-cards">
        {catalog && (
          <Link className="panel" to="/admin/products">
            <h2>Products</h2>
            <strong>{counts.products ?? (error ? "Unavailable" : "Loading…")}</strong>
            <p>Manage your collection →</p>
          </Link>
        )}
        {orders && (
          <Link className="panel" to="/admin/orders">
            <h2>Orders</h2>
            <strong>{counts.orders ?? (error ? "Unavailable" : "Loading…")}</strong>
            <p>Review orders and payments →</p>
          </Link>
        )}
      </div>
    </>
  );
}
export function AdminCatalog({ categoriesOnly = false }: { categoriesOnly?: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void categoriesApi
      .list(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCategories(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  const section = (
    <CategorySection
      categories={categories}
      loading={loading}
      error={error}
      onRefresh={() => setRevision((n) => n + 1)}
    />
  );
  return categoriesOnly ? (
    <>
      <h1>Categories</h1>
      {section}
    </>
  ) : (
    <ProductPage categories={categories} onProductsLoaded={ignoreProducts}>
      {loading ? (
        <p role="status">Loading category choices…</p>
      ) : error ? (
        <div role="alert" className="error">
          {error}{" "}
          <button className="subtle" onClick={() => setRevision((n) => n + 1)}>
            Retry categories
          </button>
        </div>
      ) : null}
    </ProductPage>
  );
}
