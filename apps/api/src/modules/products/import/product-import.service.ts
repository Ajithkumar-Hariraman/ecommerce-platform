import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { parse } from "csv-parse";
import { ZodError } from "zod";
import { AppError } from "../../../errors/app-error.js";

import { CsvByteLimitTransform } from "./csv-byte-limit.transform.js";
import { ProductImportError } from "./product-import.error.js";
import {
  type ProductImportFailure,
  type ProductImportInput,
  type ProductImportResult,
} from "./product-import.types.js";
import { parseProductImportRow } from "./product-import.validation.js";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 100_000;
const CONCURRENCY = 5;
const MAX_FAILURE_SAMPLES = 100;

const REQUIRED_COLUMNS = ["sku", "name", "priceInMinorUnits", "stock"] as const;

const ALLOWED_COLUMNS = new Set([
  "sku",
  "name",
  "description",
  "priceInMinorUnits",
  "stock",
  "status",
  "categoryId",
]);

type CreateProduct = (input: ProductImportInput) => Promise<unknown>;

interface CsvRecord {
  [key: string]: string;
}

interface PendingRow {
  rowNumber: number;
  product: ProductImportInput;
}

export class ProductImportService {
  constructor(private readonly createProduct: CreateProduct) {}

  async importCsv(source: Readable): Promise<ProductImportResult> {
    const result: ProductImportResult = {
      totalRows: 0,
      imported: 0,
      failed: 0,
      failures: [],
      failuresTruncated: false,
    };

    const byteLimiter = new CsvByteLimitTransform(MAX_FILE_SIZE_BYTES);

    let headersValidated = false;
    const parser = parse({
      bom: true,
      columns: (headers: string[]) => {
        const columns = this.validateHeaders(headers);
        headersValidated = true;
        return columns;
      },
      max_record_size: 64 * 1024,
      skip_empty_lines: true,
      trim: true,
    });

    // Keep the HTTP request outside pipeline so parse errors do not destroy
    // its socket before the controller can send a safe error response.
    const onSourceError = (error: Error) => { byteLimiter.destroy(error); };
    source.on("error", onSourceError);
    const streamCompletion = pipeline(byteLimiter, parser);
    void streamCompletion.catch(() => {});
    source.pipe(byteLimiter);

    let batch: PendingRow[] = [];

    try {
      for await (const rawRecord of parser) {
        result.totalRows += 1;

        if (result.totalRows > MAX_ROWS) {
          throw new ProductImportError(
            400,
            `Product import cannot exceed ${MAX_ROWS} rows`,
          );
        }

        try {
          const product = parseProductImportRow(rawRecord);

          batch.push({
            rowNumber: result.totalRows + 1,
            product,
          });
        } catch (error) {
          result.failed += 1;

          this.recordFailure(
            result,
            result.totalRows + 1,
            this.readSku(rawRecord),
            this.validationMessage(error),
          );
        }

        if (batch.length >= CONCURRENCY) {
          await this.processBatch(batch, result);
          batch = [];
        }
      }

      if (batch.length > 0) {
        await this.processBatch(batch, result);
      }

      await streamCompletion;
      if (!headersValidated) throw new ProductImportError(400, "CSV headers are required");

      return result;
    } catch (error) {
      parser.destroy();

      try {
        await streamCompletion;
      } catch {
        // Preserve the original error below.
      }

      if (error instanceof ProductImportError) {
        throw error;
      }

      throw new ProductImportError(400, "Invalid product CSV file");
    } finally {
      source.unpipe(byteLimiter);
      source.pause();
      source.off("error", onSourceError);
    }
  }

  private async processBatch(
    batch: PendingRow[],
    result: ProductImportResult,
  ): Promise<void> {
    await Promise.all(
      batch.map(async ({ rowNumber, product }) => {
        try {
          await this.createProduct(product);
          result.imported += 1;
        } catch (error) {
          result.failed += 1;

          this.recordFailure(
            result,
            rowNumber,
            product.sku,
            this.safeCreateFailureMessage(error),
          );
        }
      }),
    );
  }

  private validateHeaders(headers: string[]): string[] {
    const normalized = headers.map((header) => header.trim());

    if (new Set(normalized).size !== normalized.length) {
      throw new ProductImportError(400, "CSV contains duplicate columns");
    }

    const unknown = normalized.filter((header) => !ALLOWED_COLUMNS.has(header));

    if (unknown.length > 0) {
      throw new ProductImportError(
        400,
        "CSV contains unsupported columns",
      );
    }

    const missing = REQUIRED_COLUMNS.filter(
      (column) => !normalized.includes(column),
    );

    if (missing.length > 0) {
      throw new ProductImportError(
        400,
        `CSV is missing required columns: ${missing.join(", ")}`,
      );
    }

    return normalized;
  }

  private recordFailure(
    result: ProductImportResult,
    row: number,
    sku: string | null,
    message: string,
  ): void {
    if (result.failures.length >= MAX_FAILURE_SAMPLES) {
      result.failuresTruncated = true;
      return;
    }

    const failure: ProductImportFailure = {
      row,
      sku: sku?.slice(0, 200) ?? null,
      message: message.slice(0, 300),
    };

    result.failures.push(failure);
  }

  private readSku(value: unknown): string | null {
    if (typeof value !== "object" || value === null || !("sku" in value)) {
      return null;
    }

    const sku = (value as CsvRecord).sku;

    return typeof sku === "string" && sku.trim() !== "" ? sku.trim() : null;
  }

  private validationMessage(error: unknown): string {
    if (!(error instanceof ZodError)) {
      return "Invalid product row";
    }

    const firstIssue = error.issues[0];

    if (!firstIssue) {
      return "Invalid product row";
    }

    const field =
      firstIssue.path.length > 0 ? `${firstIssue.path.join(".")}: ` : "";

    return `${field}${firstIssue.message}`;
  }

  private safeCreateFailureMessage(error: unknown): string {
    if (
      error instanceof AppError &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return error.message;
    }

    return "Product could not be imported";
  }
}
