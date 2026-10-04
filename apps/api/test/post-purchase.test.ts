import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  renderOrderPdf,
  OrderDocumentService,
  documentNumber,
} from "../src/post-purchase/documents.js";
import {
  confirmationEmail,
  PostPurchaseNotificationProcessor,
} from "../src/post-purchase/email.js";
import { orderPaid } from "../src/events/order-paid.js";
import type { Order } from "../src/modules/orders/order.types.js";
const order: Order = {
  id: randomUUID(),
  customerId: null,
  ownerSubject: "alice",
  customer: { name: "Customer <test>", email: "test@example.invalid" },
  items: [
    {
      productId: randomUUID(),
      name: "A & B",
      quantity: 2,
      unitPriceInMinorUnits: 100,
      lineTotalInMinorUnits: 200,
    },
  ],
  status: "PAID",
  paymentId: randomUUID(),
  version: 2,
  totalInMinorUnits: 200,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
function fixture() {
  const bytes = new Map<string, Buffer>();
  let state: any = null;
  let sends = 0;
  let failure: unknown;
  const repo: any = {
    paidInfo: async () => ({ paidAt: order.updatedAt, providerPaymentId: "pay_test" }),
    state: async () => state,
    claim: async () => {
      if (state && state !== "PENDING") return false;
      state = "SENDING";
      return true;
    },
    finish: async (_id: string, s: any) => {
      state = s;
    },
  };
  const orders: any = { findById: async () => order };
  const documents = new OrderDocumentService(
    orders,
    repo,
    {
      putIfAbsent: async (k, b) => {
        if (!bytes.has(k)) bytes.set(k, b);
      },
      read: async (k) => bytes.get(k)!,
    },
    "Commerce",
  );
  const sender: any = {
    send: async () => {
      sends++;
      if (failure) throw failure;
    },
    close: () => {},
  };
  const processor = new PostPurchaseNotificationProcessor(
    { process: async () => (sends ? "duplicate" : "processed") },
    orders,
    repo,
    documents,
    sender,
    "Commerce",
  );
  return {
    repo,
    documents,
    processor,
    get state() {
      return state;
    },
    get sends() {
      return sends;
    },
    fail(e: unknown) {
      failure = e;
    },
  };
}
test("PDF invoice and receipt are real bounded PDF documents; pending receipt forbidden", async () => {
  const pdf = await renderOrderPdf(order, "invoice", "Commerce");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert(pdf.length < 2 * 1024 * 1024);
  const receipt = await renderOrderPdf(order, "receipt", "Commerce", { paidAt: order.updatedAt });
  assert.equal(receipt.subarray(0, 5).toString(), "%PDF-");
  await assert.rejects(
    renderOrderPdf({ ...order, status: "PAYMENT_PENDING" }, "receipt", "Commerce"),
    { statusCode: 409 },
  );
  assert.equal(documentNumber("invoice", order.id), "INV-" + order.id.toUpperCase());
  assert.equal(documentNumber("receipt", order.id), "RCT-" + order.id.toUpperCase());
});
test("private document access denies unrelated users before storage; owner/staff allowed", async () => {
  const f = fixture();
  await assert.rejects(
    f.documents.forOwner(order.id, "invoice", { subject: "bob", roles: [], scopes: [] }),
    { statusCode: 404 },
  );
  for (const actor of [
    { subject: "alice", roles: [], scopes: [] },
    { subject: "bob", roles: ["order_manager"], scopes: [] },
  ])
    assert((await f.documents.forOwner(order.id, "receipt", actor)).length > 0);
});
test("confirmation plain text + escaped HTML includes persisted total and PDF attachments", () => {
  const email = confirmationEmail(order, "Commerce", Buffer.from("pdf"), Buffer.from("pdf"));
  assert.match(email.text, /INR 2.00/);
  assert.match(email.html, /Customer &lt;test&gt;/);
  assert.match(email.html, /A &amp; B/);
  assert.equal(email.attachments.length, 2);
  assert.equal(email.to, order.customer!.email);
  assert.equal(
    email.messageId,
    confirmationEmail(order, "Commerce", Buffer.alloc(0), Buffer.alloc(0)).messageId,
  );
});
const event = orderPaid({
  eventId: randomUUID(),
  type: "payment.succeeded",
  paymentId: order.paymentId!,
  orderId: order.id,
  occurredAt: order.updatedAt,
});
test("duplicate deliveries and concurrent event processing send only once", async () => {
  const f = fixture();
  await Promise.allSettled([f.processor.process(event), f.processor.process(event)]);
  await f.processor.process(event);
  assert.equal(f.sends, 1);
  assert.equal(f.state, "SENT");
});
test("pre-acceptance SMTP failure can retry; uncertain DATA outcome never auto-resends", async () => {
  const f = fixture();
  f.fail({ command: "CONN" });
  await assert.rejects(f.processor.process(event), /SMTP unavailable/);
  assert.equal(f.state, "PENDING");
  f.fail(undefined);
  await f.processor.process(event);
  assert.equal(f.state, "SENT");
  const uncertain = fixture();
  uncertain.fail({ command: "DATA" });
  await assert.rejects(uncertain.processor.process(event), /uncertain/);
  assert.equal(uncertain.state, "UNCERTAIN");
  await assert.rejects(uncertain.processor.process(event), /reconciliation/);
  assert.equal(uncertain.sends, 1);
});

test("SMTP configuration rejects header injection, missing auth pair and invalid ports", async () => {
  const { loadPostPurchaseConfig } = await import("../src/config/env.js");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_FROM: "Commerce <orders@commerce.local>",
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      ORDER_DOCUMENT_BUCKET: "",
    });
    assert.equal(loadPostPurchaseConfig().port, 1025);
    for (const [name, value] of [
      ["SMTP_PORT", "0"],
      ["SMTP_PORT", "65536"],
      ["SMTP_FROM", "orders@example.test\\r\\nBcc: bad@example.test"],
      ["SMTP_USER", "unpaired"],
    ]) {
      const old = process.env[name!];
      process.env[name!] = value;
      assert.throws(loadPostPurchaseConfig);
      process.env[name!] = old;
    }
  } finally {
    process.env = saved;
  }
});

test("accepted SMTP message is never auto-resent after delivery-state persistence failure", async () => {
  const f = fixture();
  const finish = f.repo.finish;
  f.repo.finish = async (id: string, state: string) => {
    if (state === "SENT") throw new Error("DB disconnected");
    return finish(id, state);
  };
  await assert.rejects(f.processor.process(event), /confirmation persistence unavailable/);
  assert.equal(f.state, "SENDING");
  await assert.rejects(f.processor.process(event), /in progress or uncertain/);
  assert.equal(f.sends, 1);
});
