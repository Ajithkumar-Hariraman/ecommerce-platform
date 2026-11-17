import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { storefrontApi } from "../api/storefront";
import { errorMessage } from "../api/http";
import type { Product, ProductListResponse } from "../features/products/product.types";
import { ProductImage } from "../features/products/ProductImage";
import { useSession } from "../auth/session";
import { useCart } from "./CartProvider";
import { money } from "./cart";
export function ProductVisual({ product }: { product: Product }) {
  return (
    <div className="product-visual">
      {product.image ? (
        <ProductImage
          id={product.id}
          generation={product.image.generation}
          name={product.name}
          publicRead
          large
        />
      ) : (
        <span className="product-placeholder" aria-hidden="true">
          <svg
            viewBox="0 0 64 64"
            width="80"
            height="80"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M16 22h32l4 32H12l4-32Z" />
            <path d="M23 23v-6a9 9 0 0 1 18 0v6" />
          </svg>
        </span>
      )}
    </div>
  );
}
function ProductCard({ product }: { product: Product }) {
  const cart = useCart();
  const [added, setAdded] = useState(false);
  return (
    <article className="product-card">
      <Link to={"/products/" + product.id} aria-label={"View " + product.name}>
        <ProductVisual product={product} />
      </Link>
      <div className="product-card-body">
        <h2>
          <Link to={"/products/" + product.id}>{product.name}</Link>
        </h2>
        <p className="product-description">
          {product.description || "Take a closer look at the details."}
        </p>
        <div className="product-card-bottom">
          <strong>{money(product.priceInMinorUnits)}</strong>
          <button
            type="button"
            disabled={product.stock < 1}
            onClick={() => {
              cart.add(product);
              setAdded(true);
            }}
          >
            {product.stock < 1 ? "Unavailable" : "Add to cart"}
          </button>
        </div>
        <span className="cart-feedback" role="status">
          {added ? "Added to your cart" : ""}
        </span>
      </div>
    </article>
  );
}
export function ProductCatalog({ featured = false }: { featured?: boolean }) {
  const [query, setQuery] = useSearchParams();
  const requested = Number(query.get("page") ?? 1);
  const page = featured ? 1 : Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const [data, setData] = useState<ProductListResponse>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void storefrontApi
      .list(page, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, revision]);
  const products = featured ? data?.products.slice(0, 4) : data?.products;
  return (
    <section aria-labelledby="catalog-title">
      <div className="section-heading">
        <div>
          {featured ? (
            <h2 id="catalog-title">Find something you’ll love</h2>
          ) : (
            <h1 id="catalog-title">Shop the collection</h1>
          )}
          <p className="muted">Explore everyday essentials and new favourites.</p>
        </div>
        {featured ? (
          <Link className="text-link" to="/products">
            View all products →
          </Link>
        ) : (
          <span className="muted">{data ? `${data.pagination.total} products` : ""}</span>
        )}
      </div>
      {loading ? (
        <div className="product-grid" aria-busy="true" aria-label="Loading products">
          {[1, 2, 3, 4].map((n) => (
            <div className="skeleton-card" key={n} />
          ))}
          <p className="sr-only" role="status">
            Loading products
          </p>
        </div>
      ) : error ? (
        <div className="panel empty-state">
          <p className="error" role="alert">
            {error}
          </p>
          <button onClick={() => setRevision((n) => n + 1)}>Try again</button>
        </div>
      ) : products?.length ? (
        <div className="product-grid">
          {products.map((product) => (
            <ProductCard product={product} key={product.id} />
          ))}
        </div>
      ) : (
        <div className="panel empty-state">
          <h2>No products here yet</h2>
          <p>
            {page > 1
              ? "Try an earlier page to continue browsing."
              : "Please check back soon for new arrivals."}
          </p>
        </div>
      )}
      {!featured && data && (
        <nav className="pagination" aria-label="Product pages">
          <button
            className="subtle"
            disabled={loading || !data.pagination.hasPreviousPage}
            onClick={() => setQuery({ page: String(page - 1) })}
          >
            Previous
          </button>
          <p role="status">
            Page {data.pagination.page}
            {data.pagination.totalPages ? ` of ${data.pagination.totalPages}` : ""}
          </p>
          <button
            className="subtle"
            disabled={loading || !data.pagination.hasNextPage}
            onClick={() => setQuery({ page: String(page + 1) })}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
export function Home() {
  const session = useSession();
  return (
    <>
      <section className="shop-hero">
        <div className="hero-copy">
          <span className="eyebrow">MAKE ROOM FOR YOUR NEXT FAVOURITE</span>
          <h1>
            Good finds.
            <br />
            Simple shopping.
          </h1>
          <p>Discover the collection, find what fits your day, and make it yours.</p>
          <Link className="button-link" to="/products">
            Shop the collection <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit" />
          <svg viewBox="0 0 160 180" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M35 55h90l10 110H25L35 55Z" />
            <path d="M55 58V35a25 25 0 0 1 50 0v23" />
          </svg>
          <span>Commerce</span>
        </div>
      </section>
      <div className="shop-promises">
        <span>Browse at your own pace</span>
        <span>Secure payment with Razorpay</span>
        <span>Your orders, in one place</span>
      </div>
      <ProductCatalog featured />
      <HomeAccountCallout session={session} />
    </>
  );
}
export function ProductDetails() {
  const { id } = useParams();
  const [product, setProduct] = useState<Product>();
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const cart = useCart();
  useEffect(() => {
    const controller = new AbortController();
    setProduct(undefined);
    setError("");
    setAdded(false);
    void storefrontApi
      .get(id!, controller.signal)
      .then((p) => {
        if (!controller.signal.aborted) setProduct(p);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [id]);
  if (error)
    return (
      <div className="panel empty-state">
        <h1>Product unavailable</h1>
        <p role="alert">{error}</p>
        <Link to="/products">Back to the collection</Link>
      </div>
    );
  if (!product)
    return (
      <p className="panel empty-state" role="status">
        Loading product…
      </p>
    );
  return (
    <>
      <Link className="text-link" to="/products">
        ← Back to the collection
      </Link>
      <article className="product-detail">
        <ProductVisual product={product} />
        <div className="product-detail-copy">
          <span className="eyebrow">THE COLLECTION</span>
          <h1>{product.name}</h1>
          <p className="detail-price">{money(product.priceInMinorUnits)}</p>
          <p>{product.description || "An everyday addition to your collection."}</p>
          <p className="muted">
            {product.stock > 0 ? "Available to order" : "Currently unavailable"}
          </p>
          <button
            disabled={product.stock < 1}
            onClick={() => {
              cart.add(product);
              setAdded(true);
            }}
          >
            Add to cart
          </button>
          <p role="status">
            {added ? (
              <>
                Added to your cart. <Link to="/cart">View cart</Link>
              </>
            ) : (
              ""
            )}
          </p>
        </div>
      </article>
    </>
  );
}

export function HomeAccountCallout({
  session,
}: {
  session: { ready: boolean; authenticated: boolean; unavailable: boolean };
}) {
  if (!session.ready)
    return (
      <section className="account-callout" aria-busy="true">
        <p role="status">Checking your session…</p>
      </section>
    );
  if (session.unavailable)
    return (
      <section className="account-callout">
        <p>Account access is temporarily unavailable. You can still browse the collection.</p>
        <Link to="/products">Continue shopping</Link>
      </section>
    );
  return (
    <section className="account-callout">
      <div>
        <h2>A little more personal.</h2>
        <p>
          {session.authenticated
            ? "Continue shopping or keep track of your orders."
            : "Create an account to checkout and keep track of your orders."}
        </p>
      </div>
      {session.authenticated ? (
        <>
          <Link className="button-link subtle" to="/products">
            Continue shopping
          </Link>
          <Link to="/orders">My orders</Link>
        </>
      ) : (
        <>
          <Link className="button-link subtle" to="/register">
            Create an account
          </Link>
          <Link to="/login">Sign in</Link>
        </>
      )}
    </section>
  );
}
