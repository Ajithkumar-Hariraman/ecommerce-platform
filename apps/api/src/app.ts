import {
  razorpayCheckoutRouter,
  razorpayWebhookRouter,
} from "./modules/payments/razorpay.routes.js";
import type { RazorpayPaymentClient } from "./modules/payments/razorpay.gateway.js";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./openapi.js";
import type { RequestHandler } from "express";
import type { ProductCache } from "./modules/products/product.cache.js";
import { denyAccessPolicy } from "./auth/middleware.js";
import type { AccessPolicy } from "./auth/middleware.js";
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
  docsEnabled?: boolean;
  razorpay?: RazorpayPaymentClient;
  accessPolicy?: AccessPolicy;
  productCache?: ProductCache;
  rateLimiter?: RequestHandler;
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
  if (dependencies.docsEnabled) {
    app.get("/openapi.json", (_req, res) => res.json(openApiDocument));
    app.use(
      "/docs",
      swaggerUi.serve,
      swaggerUi.setup(openApiDocument, {
        swaggerOptions: { persistAuthorization: false },
      }),
    );
  }
  if (dependencies.paymentWorkflow && dependencies.paymentWebhookSecret) {
    app.use(
      "/api/v1/webhooks",
      createPaymentWebhookRouter(dependencies.paymentWorkflow, dependencies.paymentWebhookSecret),
    );
  }
  if (dependencies.razorpay && dependencies.orderRepository && dependencies.paymentWorkflow) {
    app.use(
      "/api/v1/webhooks",
      razorpayWebhookRouter(
        dependencies.razorpay,
        dependencies.orderRepository,
        dependencies.paymentWorkflow,
      ),
    );
  }
  const access = dependencies.accessPolicy ?? denyAccessPolicy();
  const limiter: RequestHandler = dependencies.rateLimiter ?? ((_req, _res, next) => next());
  app.use("/api/v1/products", access.authenticate, limiter, access.catalog);
  app.use("/api/v1/categories", access.authenticate, limiter, access.catalog);
  app.use("/api/v1/orders", access.authenticate, limiter, access.orders);
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  app.get("/ready", async (_req, res) => {
    try {
      await dependencies.checkReady();
    } catch {
      throw new AppError(503, "Required database is unavailable");
    }
    res.status(200).json({ status: "ready" });
  });
  app.use(
    "/api/v1/products",
    createProductModule(
      dependencies.productRepository,
      dependencies.categoryRepository,
      dependencies.productCache,
    ),
  );
  app.use("/api/v1/categories", createCategoryModule(dependencies.categoryRepository));
  if (dependencies.orderRepository) {
    if (!dependencies.paymentClient) throw new Error("Order module requires PaymentClient");
    app.use(
      "/api/v1/orders",
      createOrderModule(
        dependencies.orderRepository,
        dependencies.paymentClient,
        dependencies.razorpay ? dependencies.productRepository : undefined,
      ),
    );
  }
  if (dependencies.razorpay && dependencies.orderRepository)
    app.use(
      "/api/v1/orders",
      razorpayCheckoutRouter(dependencies.razorpay, dependencies.orderRepository),
    );
  app.use((_req, _res, next) => {
    next(new AppError(404, "Route not found"));
  });
  app.use(errorHandler);
  return app;
}
