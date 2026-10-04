import { Link } from "react-router-dom";
import { useCart } from "./CartProvider";
import { cartSubtotal, money } from "./cart";
export function CartPage() {
  const cart = useCart(),
    subtotal = cartSubtotal(cart.items);
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR PICKS</span>
          <h1>Shopping cart</h1>
        </div>
        <Link className="text-link" to="/products">
          Continue shopping
        </Link>
      </div>
      {!cart.items.length ? (
        <section className="panel empty-state">
          <h2>Your cart is waiting</h2>
          <p>Discover something you love and add it here.</p>
          <Link className="button-link" to="/products">
            Browse products
          </Link>
        </section>
      ) : (
        <div className="checkout-grid">
          <section className="panel">
            <ul className="cart-lines">
              {cart.items.map((item) => (
                <li key={item.productId}>
                  <div>
                    <Link to={"/products/" + item.productId}>{item.name}</Link>
                    <p className="muted">{money(item.priceInMinorUnits)} each</p>
                  </div>
                  <label>
                    Quantity for {item.name}
                    <input
                      type="number"
                      min="1"
                      max="99"
                      step="1"
                      value={item.quantity}
                      onChange={(e) => cart.quantity(item.productId, Number(e.target.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="subtle"
                    onClick={() => cart.remove(item.productId)}
                    aria-label={"Remove " + item.name}
                  >
                    Remove
                  </button>
                  <strong>{money(item.priceInMinorUnits * item.quantity)}</strong>
                </li>
              ))}
            </ul>
          </section>
          <aside className="panel order-summary">
            <h2>Order summary</h2>
            <div className="summary-total">
              <span>Subtotal</span>
              <strong>{subtotal === null ? "Confirmed at checkout" : money(subtotal)}</strong>
            </div>
            <p className="muted">
              Availability and final prices are confirmed when your order is placed.
            </p>
            <Link className="button-link" to="/checkout">
              Proceed to checkout
            </Link>
          </aside>
        </div>
      )}
    </>
  );
}
