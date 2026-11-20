import { Storage } from "@google-cloud/storage";
import { loadPostPurchaseConfig, loadCloudProvider } from "../config/env.js";
import { S3Client } from "@aws-sdk/client-s3";
import { S3OrderDocumentStore } from "./s3-documents.js";
import type { OrderRepository } from "../modules/orders/order.repository.js";
import type { PostPurchaseRepository } from "./repository.js";
import { GcsOrderDocumentStore, OrderDocumentService } from "./documents.js";
export function createOrderDocuments(orders: OrderRepository, repo: PostPurchaseRepository) {
  const c = loadPostPurchaseConfig();
  return new OrderDocumentService(
    orders,
    repo,
    c.bucket
      ? loadCloudProvider() === "aws"
        ? new S3OrderDocumentStore(new S3Client({ maxAttempts: 2 }), c.bucket)
        : new GcsOrderDocumentStore(
            new Storage({
              projectId: c.projectId,
              retryOptions: { totalTimeout: 10, maxRetries: 2 },
            }),
            c.bucket,
          )
      : undefined,
    c.merchant,
    process.env.NODE_ENV === "development",
  );
}
