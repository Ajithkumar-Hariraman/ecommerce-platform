import type { RequestHandler } from "express";
import type { CategoryService } from "./category.service.js";
import type { CreateCategoryInput } from "./category.js";

type CreateHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  {
    categoryInput: CreateCategoryInput;
  }
>;
type IdHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  {
    categoryId: string;
  }
>;

export class CategoryController {
  constructor(private readonly service: CategoryService) {}

  create: CreateHandler = async (_req, res) => {
    const category = await this.service.create(res.locals.categoryInput);
    res.location(`/api/v1/categories/${category.id}`).status(201).json(category);
  };

  update: RequestHandler = async (_req, res) => {
    res.json(await this.service.update(res.locals.categoryId, res.locals.categoryInput));
  };

  deleteById: IdHandler = async (_req, res) => {
    await this.service.deleteById(res.locals.categoryId);
    res.status(204).end();
  };

  findAll: RequestHandler = async (_req, res) => {
    res.status(200).json(await this.service.findAll());
  };

  findById: IdHandler = async (_req, res) => {
    res.status(200).json(await this.service.findById(res.locals.categoryId));
  };
}
