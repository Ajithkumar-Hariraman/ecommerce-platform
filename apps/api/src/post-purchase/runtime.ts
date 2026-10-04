import { Storage } from "@google-cloud/storage";
import { loadPostPurchaseConfig } from "../config/env.js";
import type { OrderRepository } from "../modules/orders/order.repository.js";
import type { PostPurchaseRepository } from "./repository.js";
import { GcsOrderDocumentStore, OrderDocumentService } from "./documents.js";
export function createOrderDocuments(orders: OrderRepository, repo: PostPurchaseRepository) {
  const c = loadPostPurchaseConfig();
  return new OrderDocumentService(
    orders,
    repo,
    c.bucket
      ? new GcsOrderDocumentStore(
          new Storage({
            projectId: c.projectId,
            retryOptions: { totalTimeout: 10, maxRetries: 2 },
          }),
          c.bucket,
        )
      : undefined,
    c.merchant,
  );
}
