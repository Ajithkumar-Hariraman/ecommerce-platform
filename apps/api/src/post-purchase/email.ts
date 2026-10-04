import nodemailer from "nodemailer";
import type { Order } from "../modules/orders/order.types.js";
import type { OrderPaid } from "../events/order-paid.js";
import type { OrderNotificationRepository } from "../events/order-notification.repository.js";
import {
  TransientProcessingError,
  PermanentProcessingError,
} from "../events/order-notification.repository.js";
import type { OrderRepository } from "../modules/orders/order.repository.js";
import type { PostPurchaseRepository } from "./repository.js";
import type { OrderDocumentService } from "./documents.js";
export type CustomerEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
};
export interface EmailSender {
  send(email: CustomerEmail): Promise<void>;
  close(): void;
}
export class SmtpEmailSender implements EmailSender {
  private readonly transport;
  constructor(
    config: { host: string; port: number; from: string; user: string; password: string },
    private readonly from = config.from,
  ) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      requireTLS:
        config.host !== "127.0.0.1" && config.host !== "localhost" && config.host !== "mailpit",
      ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  }
  async send(email: CustomerEmail) {
    await this.transport.sendMail({ ...email, from: this.from });
  }
  close() {
    this.transport.close();
  }
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export function confirmationEmail(
  order: Order,
  merchant: string,
  invoice: Buffer,
  receipt: Buffer,
): CustomerEmail {
  const ref = order.id.slice(0, 8).toUpperCase(),
    amount = `INR ${(order.totalInMinorUnits / 100).toFixed(2)}`;
  const lines = order.items.map(
    (i) =>
      `${i.name ?? "Purchased product"} x ${i.quantity} - INR ${(i.lineTotalInMinorUnits / 100).toFixed(2)}`,
  );
  return {
    to: order.customer!.email!,
    subject: `Payment received - Order ${ref}`,
    messageId: `<order-paid-${order.id}@commerce.local>`,
    text: `${merchant}
Payment received
Order ${ref}
Amount: ${amount}
${lines.join("\n")}
Your invoice and payment receipt are attached.`,
    html: `<h1>Payment received</h1><p>Thank you for your order${order.customer?.name ? ", " + escape(order.customer.name) : ""}.</p><p>Order <strong>${ref}</strong></p><p>Amount: <strong>${amount}</strong></p><ul>${lines.map((l) => "<li>" + escape(l) + "</li>").join("")}</ul><p>Your invoice and payment receipt are attached.</p><p>${escape(merchant)}</p>`,
    attachments: [
      { filename: "invoice.pdf", content: invoice, contentType: "application/pdf" },
      { filename: "receipt.pdf", content: receipt, contentType: "application/pdf" },
    ],
  };
}
export class PostPurchaseNotificationProcessor implements OrderNotificationRepository {
  constructor(
    private readonly base: OrderNotificationRepository,
    private readonly orders: OrderRepository,
    private readonly repo: PostPurchaseRepository,
    private readonly documents: OrderDocumentService,
    private readonly sender: EmailSender,
    private readonly merchant: string,
  ) {}
  async process(event: OrderPaid) {
    const result = await this.base.process(event),
      order = await this.orders.findById(event.aggregateId);
    if (!order || order.status !== "PAID")
      throw new PermanentProcessingError("Confirmed Order required");
    const state = await this.repo.state(order.id);
    if (state === "SENT" || state === "SKIPPED") return result;
    if (state === "UNCERTAIN") throw new PermanentProcessingError("Email requires reconciliation");
    if (state === "SENDING")
      throw new TransientProcessingError("Email delivery already in progress or uncertain");
    if (!order.customer?.email) {
      if (await this.repo.claim(order.id, `<order-paid-${order.id}@commerce.local>`))
        await this.repo.finish(order.id, "SKIPPED");
      return result;
    }
    let invoice: Buffer, receipt: Buffer;
    try {
      invoice = await this.documents.generate(order, "invoice");
      receipt = await this.documents.generate(order, "receipt");
    } catch {
      throw new TransientProcessingError("Order documents unavailable");
    }
    const email = confirmationEmail(order, this.merchant, invoice, receipt);
    if (!(await this.repo.claim(order.id, email.messageId)))
      throw new TransientProcessingError("Email delivery in progress");
    try {
      await this.sender.send(email);
    } catch (error) {
      const command =
        typeof error === "object" && error && "command" in error ? String(error.command) : "";
      const safeRetry = [
        "CONN",
        "EHLO",
        "HELO",
        "STARTTLS",
        "AUTH",
        "MAIL FROM",
        "RCPT TO",
      ].includes(command);
      await this.repo.finish(order.id, safeRetry ? "PENDING" : "UNCERTAIN");
      if (safeRetry) throw new TransientProcessingError("SMTP unavailable before acceptance");
      throw new PermanentProcessingError(
        "SMTP delivery outcome uncertain; reconcile before resend",
      );
    }
    // Never auto-resend after an accepted message if this persistence write fails.
    try {
      await this.repo.finish(order.id, "SENT");
    } catch {
      throw new TransientProcessingError(
        "Email accepted; delivery confirmation persistence unavailable",
      );
    }
    return result;
  }
}
