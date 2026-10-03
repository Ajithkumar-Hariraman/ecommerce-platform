import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const secret = process.env.PAYMENT_WEBHOOK_SECRET;
const webhookUrl = process.env.PAYMENT_WEBHOOK_URL;
if (!secret || secret.length < 32 || secret.startsWith("REPLACE_") || !webhookUrl) throw new Error("Configure webhook URL and a shared secret of at least 32 characters");
const target = new URL(webhookUrl);
if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("Invalid webhook URL");
const filename = resolve(process.env.PAYMENT_DATABASE_PATH ?? new URL(".data/payments.sqlite", import.meta.url).pathname);
mkdirSync(dirname(filename), { recursive: true });
const db = new DatabaseSync(filename);
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS payments (
  payment_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0),
  event_id TEXT, event_type TEXT, occurred_at TEXT
)`);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
async function body(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new Error("Invalid body");
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error("Too large"); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/payments') {
      let input; try { input = await body(req); } catch { return send(res, 400, { error: 'Invalid payment request' }); }
      const key = req.headers['idempotency-key'];
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== 'amountInMinorUnits,orderId' || !uuid.test(input.orderId) || !Number.isSafeInteger(input.amountInMinorUnits) || input.amountInMinorUnits < 0 || typeof key !== 'string' || !key.length || key.length > 200) return send(res, 400, { error: 'Invalid payment request' });
      const paymentId = randomUUID();
      db.prepare('INSERT INTO payments(payment_id,idempotency_key,order_id,amount) VALUES(?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING').run(paymentId, key, input.orderId, input.amountInMinorUnits);
      const row = db.prepare('SELECT * FROM payments WHERE idempotency_key=?').get(key);
      if (row.order_id !== input.orderId || row.amount !== input.amountInMinorUnits) return send(res, 409, { error: 'Idempotency key reused with different input' });
      // Optional local fault injection: timeout after the durable payment exists.
      const delay = Number(process.env.PAYMENT_RESPONSE_DELAY_MS ?? 0);
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(delay, 10000)));
      return send(res, 201, { paymentId: row.payment_id, status: 'PENDING' });
    }
    const match = /^\/payments\/([0-9a-f-]+)\/(succeed|fail)$/.exec(req.url ?? '');
    if (req.method === 'POST' && match && uuid.test(match[1])) {
      let row = db.prepare('SELECT * FROM payments WHERE payment_id=?').get(match[1]);
      if (!row) return send(res, 404, { error: 'Payment not found' });
      const type = match[2] === 'succeed' ? 'payment.succeeded' : 'payment.failed';
      if (row.event_type && row.event_type !== type) return send(res, 409, { error: 'Payment already finalized' });
      db.prepare('UPDATE payments SET event_id=?,event_type=?,occurred_at=? WHERE payment_id=? AND event_id IS NULL').run(randomUUID(), type, new Date().toISOString(), row.payment_id);
      row = db.prepare('SELECT * FROM payments WHERE payment_id=?').get(row.payment_id);
      const payload = JSON.stringify({ eventId: row.event_id, type: row.event_type, paymentId: row.payment_id, orderId: row.order_id, occurredAt: row.occurred_at });
      const signature = createHmac('sha256', secret).update(payload).digest('hex');
      try {
        const response = await fetch(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3000), headers: { 'Content-Type': 'application/json', 'X-Payment-Signature': signature }, body: payload });
        await response.body?.cancel();
        if (!response.ok) return send(res, 502, { error: 'Webhook not acknowledged', eventId: row.event_id });
        return send(res, 200, { delivered: true, eventId: row.event_id });
      } catch { return send(res, 502, { error: 'Webhook delivery failed', eventId: row.event_id }); }
    }
    send(res, 404, { error: 'Not found' });
  } catch { send(res, 500, { error: 'Provider operation failed' }); }
});
server.listen(Number(process.env.PORT ?? 4100), process.env.HOST ?? '127.0.0.1', () => console.log(`Payment provider listening on ${server.address().port}`));
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (closing) return; closing = true;
  const timer = setTimeout(() => { server.closeAllConnections(); }, 5000); timer.unref();
  server.close(() => { clearTimeout(timer); db.close(); });
});
