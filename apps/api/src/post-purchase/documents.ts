import PDFDocument from "pdfkit";
import { Storage } from "@google-cloud/storage";
import type { Order } from "../modules/orders/order.types.js";
import type { OrderRepository } from "../modules/orders/order.repository.js";
import type { AuthenticatedPrincipal } from "../auth/principal.js";
import { assertOrderAccess } from "../modules/orders/order-access.js";
import { AppError } from "../errors/app-error.js";
import type { PostPurchaseRepository } from "./repository.js";
export type DocumentKind = "invoice" | "receipt";
export interface OrderDocumentStore {
  putIfAbsent(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
}
export class GcsOrderDocumentStore implements OrderDocumentStore {
  constructor(
    private readonly storage: Storage,
    private readonly bucket: string,
  ) {}
  async putIfAbsent(key: string, bytes: Buffer) {
    try {
      await this.storage
        .bucket(this.bucket)
        .file(key)
        .save(bytes, {
          resumable: false,
          contentType: "application/pdf",
          preconditionOpts: { ifGenerationMatch: 0 },
          metadata: { cacheControl: "private,no-store" },
        });
    } catch (e) {
      if (!(typeof e === "object" && e && "code" in e && Number(e.code) === 412))
        throw new AppError(503, "Order document storage unavailable");
    }
  }
  async read(key: string) {
    try {
      const [bytes] = await this.storage.bucket(this.bucket).file(key).download();
      if (bytes.length > 2 * 1024 * 1024) throw new Error();
      return bytes;
    } catch {
      throw new AppError(503, "Order document unavailable");
    }
  }
}
export const documentNumber = (kind: DocumentKind, id: string) =>
  `${kind === "invoice" ? "INV" : "RCT"}-${id.toUpperCase()}`;
export async function renderOrderPdf(
  order: Order,
  kind: DocumentKind,
  merchant: string,
  paid?: { paidAt: string; providerPaymentId?: string },
) {
  if (kind === "receipt" && (order.status !== "PAID" || !paid))
    throw new AppError(409, "Receipt available only after confirmed payment");
  const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: kind === "invoice" ? "Order Invoice" : "Payment Receipt", Author: merchant },
    }),
    chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (b) => chunks.push(b));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
  const money = (n: number) => `INR ${(n / 100).toFixed(2)}`;
  doc.fillColor("#244d3a").fontSize(22).text(merchant);
  doc
    .moveDown(0.5)
    .fontSize(18)
    .text(kind === "invoice" ? "Order invoice" : "Payment receipt");
  doc
    .fillColor("#333333")
    .fontSize(10)
    .moveDown()
    .text(documentNumber(kind, order.id), { width: 500 });
  doc.moveDown().text(`Order: ${order.id}`);
  doc.text(`Date: ${kind === "receipt" ? paid!.paidAt : order.createdAt}`);
  doc.text(`Status: ${order.status.replaceAll("_", " ")}`);
  if (order.customer?.name) doc.text(`Customer: ${order.customer.name}`);
  if (order.customer?.email) doc.text(`Email: ${order.customer.email}`);
  if (kind === "receipt" && paid?.providerPaymentId)
    doc.text(`Payment reference: ${paid.providerPaymentId}`);
  doc.moveDown();
  for (const [index, item] of order.items.entries()) {
    if (doc.y > 680) doc.addPage();
    doc
      .font("Helvetica-Bold")
      .text(`${index + 1}. ${item.name ?? "Purchased product"}`, { width: 500 });
    doc
      .font("Helvetica")
      .text(
        `Quantity ${item.quantity}  |  Unit price ${money(item.unitPriceInMinorUnits)}  |  Line total ${money(item.lineTotalInMinorUnits)}`,
        { width: 500 },
      )
      .moveDown(0.7);
  }
  if (doc.y > 680) doc.addPage();
  doc
    .moveDown()
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(`Total: ${money(order.totalInMinorUnits)}`);
  doc
    .font("Helvetica")
    .fontSize(9)
    .moveDown()
    .text(
      kind === "receipt"
        ? "Payment confirmed. Thank you for your order."
        : "Order summary invoice. This document does not assert payment or calculate GST.",
    );
  doc.end();
  return complete;
}
export class OrderDocumentService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly repo: PostPurchaseRepository,
    private readonly store: OrderDocumentStore | undefined,
    private readonly merchant: string,
    private readonly allowUnstored = false,
  ) {}
  async forOwner(id: string, kind: DocumentKind, actor: AuthenticatedPrincipal) {
    const order = await this.orders.findById(id);
    if (!order) throw new AppError(404, "Order not found");
    assertOrderAccess(actor, order);
    return this.generate(order, kind);
  }
  async generate(order: Order, kind: DocumentKind) {
    const paid = await this.repo.paidInfo(order.id);
    if (kind === "receipt" && (order.status !== "PAID" || !paid))
      throw new AppError(409, "Receipt available only after confirmed payment");
    if (!this.store && !this.allowUnstored)
      throw new AppError(503, "Order document storage is not configured");
    const bytes = await renderOrderPdf(order, kind, this.merchant, paid ?? undefined);
    if (!this.store) return bytes;
    const key = `orders/${order.id}/${kind}-v${order.version}.pdf`;
    await this.store.putIfAbsent(key, bytes);
    return this.store.read(key);
  }
}
