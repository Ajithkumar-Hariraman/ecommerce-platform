import type { ProductListInput } from "./product-list.types.js";
import type { RequestHandler } from "express";
import type { ProductService } from "./product.service.js";
import type { CreateProductInput, UpdateProductInput } from "./product.js";

type CreateHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  {
    productInput: CreateProductInput;
  }
>;
type UpdateHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  {
    productId: string;
    productInput: UpdateProductInput;
  }
>;
type IdHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  {
    productId: string;
  }
>;
type ListHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  {
    productListInput: ProductListInput;
  }
>;

export class ProductController {
  constructor(private readonly service: ProductService) {}

  // Arrow functions preserve this when Express calls them as callbacks.
  create: CreateHandler = async (_req, res) => {
    const product = await this.service.create(res.locals.productInput);
    res.location(`/api/v1/products/${product.id}`).status(201).json(product);
  };

  findAll: ListHandler = async (_req, res) => {
    res.status(200).json(await this.service.list(res.locals.productListInput));
  };

  findById: IdHandler = async (_req, res) => {
    res.status(200).json(await this.service.findById(res.locals.productId));
  };

  update: UpdateHandler = async (_req, res) => {
    res.status(200).json(await this.service.update(res.locals.productId, res.locals.productInput));
  };

  deleteById: IdHandler = async (_req, res) => {
    await this.service.deleteById(res.locals.productId);
    res.status(204).end();
  };
}
