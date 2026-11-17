import { SessionNotice } from "./auth/SessionNotice";
import { Notifications } from "./commerce/Notifications";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { initializeSession, logout, useSession } from "./auth/session";
import { canManageCatalog, canManageOrders } from "./auth/access";
import { CartProvider, useCart } from "./commerce/CartProvider";
import { Home, ProductCatalog, ProductDetails } from "./commerce/Storefront";
import { CartPage } from "./commerce/CartPage";
import { Orders, OrderDetails } from "./commerce/Orders";
import { Account, SignIn } from "./commerce/Account";
import { AdminCatalog, AdminDashboard, AdminLayout } from "./commerce/Admin";
import { CheckoutSection } from "./features/checkout/CheckoutSection";
function Gate({
  children,
  permission,
}: {
  children: ReactNode;
  permission?: "catalog" | "orders" | "admin";
}) {
  const session = useSession(),
    location = useLocation();
  if (!session.ready)
    return (
      <p role="status" className="panel empty-state">
        Checking your session…
      </p>
    );
  if (!session.authenticated)
    return (
      <section className="panel empty-state">
        <h1>Sign in to continue</h1>
        <p>Your account keeps checkout and orders together.</p>
        <Link
          className="button-link"
          to={"/login?returnTo=" + encodeURIComponent(location.pathname + location.search)}
        >
          Sign in
        </Link>
        <p>
          New here? <Link to="/register">Create an account</Link>
        </p>
      </section>
    );
  const allowed =
    !permission ||
    (permission === "catalog"
      ? canManageCatalog(session.roles)
      : permission === "orders"
        ? canManageOrders(session.roles)
        : canManageCatalog(session.roles) || canManageOrders(session.roles));
  return allowed ? (
    children
  ) : (
    <section className="panel empty-state">
      <h1>Access restricted</h1>
      <p>This area is available to authorised staff.</p>
      <Link to="/">Return to the store</Link>
    </section>
  );
}
function Layout() {
  const session = useSession(),
    cart = useCart(),
    location = useLocation();
  const [menu, setMenu] = useState(false);
  const main = useRef<HTMLElement>(null);
  const admin = canManageCatalog(session.roles) || canManageOrders(session.roles);
  useEffect(() => {
    setMenu(false);
    const title = location.pathname.startsWith("/admin")
      ? "Operations"
      : location.pathname.startsWith("/products/")
        ? "Product details"
        : ((
            {
              "/": "Home",
              "/products": "Products",
              "/cart": "Cart",
              "/checkout": "Checkout",
              "/orders": "My orders",
              "/account": "My account",
              "/notifications": "Notifications",
              "/login": "Sign in",
              "/register": "Create account",
            } as Record<string, string>
          )[location.pathname] ?? "Order details");
    document.title = title + " · Commerce";
    main.current?.focus();
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="store-header">
        <Link className="brand" to="/" aria-label="Commerce home">
          <span className="brand-mark">C</span>Commerce<span className="brand-dot">.</span>
        </Link>
        <button
          className="mobile-menu subtle"
          aria-expanded={menu}
          aria-controls="store-navigation"
          onClick={() => setMenu((open) => !open)}
        >
          Menu
        </button>
        <nav
          id="store-navigation"
          className={"store-nav" + (menu ? " is-open" : "")}
          aria-label="Main navigation"
        >
          <NavLink end to="/">
            Home
          </NavLink>
          <NavLink to="/products">Shop</NavLink>
          <NavLink to="/cart">
            Cart{" "}
            <span className="cart-count">
              {cart.items.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
          </NavLink>
          {!session.ready ? (
            <span role="status">Checking your session…</span>
          ) : session.authenticated ? (
            <>
              <NavLink to="/orders">My orders</NavLink>
              <NavLink to="/account">My account</NavLink>
              <NavLink to="/notifications">Notifications</NavLink>
              {admin && <NavLink to="/admin">Operations</NavLink>}
              <button className="subtle" onClick={() => void logout()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login">Sign in</NavLink>
              <Link className="button-link small" to="/register">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>
      <SessionNotice pathname={location.pathname} error={session.error} />
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className={
          location.pathname.startsWith("/admin")
            ? "page-container admin-page-container"
            : "page-container"
        }
      >
        <Outlet />
      </main>
      <footer className="store-footer">
        <Link className="brand" to="/">
          Commerce.
        </Link>
        <p>Find your next everyday favourite.</p>
        <nav aria-label="Footer navigation">
          <Link to="/products">Shop</Link>
          {session.ready &&
            (session.authenticated ? (
              <>
                <Link to="/orders">My orders</Link>
                <Link to="/account">My account</Link>
              </>
            ) : (
              <>
                <Link to="/login">Sign in</Link>
                <Link to="/register">Create account</Link>
              </>
            ))}
        </nav>
        <small>Payments handled securely by Razorpay.</small>
      </footer>
    </>
  );
}
export default function App() {
  useEffect(() => {
    void initializeSession();
  }, []);
  return (
    <CartProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="products" element={<ProductCatalog />} />
          <Route path="shop" element={<ProductCatalog />} />
          <Route path="products/:id" element={<ProductDetails />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="login" element={<SignIn />} />
          <Route path="register" element={<SignIn registration />} />
          <Route
            path="checkout"
            element={
              <Gate>
                <CheckoutSection />
              </Gate>
            }
          />
          <Route
            path="orders"
            element={
              <Gate>
                <Orders />
              </Gate>
            }
          />
          <Route
            path="orders/:id"
            element={
              <Gate>
                <OrderDetails />
              </Gate>
            }
          />
          <Route
            path="account"
            element={
              <Gate>
                <Account />
              </Gate>
            }
          />
          <Route
            path="notifications"
            element={
              <Gate>
                <Notifications />
              </Gate>
            }
          />
          <Route
            path="admin"
            element={
              <Gate permission="admin">
                <AdminLayout />
              </Gate>
            }
          >
            <Route index element={<AdminDashboard />} />
            <Route
              path="products"
              element={
                <Gate permission="catalog">
                  <AdminCatalog />
                </Gate>
              }
            />
            <Route
              path="categories"
              element={
                <Gate permission="catalog">
                  <AdminCatalog categoriesOnly />
                </Gate>
              }
            />
            <Route
              path="orders"
              element={
                <Gate permission="orders">
                  <Orders admin />
                </Gate>
              }
            />
            <Route
              path="orders/:id"
              element={
                <Gate permission="orders">
                  <OrderDetails admin />
                </Gate>
              }
            />
          </Route>
          <Route
            path="*"
            element={
              <section className="panel empty-state">
                <h1>Page not found</h1>
                <Link to="/">Return home</Link>
              </section>
            }
          />
        </Route>
      </Routes>
    </CartProvider>
  );
}
