import { Router } from "express";
import type { ProductController } from "./product.controller.js";
import {
  validateCreate,
  validateId,
  validateListQuery,
  validateUpdate,
} from "./product.validation.js";

export function createProductRouter(controller: ProductController): Router {
  const router = Router();
  router.post("/", validateCreate, controller.create);
  router.get("/", validateListQuery, controller.findAll);
  router.get("/:id", validateId, controller.findById);
  // Phase 2 contract explicitly uses PUT for partial updates.
  router.put("/:id", validateId, validateUpdate, controller.update);
  router.delete("/:id", validateId, controller.deleteById);
  return router;
}
