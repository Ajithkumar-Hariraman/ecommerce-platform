import { z } from "zod";
import { AppError } from "../../errors/app-error.js";

export interface PaymentClient {
  createPayment(input: {orderId: string; amountInMinorUnits: number; idempotencyKey: string}): Promise<{paymentId: string; status: "PENDING"}>;
}
const responseSchema = z.strictObject({paymentId: z.uuid(), status: z.literal("PENDING")});

export class HttpPaymentClient implements PaymentClient {
  constructor(private readonly baseUrl: string, private readonly timeoutMs = 3000) {}
  async createPayment(input: Parameters<PaymentClient["createPayment"]>[0]) {
    try {
      const response = await fetch(new URL("payments", this.baseUrl.endsWith("/") ? this.baseUrl : this.baseUrl + "/"), {
        method: "POST", signal: AbortSignal.timeout(this.timeoutMs), redirect: "error",
        headers: {"Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey},
        body: JSON.stringify({orderId: input.orderId, amountInMinorUnits: input.amountInMinorUnits}),
      });
      if (response.status !== 201 || !response.body) {
        await response.body?.cancel();
        throw new Error("Provider rejected request");
      }
      const chunks: Uint8Array[] = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 16384) throw new Error("Provider response too large");
        chunks.push(chunk);
      }
      return responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      throw new AppError(502, "Payment provider unavailable or returned an invalid response");
    }
  }
}
