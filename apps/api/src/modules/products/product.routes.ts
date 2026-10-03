import type { ProductImageController } from "./product-image.controller.js";
import { Router } from "express";
import type { ProductController } from "./product.controller.js";
import { ProductImportController } from "./import/product-import.controller.js";
import {
  validateCreate,
  validateId,
  validateListQuery,
  validateUpdate,
} from "./product.validation.js";

export function createProductRouter(
  controller: ProductController,
  productImportController: ProductImportController,
  images: ProductImageController,
): Router {
  const router = Router();
  router.post("/", validateCreate, controller.create);
  router.get("/", validateListQuery, controller.findAll);
  router.post("/import", productImportController.importCsv);
  router.post("/:id/image-upload", validateId, images.createUpload);
  router.put("/:id/image", validateId, images.complete);
  router.get("/:id/image-url", validateId, images.readUrl);
  router.get("/:id", validateId, controller.findById);
  // Phase 2 contract explicitly uses PUT for partial updates.
  router.put("/:id", validateId, validateUpdate, controller.update);
  router.delete("/:id", validateId, controller.deleteById);
  return router;
}
