import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createClient } from "redis";
import { MongoClient } from "mongodb";
assert.equal(process.env.DB_NAME, "ecommerce_test", "Smoke verification must use ecommerce_test");
assert.equal(process.env.MONGODB_DB_NAME, "ecommerce_test", "Smoke verification must use ecommerce_test");
const storage = process.env.ORDER_STORAGE;
assert(["postgres", "mongodb"].includes(storage));
const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
const redis = createClient({ url: process.env.REDIS_URL }); redis.on("error", () => { });
const mongo = new MongoClient(process.env.MONGODB_URI);
const db = mongo.db(process.env.MONGODB_DB_NAME);
const useMongo = storage === "mongodb";
const cacheDatabase = useMongo
    ? process.env.MONGODB_URI + "/" + process.env.MONGODB_DB_NAME
    : process.env.DB_HOST + ":" + process.env.DB_PORT + "/" + process.env.DB_NAME;
const cacheNamespace = storage + ":" + createHash("sha256").update(cacheDatabase).digest("hex").slice(0, 16);
let product, order, eventId, cacheKey;
const outboxStatus = async () => useMongo
    ? (await db.collection("orders").findOne({ _id: order.id }))?.outbox?.status
    : (await pool.query("SELECT status FROM outbox_events WHERE event_id=$1", [eventId])).rows[0]?.status;
const notificationCount = async () => useMongo
    ? db.collection("order_notifications").countDocuments({ _id: eventId })
    : (await pool.query("SELECT count(*)::int AS n FROM order_notifications WHERE event_id=$1", [eventId])).rows[0].n;
const emailState = async () => useMongo
    ? (await db.collection("order_email_deliveries").findOne({ _id: order.id }))?.state
    : (await pool.query("SELECT state FROM order_email_deliveries WHERE order_id=$1", [order.id])).rows[0]?.state;
const base = "http://api:3000";
const tokens = {};
try {
    await redis.connect(); assert.equal(await redis.ping(), "PONG");
    await mongo.connect(); assert.equal((await mongo.db("ecommerce_test").command({ ping: 1 })).ok, 1);
    // Keycloak advertises the public issuer, but the token request originates inside Compose.
    const tokenUrl = new URL(
        new URL(process.env.OIDC_ISSUER).pathname + "/protocol/openid-connect/token",
        process.env.OIDC_BACKCHANNEL_URL,
    );
    for (const role of ["reader", "manager", "unprivileged"]) {
        const token = await fetch(tokenUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: "ecommerce-cli-" + role, client_secret: process.env[`ECOMMERCE_${role.toUpperCase()}_CLIENT_SECRET`] }) });
        assert.equal(token.status, 200); tokens[role] = (await token.json()).access_token;
    }
    const request = (path, method = "GET", body, token = tokens.manager) => fetch(base + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const path of ["/health", "/ready", "/docs/", "/openapi.json"]) { assert.equal((await fetch(base + path)).status, 200); }
    assert.equal((await fetch("http://web:8080/")).status, 200);
    assert.equal((await fetch("http://web:8080/api/v1/products", { headers: { Authorization: "Bearer " + tokens.reader } })).status, 200);
    assert.equal((await request("/api/v1/products", "GET", undefined, "")).status, 401);
    assert.equal((await request("/api/v1/products", "GET", undefined, "invalid")).status, 401);
    assert.equal((await request("/api/v1/products", "GET", undefined, tokens.unprivileged)).status, 403);
    const created = await request("/api/v1/products", "POST", { sku: "COMPOSE-" + randomUUID(), name: "Container verification", priceInMinorUnits: 100, stock: 3 }); assert.equal(created.status, 201); product = await created.json();
    cacheKey = cacheNamespace + ":product:v1:" + product.id; assert.equal(await redis.get(cacheKey), null);
    assert.equal((await request("/api/v1/products/" + product.id)).status, 200); assert(await redis.get(cacheKey)); assert((await redis.ttl(cacheKey)) > 0);
    assert.equal((await request("/api/v1/products/" + product.id)).status, 200);
    assert.equal((await request("/api/v1/products/" + product.id, "PUT", { stock: 4 })).status, 200); assert.equal(await redis.get(cacheKey), null);
    const placed = await request("/api/v1/orders", "POST", { items: [{ productId: product.id, quantity: 1, unitPriceInMinorUnits: 100 }] }); assert.equal(placed.status, 201); order = await placed.json(); assert.equal(order.status, "PAYMENT_PENDING"); console.log("OWNED_PAYMENT " + order.paymentId);
    assert.equal((await request("/api/v1/webhooks/payments", "POST", {})).status, 401);
    const trigger = () => fetch(`http://payment-provider:4100/payments/${order.paymentId}/succeed`, { method: "POST" });
    const delivered = await trigger(); assert.equal(delivered.status, 200); eventId = (await delivered.json()).eventId;
    assert.equal((await request("/api/v1/orders/" + order.id).then(r => r.json())).status, "PAID");
    assert.equal(await outboxStatus(), "PENDING");
    console.log("OUTBOX_PENDING_VERIFIED");
    for (let i = 0; i < 180; i++) {
        if (await notificationCount() === 1 && await outboxStatus() === "PUBLISHED" && await emailState() === "SKIPPED") break;
        await delay(500);
    }
    assert.equal(await notificationCount(), 1);
    assert.equal(await outboxStatus(), "PUBLISHED");
    assert.equal(await emailState(), "SKIPPED");
    assert.equal((await trigger()).status, 200);
    const paidTransitions = useMongo
        ? await db.collection("order_status_history").countDocuments({ orderId: order.id, toStatus: "PAID" })
        : (await pool.query("SELECT count(*)::int AS n FROM order_status_history WHERE order_id=$1 AND to_status='PAID'", [order.id])).rows[0].n;
    assert.equal(paidTransitions, 1);
    assert.equal(await notificationCount(), 1);
} finally {
    if (useMongo) {
        if (eventId) {
            await db.collection("order_notifications").deleteOne({ _id: eventId });
            await db.collection("processed_webhook_events").deleteOne({ _id: eventId });
        }
        if (order) {
            await db.collection("order_email_deliveries").deleteOne({ _id: order.id });
            await db.collection("order_status_history").deleteMany({ orderId: order.id });
            await db.collection("orders").deleteOne({ _id: order.id });
        }
        if (product) await db.collection("products").deleteOne({ _id: product.id });
    } else {
        if (eventId) { await pool.query("DELETE FROM order_notifications WHERE event_id=$1", [eventId]); await pool.query("DELETE FROM outbox_events WHERE event_id=$1", [eventId]); await pool.query("DELETE FROM processed_webhook_events WHERE event_id=$1", [eventId]); }
        if (order) {
            await pool.query("DELETE FROM order_email_deliveries WHERE order_id=$1", [order.id]);
            await pool.query("DELETE FROM orders WHERE id=$1", [order.id]);
        }
        if (product) await pool.query("DELETE FROM products WHERE id=$1", [product.id]);
    }
    if (cacheKey) await redis.del(cacheKey);
    await Promise.allSettled([pool.end(), redis.close(), mongo.close()]);
}
console.log("Container HTTP/OIDC/HMAC/cache/Kafka/outbox/consumer/duplicate (" + storage + "): PASS");
