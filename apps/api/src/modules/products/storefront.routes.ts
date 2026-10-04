import { Router } from "express";
import type { ProductService } from "./product.service.js";
import { validateId, validateListQuery } from "./product.validation.js";
import { ProductImageService } from "./product-image.service.js";
import type { ProductImageStore } from "./product-image.js";
import { AppError } from "../../errors/app-error.js";
export function createStorefrontRouter(products: ProductService, store?: ProductImageStore) {
  const router = Router(),
    images = new ProductImageService(products, store);
  router.get("/products", validateListQuery, async (_req, res) => {
    const input = res.locals.productListInput;
    res.json(await products.list({ ...input, status: "ACTIVE" }));
  });
  const active = async (id: string) => {
    const product = await products.findById(id);
    if (product.status !== "ACTIVE") throw new AppError(404, "Product not found");
    return product;
  };
  router.get("/products/:id", validateId, async (_req, res) => {
    res.json(await active(res.locals.productId));
  });
  router.get("/products/:id/image-url", validateId, async (_req, res) => {
    await active(res.locals.productId);
    res.setHeader("Cache-Control", "no-store");
    res.json(await images.readUrl(res.locals.productId));
  });
  return router;
}
