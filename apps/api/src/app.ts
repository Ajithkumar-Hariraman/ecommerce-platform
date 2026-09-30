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
  productRepository: ProductRepository;
  categoryRepository: CategoryRepository;
  checkReady: () => Promise<void>;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.get("/health", (_req, res) => { res.status(200).json({ status: "ok" }); });
  app.get("/ready", async (_req, res) => {
    try { await dependencies.checkReady(); }
    catch { throw new AppError(503, "Required database is unavailable"); }
    res.status(200).json({ status: "ready" });
  });
  app.use("/api/v1/products", createProductModule(dependencies.productRepository, dependencies.categoryRepository));
  app.use("/api/v1/categories", createCategoryModule(dependencies.categoryRepository));
  if (dependencies.orderRepository) app.use("/api/v1/orders", createOrderModule(dependencies.orderRepository));
  app.use((_req, _res, next) => { next(new AppError(404, "Route not found")); });
  app.use(errorHandler);
  return app;
}
