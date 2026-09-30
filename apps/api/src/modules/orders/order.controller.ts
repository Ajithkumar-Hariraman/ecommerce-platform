import type { RequestHandler } from "express";
import type { OrderService } from "./order.service.js";
import type { CreateOrderInput } from "./order.types.js";

type CreateHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, {orderInput: CreateOrderInput}>;
type IdHandler = RequestHandler<Record<string, string>, unknown, unknown, Record<string, unknown>, {orderId: string}>;

export class OrderController {
  constructor(private readonly service: OrderService) {}
  create: CreateHandler = async (_req, res) => {
    const order = await this.service.create(res.locals.orderInput);
    res.location(`/api/v1/orders/${order.id}`).status(201).json(order);
  };
  findById: IdHandler = async (_req, res) => {
    res.status(200).json(await this.service.findById(res.locals.orderId));
  };
}
