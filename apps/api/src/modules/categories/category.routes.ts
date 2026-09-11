import { Router } from "express";
import type { CategoryController } from "./category.controller.js";
import { validateCategoryCreate, validateCategoryId } from "./category.validation.js";

export function createCategoryRouter(controller: CategoryController): Router {
  const router = Router();
  router.post("/", validateCategoryCreate, controller.create);
  router.get("/", controller.findAll);
  router.get("/:id", validateCategoryId, controller.findById);
  return router;
}
