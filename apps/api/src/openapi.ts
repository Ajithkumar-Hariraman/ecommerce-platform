import { z } from "zod";
import {
  createSchema as productCreate,
  updateSchema as productUpdate,
} from "./modules/products/product.validation.js";
import { createSchema as categoryCreate } from "./modules/categories/category.validation.js";
import { createOrderSchema } from "./modules/orders/order.validation.js";
import { cachedProduct } from "./modules/products/redis-product.cache.js";
import { paymentEventSchema } from "./modules/payments/payment-workflow.js";
import type { Category } from "./modules/categories/category.js";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const category: z.ZodType<Category> = z.strictObject({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const orderItem = createOrderSchema.shape.items.element.extend({
  lineTotalInMinorUnits: integer,
});
const order = z.strictObject({
  id: z.uuid(),
  customerId: z.uuid().nullable(),
  ownerSubject: z.string().min(1).nullable().optional(),
  items: z.array(orderItem),
  version: integer,
  status: z.enum([
    "CREATED",
    "PAYMENT_PENDING",
    "PAID",
    "PAYMENT_FAILED",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
  ]),
  totalInMinorUnits: integer,
  paymentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const pagination = z.strictObject({
  page: integer,
  limit: integer,
  total: integer,
  totalPages: integer,
  hasNextPage: z.boolean(),
  hasPreviousPage: z.boolean(),
});
const importSummary = z.strictObject({
  totalRows: integer,
  imported: integer,
  failed: integer,
  failures: z.array(z.object({ row: integer, sku: z.string().nullable(), message: z.string() })),
  failuresTruncated: z.boolean(),
});
const schemas = {
  Product: cachedProduct,
  Category: category,
  Order: order,
  OrderItem: orderItem,
  ProductCreate: productCreate,
  ProductUpdate: productUpdate,
  CategoryCreate: categoryCreate,
  OrderCreate: createOrderSchema,
  PaymentEvent: paymentEventSchema,
  Pagination: pagination,
  ProductPage: z.object({ products: z.array(cachedProduct), pagination }),
  Error: z.object({ error: z.object({ message: z.string() }) }),
  ImportSummary: importSummary,
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ "application/json": { schema } });
const body = (name: string) => ({ required: true, content: json(ref(name)) });
const error = (description: string) => ({
  description,
  content: json(ref("Error")),
});
const errors: Record<number, object> = {
  400: error("Invalid input"),
  401: error("Missing or invalid authentication"),
  403: error("Insufficient role"),
  404: error("Resource not found"),
  409: error("Business conflict"),
  413: error("Request too large"),
  415: error("Unsupported content type"),
  429: {
    ...error("Rate limit exceeded"),
    headers: {
      "Retry-After": {
        schema: { type: "integer", minimum: 1 },
        description: "Seconds until retry",
      },
    },
  },
  500: error("Safe internal error"),
  502: error("Payment initiation failed; persisted Order can be retried"),
  503: error("Required dependency unavailable or payment persistence failed"),
};
const operation = (
  summary: string,
  code: number,
  schema: object | undefined,
  codes: number[],
  extra: object = {},
) => ({
  summary,
  security: [{ BearerAuth: [] }],
  responses: {
    [code]: {
      description: code === 201 ? "Created" : "Success",
      ...(schema ? { content: json(schema) } : {}),
    },
    ...Object.fromEntries(codes.map((c) => [c, errors[c]])),
  },
  ...extra,
});
const id = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};
const read = [400, 401, 403, 404, 429, 500];
const write = [400, 401, 403, 409, 413, 429, 500];
const catalog = "Read: catalog_reader, catalog_manager or admin. Mutate: catalog_manager or admin.";
const orders =
  "Read: order_reader, order_manager or admin. Mutate: order_manager or admin. Prices are supplied by the existing Order contract.";
export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Ecommerce API",
    version: "1.0.0",
    description:
      "Bearer access tokens verified through configured OIDC discovery/JWKS. Webhooks use independent HMAC authentication. Request schemas derive from runtime Zod validators; service rules also apply.",
  },
  components: {
    securitySchemes: {
      BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      PaymentHmac: {
        type: "apiKey",
        in: "header",
        name: "X-Payment-Signature",
        description:
          "Hex HMAC-SHA256 over exact raw JSON bytes, using the provider shared secret; not a JWT.",
      },
    },
    schemas: Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema, { io: "input" }),
      ]),
    ),
  },
  paths: {
    "/health": {
      get: operation(
        "Process liveness",
        200,
        {
          type: "object",
          properties: { status: { const: "ok" } },
          required: ["status"],
        },
        [],
        { security: [] },
      ),
    },
    "/ready": {
      get: operation(
        "Required database readiness; Redis is optional",
        200,
        {
          type: "object",
          properties: { status: { const: "ready" } },
          required: ["status"],
        },
        [503],
        { security: [] },
      ),
    },
    "/api/v1/products": {
      get: operation("List products", 200, ref("ProductPage"), [400, 401, 403, 429, 500], {
        description:
          catalog +
          " Defaults: page=1, limit=20. Safe-integer offset required; unknown query keys rejected.",
        parameters: [
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
          },
          {
            name: "page",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: Number.MAX_SAFE_INTEGER,
              default: 1,
            },
          },
          {
            name: "limit",
            in: "query",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20,
            },
          },
        ],
      }),
      post: operation("Create product", 201, ref("Product"), write, {
        description:
          catalog +
          " Status defaults ACTIVE. Price must be a positive safe integer; stock a nonnegative safe integer. SKU/name are trimmed and must not be blank. Category must exist.",
        requestBody: body("ProductCreate"),
      }),
    },
    "/api/v1/products/{id}": {
      parameters: [id],
      get: operation("Read product", 200, ref("Product"), read, {
        description: catalog,
      }),
      put: operation("Partially update product", 200, ref("Product"), [...write, 404], {
        description: catalog + " At least one field required. Null categoryId clears assignment.",
        requestBody: body("ProductUpdate"),
      }),
      delete: operation("Delete product", 204, undefined, read, {
        description: catalog,
      }),
    },
    "/api/v1/products/import": {
      post: operation(
        "Stream Product CSV",
        200,
        ref("ImportSummary"),
        [400, 401, 403, 413, 415, 429, 500],
        {
          description:
            catalog +
            " Independent row failures, including duplicate SKU, appear in the HTTP 200 bounded summary. Required headers: sku,name,priceInMinorUnits,stock; optional description,categoryId,status.",
          requestBody: {
            required: true,
            content: {
              "text/csv": { schema: { type: "string" } },
              "application/csv": { schema: { type: "string" } },
            },
          },
        },
      ),
    },
    "/api/v1/categories": {
      get: operation(
        "List categories",
        200,
        { type: "array", items: ref("Category") },
        [401, 403, 429, 500],
        { description: catalog },
      ),
      post: operation("Create category", 201, ref("Category"), write, {
        description: catalog,
        requestBody: body("CategoryCreate"),
      }),
    },
    "/api/v1/categories/{id}": {
      parameters: [id],
      get: operation("Read category", 200, ref("Category"), read, {
        description: catalog,
      }),
    },
    "/api/v1/orders": {
      post: operation(
        "Create Order and initiate payment",
        201,
        ref("Order"),
        [...write, 502, 503],
        {
          description:
            orders +
            " Success returns PAYMENT_PENDING, not PAID. On provider failure CREATED Order remains recoverable; error contains retry path.",
          requestBody: body("OrderCreate"),
        },
      ),
    },
    "/api/v1/orders/{id}": {
      parameters: [id],
      get: operation("Read Order", 200, ref("Order"), read, {
        description: orders,
      }),
    },
    "/api/v1/orders/{id}/payment": {
      parameters: [id],
      post: operation(
        "Retry payment with stable idempotency key",
        200,
        ref("Order"),
        [400, 401, 403, 404, 409, 429, 500, 502, 503],
        { description: orders },
      ),
    },
    "/api/v1/webhooks/payments": {
      post: operation(
        "Receive signed payment event",
        200,
        {
          type: "object",
          properties: { received: { const: true } },
          required: ["received"],
        },
        [400, 401, 404, 409, 413, 415, 500],
        {
          security: [{ PaymentHmac: [] }],
          description:
            "Exact raw bytes signed with HMAC-SHA256; 32 KiB maximum. Duplicate event returns successful acknowledgement without another transition. No Bearer token required.",
          requestBody: body("PaymentEvent"),
        },
      ),
    },
  },
};
