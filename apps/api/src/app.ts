import type { PaymentClient } from "./modules/payments/payment.client.js";
import type { PaymentWorkflowRepository } from "./modules/payments/payment-workflow.js";
import { createPaymentWebhookRouter } from "./modules/payments/payment-webhook.routes.js";
import { createOrderModule } from "./modules/orders/order.module.js";
import type { OrderRepository } from "./modules/orders/order.repository.js";
import { createCategoryModule } from "./modules/categories/category.module.js";
import type { CategoryRepository } from "./modules/categories/category.repository.js";
import express from "express";
import type { Express } from "express";
import { AppError } from "./errors/app-error.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createProductModule } from "./modules/products/product.module.js";
import type { ProductRepository } from "./modules/products/product.repository.js";

export interface AppDependencies {
  // Optional only for existing isolated Product/Category test apps; runtime always supplies it.
  orderRepository?: OrderRepository;
  paymentClient?: PaymentClient;
  paymentWorkflow?: PaymentWorkflowRepository;
  paymentWebhookSecret?: string;
  productRepository: ProductRepository;
  categoryRepository: CategoryRepository;
  checkReady: () => Promise<void>;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  if (dependencies.paymentWorkflow && dependencies.paymentWebhookSecret) {
    app.use("/api/v1/webhooks", createPaymentWebhookRouter(dependencies.paymentWorkflow, dependencies.paymentWebhookSecret));
  }
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (_req, res) => { res.status(200).json({ status: "ok" }); });
  app.get("/ready", async (_req, res) => {
    try { await dependencies.checkReady(); }
    catch { throw new AppError(503, "Required database is unavailable"); }
    res.status(200).json({ status: "ready" });
  });
  app.use("/api/v1/products", createProductModule(dependencies.productRepository, dependencies.categoryRepository));
  app.use("/api/v1/categories", createCategoryModule(dependencies.categoryRepository));
  if (dependencies.orderRepository) {
    if (!dependencies.paymentClient) throw new Error("Order module requires PaymentClient");
    app.use("/api/v1/orders", createOrderModule(dependencies.orderRepository, dependencies.paymentClient));
  }
  app.use((_req, _res, next) => { next(new AppError(404, "Route not found")); });
  app.use(errorHandler);
  return app;
}
