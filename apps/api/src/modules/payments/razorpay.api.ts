import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
export const razorpayOrder = z.object({
  id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  amount: z.number().int().positive(),
  currency: z.literal("INR"),
  receipt: z.string(),
  status: z.enum(["created", "attempted", "paid"]),
});
export const razorpayPayment = z.object({
  id: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  order_id: z.string().regex(/^order_[A-Za-z0-9]+$/),
  amount: z.number().int().positive(),
  currency: z.literal("INR"),
  status: z.enum(["created", "authorized", "captured", "refunded", "failed"]),
  created_at: z.number().int().nonnegative().max(253402300799),
});
export interface RazorpayApi {
  createOrder(orderId: string, amount: number): Promise<z.infer<typeof razorpayOrder>>;
  findOrder(orderId: string): Promise<z.infer<typeof razorpayOrder> | null>;
  orderPayments(id: string): Promise<z.infer<typeof razorpayPayment>[]>;
  payment(id: string): Promise<z.infer<typeof razorpayPayment>>;
}
// Real HTTPS API, Basic authentication and bounded responses. No automatic POST retries.
export class RazorpayHttpApi implements RazorpayApi {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly timeoutMs: number,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(path: string, body?: object): Promise<unknown> {
    try {
      const response = await this.transport("https://api.razorpay.com/v1/" + path, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          Authorization:
            "Basic " + Buffer.from(this.keyId + ":" + this.keySecret).toString("base64"),
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error();
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 65536) throw new Error();
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AppError(502, "Razorpay is unavailable or returned an invalid response");
    }
  }
  async createOrder(orderId: string, amount: number) {
    return this.parse(
      razorpayOrder,
      await this.request("orders", {
        amount,
        currency: "INR",
        receipt: orderId,
        partial_payment: false,
        notes: { internal_order_id: orderId },
      }),
    );
  }
  async findOrder(orderId: string) {
    const data = this.parse(
      z.object({ items: z.array(razorpayOrder) }),
      await this.request("orders?receipt=" + encodeURIComponent(orderId) + "&count=2"),
    );
    const matches = data.items.filter((item) => item.receipt === orderId);
    if (matches.length > 1)
      throw new AppError(409, "Multiple provider Orders require reconciliation");
    return matches[0] ?? null;
  }
  async orderPayments(id: string) {
    return this.parse(
      z.object({ items: z.array(razorpayPayment) }),
      await this.request("orders/" + encodeURIComponent(id) + "/payments"),
    ).items;
  }
  async payment(id: string) {
    return this.parse(razorpayPayment, await this.request("payments/" + encodeURIComponent(id)));
  }
  private parse<T>(schema: z.ZodType<T>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new AppError(502, "Invalid Razorpay response");
    return result.data;
  }
}
