import type { RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../../errors/app-error.js";
import { imageUploadSchema } from "./product-image.js";
import type { ProductImageService } from "./product-image.service.js";
const completeSchema = z.strictObject({ objectName: z.string().min(1).max(200) });
export class ProductImageController {
  constructor(private readonly service: ProductImageService) {}
  createUpload: RequestHandler = async (req, res) => {
    const input = imageUploadSchema.safeParse(req.body);
    if (!input.success) throw new AppError(400, "Invalid image upload request");
    res.setHeader("Cache-Control", "no-store");
    res.json(await this.service.createUpload(res.locals.productId, input.data));
  };
  complete: RequestHandler = async (req, res) => {
    const input = completeSchema.safeParse(req.body);
    if (!input.success) throw new AppError(400, "Invalid image reference");
    res.json(await this.service.complete(res.locals.productId, input.data.objectName));
  };
  readUrl: RequestHandler = async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await this.service.readUrl(res.locals.productId));
  };
}
