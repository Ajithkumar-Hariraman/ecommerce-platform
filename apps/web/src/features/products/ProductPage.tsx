import { useEffect, useState } from "react";
import type { Product, ProductStatus } from "./product.types";
import type { Category } from "../categories/category.types";
import { productsApi } from "../../api/products";
import { errorMessage } from "../../api/http";
import { ProductForm } from "./ProductForm";
import { ProductList } from "./ProductList";
export function ProductPage({ categories }: { categories: Category[] }) {
  const [status, setStatus] = useState<ProductStatus | "ALL">("ALL");
  const [products, setProducts] = useState<Product[]>([]);
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
        const data = await productsApi.list(status, controller.signal);
        if (!controller.signal.aborted) setProducts(data);
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [status, revision]);
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
    <div className="products">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR INVENTORY</p>
            <h2>Products</h2>
          </div>
          <button
            disabled={busy}
            onClick={() => {
              setEditor(null);
              setDeleting(null);
              setNotice("");
            }}
          >
            + New product
          </button>
        </div>
        <div className="toolbar">
          <label>
            Show status
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
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
            Refresh products
          </button>
        </div>
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
        {deleting && (
          <div className="confirmation">
            <p>
              Delete <strong>{deleting.name}</strong>? This cannot be undone.
            </p>
            <div className="actions">
              <button
                className="danger"
                disabled={busy}
                onClick={() => void remove()}
              >
                {busy ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                className="subtle"
                disabled={busy}
                onClick={() => setDeleting(null)}
              >
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
          onSaved={() => {
            setEditor(undefined);
            setNotice("Product saved. The list reflects the selected status.");
            setRevision((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
