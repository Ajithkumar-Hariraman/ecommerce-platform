import type { NextFunction, Request, Response } from "express";

import { ProductImportError } from "./product-import.error.js";
import { ProductImportService } from "./product-import.service.js";

export class ProductImportController {
  constructor(private readonly importService: ProductImportService) {}

  importCsv = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.is(["text/csv", "application/csv"])) {
        res.status(415).json({
          error: {
            message: "Content-Type must be text/csv",
          },
        });

        return;
      }

      const result = await this.importService.importCsv(req);

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof ProductImportError) {
        res.status(error.statusCode).json({
          error: {
            message: error.message,
          },
        });

        return;
      }

      next(error);
    }
  };
}
