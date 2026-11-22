import { useEffect, useState, type ReactNode } from "react";
import type { Product, ProductStatus, ProductListResponse } from "./product.types";
import type { Category } from "../categories/category.types";
import { productsApi } from "../../api/products";
import { errorMessage } from "../../api/http";
import { ProductImport } from "./ProductImport";
import { ProductForm } from "./ProductForm";
import { ProductList } from "./ProductList";
export function ProductPage({
  categories,
  children,
  onProductsLoaded,
}: {
  categories: Category[];
  children: ReactNode;
  onProductsLoaded: (products: Product[]) => void;
}) {
  const [status, setStatus] = useState<ProductStatus | "ALL">("ALL");
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<ProductListResponse["pagination"] | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Product | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Product | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function load() {
      try {
        const data = await productsApi.list(status, page, controller.signal);
        if (!controller.signal.aborted) {
          setProducts(data.products);
          onProductsLoaded(data.products);
          setPagination(data.pagination);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [status, page, revision, onProductsLoaded]);
  async function edit(id: string) {
    setBusy(true);
    setError("");
    try {
      setEditor(await productsApi.get(id));
      setDeleting(null);
      setNotice("");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setError("");
    try {
      await productsApi.remove(deleting.id);
      setDeleting(null);
      setEditor(undefined);
      setNotice("Product deleted.");
      setRevision((n) => n + 1);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Catalog</h1>
          <p>Manage products, inventory and categories.</p>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setEditor(null);
            setDeleting(null);
            setNotice("");
          }}
        >
          + Add product
        </button>
      </div>
      <div className="summary-grid" aria-label="Catalog summary">
        <div className="stat-card">
          <span>Total Products</span>
          <strong>{loading || error ? "—" : (pagination?.total ?? "—")}</strong>
          <small>Matching current status</small>
        </div>
        <div className="stat-card">
          <span>Active Products</span>
          <strong>
            {loading || error ? "—" : products.filter((p) => p.status === "ACTIVE").length}
          </strong>
          <small>On this page</small>
        </div>
        <div className="stat-card">
          <span>Low Stock</span>
          <strong>{loading || error ? "—" : products.filter((p) => p.stock < 10).length}</strong>
          <small>Below 10 · on this page</small>
        </div>
        <div className="stat-card">
          <span>Categories</span>
          <strong>{categories.length}</strong>
          <small>Loaded categories</small>
        </div>
      </div>
      <div className="workspace">
        <div className="products">
          <section className="panel">
            <div className="section-heading">
              <h2>Products</h2>
              <span className="muted">Inventory overview</span>
            </div>
            <div className="toolbar">
              <label>
                Show status
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value as typeof status);
                    setPage(1);
                    setPagination(null);
                  }}
                >
                  <option value="ALL">ALL</option>
                  <option>ACTIVE</option>
                  <option>INACTIVE</option>
                </select>
              </label>
              <button
                className="subtle"
                disabled={loading}
                onClick={() => setRevision((n) => n + 1)}
              >
                Refresh
              </button>
            </div>
            <ProductImport onFinished={() => setRevision((n) => n + 1)} />
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {loading ? (
              <p className="empty" role="status">
                Loading products…
              </p>
            ) : (
              !error && (
                <ProductList
                  products={products}
                  categories={categories}
                  busy={busy}
                  onEdit={(id) => void edit(id)}
                  onDelete={(product) => {
                    setDeleting(product);
                    setEditor(undefined);
                  }}
                />
              )
            )}
            {pagination && (
              <nav className="toolbar pagination" aria-label="Product pagination">
                <button
                  className="subtle"
                  disabled={
                    loading ||
                    busy ||
                    !!error ||
                    !pagination.hasPreviousPage ||
                    pagination.page !== page
                  }
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Previous
                </button>
                <span aria-live="polite">
                  Page {page} · {pagination.total} products · {pagination.totalPages} pages
                </span>
                <button
                  className="subtle"
                  disabled={
                    loading ||
                    busy ||
                    !!error ||
                    !pagination.hasNextPage ||
                    pagination.page !== page
                  }
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </button>
              </nav>
            )}
            {deleting && (
              <div className="confirmation">
                <p>
                  Delete <strong>{deleting.name}</strong>? This cannot be undone.
                </p>
                <div className="actions">
                  <button className="danger" disabled={busy} onClick={() => void remove()}>
                    {busy ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button className="subtle" disabled={busy} onClick={() => setDeleting(null)}>
                    Cancel deletion
                  </button>
                </div>
              </div>
            )}
          </section>
          {editor !== undefined && (
            <ProductForm
              key={editor?.id ?? "new"}
              product={editor}
              categories={categories}
              onCancel={() => setEditor(undefined)}
              onImageFailed={() => setRevision((n) => n + 1)}
              onSaved={() => {
                setEditor(undefined);
                setNotice("Product saved. The list reflects the selected status.");
                setRevision((n) => n + 1);
              }}
            />
          )}
        </div>
        {children}
      </div>
    </>
  );
}
