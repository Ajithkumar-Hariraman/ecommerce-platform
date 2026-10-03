import { initializeSession, login, logout, useSession } from "./auth/session";
import { CheckoutSection } from "./features/checkout/CheckoutSection";
import { useEffect, useState } from "react";
import { categoriesApi } from "./api/categories";
import { errorMessage } from "./api/http";
import type { Category } from "./features/categories/category.types";
import { CategorySection } from "./features/categories/CategorySection";
import { ProductPage } from "./features/products/ProductPage";
function Workspace({ view }: { view: "catalog" | "checkout" }) {
  const [checkoutProducts, setCheckoutProducts] = useState<import("./features/products/product.types").Product[]>([]);
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
      <main>
        <div hidden={view !== "catalog"}>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        <ProductPage categories={categories} onProductsLoaded={setCheckoutProducts}>
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
        </ProductPage>
        </div>
        <div hidden={view !== "checkout"}>
          <CheckoutSection products={checkoutProducts} />
        </div>
      </main>

    </>
  );
}

export default function App() {
  const session = useSession();
  const [view, setView] = useState<"catalog" | "checkout">("catalog");
  useEffect(() => { void initializeSession(); }, []);
  const account = session.username && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(session.username)
    ? session.username : "Account";
  return <>
    <header className="app-header">
      <a className="brand" href="/" aria-label="Commerce home"><span className="brand-mark">C</span>Commerce</a>
      {session.authenticated && <nav className="main-nav" aria-label="Main navigation">
        <button className={view === "catalog" ? "selected" : ""} aria-current={view === "catalog" ? "page" : undefined} onClick={() => setView("catalog")}>Catalog</button>
        <button className={view === "checkout" ? "selected" : ""} aria-current={view === "checkout" ? "page" : undefined} onClick={() => setView("checkout")}>Checkout</button>
      </nav>}
      <div className="account-menu">
        <span className="badge test-badge">TEST MODE</span>
        {session.authenticated && <><span className="account-name">{account}</span><button className="subtle" onClick={() => void logout()}>Logout</button></>}
      </div>
    </header>
    {session.error && <p className="error session-error" role="alert">{session.error}</p>}
    {!session.ready ? <main><p className="empty" role="status">Checking login…</p></main>
      : session.authenticated ? <Workspace view={view} />
      : <main><section className="panel signed-out"><span className="eyebrow">COMMERCE CONSOLE</span><h1>Your workspace awaits.</h1><p>Sign in to manage your catalog and orders.</p><button onClick={() => void login()}>Login</button></section></main>}
  </>;
}
