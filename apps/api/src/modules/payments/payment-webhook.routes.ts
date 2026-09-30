import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, raw } from "express";
import { AppError } from "../../errors/app-error.js";
import { paymentEventSchema } from "./payment-workflow.js";
import type { PaymentWorkflowRepository } from "./payment-workflow.js";

export function createPaymentWebhookRouter(workflow: PaymentWorkflowRepository, secret: string): Router {
  const router = Router();
  router.post("/payments", raw({type:"application/json",limit:"32kb",inflate:false}), async (req,res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415,"Webhook requires application/json");
    const signature = req.get("X-Payment-Signature") ?? "";
    if (!/^[a-fA-F0-9]{64}$/.test(signature)) throw new AppError(401,"Invalid payment signature");
    const expected = createHmac("sha256",secret).update(req.body).digest();
    if (!timingSafeEqual(expected,Buffer.from(signature,"hex"))) throw new AppError(401,"Invalid payment signature");
    let value: unknown;
    try { value = JSON.parse(req.body.toString("utf8")); } catch { throw new AppError(400,"Invalid payment event"); }
    const parsed = paymentEventSchema.safeParse(value);
    if (!parsed.success) throw new AppError(400,"Invalid payment event");
    await workflow.applyEvent(parsed.data);
    res.status(200).json({received:true});
  });
  return router;
}
