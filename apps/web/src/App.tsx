import { useEffect, useState } from "react";
import { categoriesApi } from "./api/categories";
import { errorMessage } from "./api/http";
import type { Category } from "./features/categories/category.types";
import { CategorySection } from "./features/categories/CategorySection";
import { ProductPage } from "./features/products/ProductPage";
export default function App() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    async function load() {
      try {
        const data = await categoriesApi.list(controller.signal);
        if (!controller.signal.aborted) setCategories(data);
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [revision]);
  return (
    <>
      <header>
        <a className="brand" href="/">
          c<span>Commerce</span>
        </a>
        <span className="workspace-label">CATALOG WORKSPACE</span>
      </header>
      <main>
        <div className="page-heading">
          <p className="eyebrow">CATALOG MANAGEMENT</p>
          <h1>A place for every product.</h1>
          <p>Manage your inventory and keep your categories organized.</p>
        </div>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <div className="workspace">
          <ProductPage categories={categories} />
          <CategorySection
            categories={categories}
            loading={loading}
            error={error}
            onRefresh={() => setRevision((n) => n + 1)}
            onCreated={() => {
              setNotice("Category created.");
              setRevision((n) => n + 1);
            }}
          />
        </div>
      </main>
      <footer>Commerce / Catalog workspace</footer>
    </>
  );
}
