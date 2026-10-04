import { Notifications } from "../src/commerce/Notifications";
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  parseCart,
  addCartItem,
  cartSubtotal,
  removePurchased,
  statusLabel,
  retainedOrderId,
} from "../src/commerce/cart";
import {
  canManageCatalog,
  canManageOrders,
  safeReturnPath,
  profileFromClaims,
} from "../src/auth/access";
import { Home, ProductDetails } from "../src/commerce/Storefront";
import { CartProvider } from "../src/commerce/CartProvider";
import { CartPage } from "../src/commerce/CartPage";
const id = "12345678-1234-4234-8234-123456789abc";
const item = { productId: id, name: "A product", priceInMinorUnits: 100, quantity: 2 };
test("local cart rejects corrupt, duplicate and unsafe values", () => {
  assert.deepEqual(parseCart("bad json"), []);
  assert.deepEqual(parseCart(JSON.stringify([item, { ...item }, { ...item, productId: "bad" }])), [
    item,
  ]);
  for (const value of [-1, 0, 1.5, 100, Number.MAX_SAFE_INTEGER])
    assert.deepEqual(parseCart(JSON.stringify([{ ...item, quantity: value }])), []);
  assert.deepEqual(parseCart(JSON.stringify([{ ...item, priceInMinorUnits: Infinity }])), []);
});
test("add, quantity bounds, subtotal and purchased quantity preserve new items", () => {
  assert.equal(addCartItem([item], item)[0]!.quantity, 3);
  assert.equal(addCartItem([{ ...item, quantity: 99 }], item)[0]!.quantity, 99);
  assert.equal(cartSubtotal([item]), 200);
  assert.equal(cartSubtotal([{ ...item, priceInMinorUnits: Number.MAX_SAFE_INTEGER }]), null);
  assert.deepEqual(removePurchased([{ ...item, quantity: 3 }], [{ productId: id, quantity: 2 }]), [
    { ...item, quantity: 1 },
  ]);
});
test("roles and return intent cannot confer authority or redirect off-origin", () => {
  assert.equal(canManageCatalog([]), false);
  assert.equal(canManageOrders([]), false);
  assert.equal(canManageCatalog(["catalog_manager"]), true);
  assert.equal(canManageOrders(["catalog_manager"]), false);
  assert.equal(canManageOrders(["order_manager"]), true);
  assert.equal(canManageCatalog(["admin"]), true);
  for (const path of ["https://evil.test", "//evil.test", "/\\evil", "/\nevil"])
    assert.equal(safeReturnPath(path), "/");
  assert.equal(safeReturnPath("/checkout?order=" + id), "/checkout?order=" + id);
});
test("account claims never invent verification, identity or payment success", () => {
  assert.equal(profileFromClaims({ email_verified: "true" }).emailVerified, null);
  assert.equal(profileFromClaims({ email_verified: false }).emailVerified, false);
  assert.equal(profileFromClaims({ email_verified: true }).emailVerified, true);
  assert.equal(profileFromClaims({ sub: id }).username, "");
  assert.equal(statusLabel("PAYMENT_PENDING"), "Payment processing");
  assert.equal(statusLabel("PAID"), "Payment confirmed");
  assert.equal(retainedOrderId(`Payment failed; order ${id} is retained`), id);
});
test("public home, product loading and empty cart render semantic customer UI", () => {
  const render = (node: React.ReactNode) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <CartProvider>{node}</CartProvider>
      </MemoryRouter>,
    );
  const home = render(<Home />);
  assert.match(home, /<h1>/);
  assert.match(home, /Shop the collection/);
  assert.match(home, /Loading products/);
  assert.doesNotMatch(home, /customer UUID|JWT|storage selector/i);
  assert.match(render(<ProductDetails />), /Loading product/);
  assert.match(render(<CartPage />), /Your cart is waiting/);
});

test("notifications route renders customer-facing heading and accessible loading state", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>,
  );
  assert.match(html, /<h1>Notifications<\/h1>/);
  assert.match(html, /role="status"/);
  assert.match(html, /Loading notifications/);
  assert.doesNotMatch(html, /Kafka|GCS|JWT subject/);
});
