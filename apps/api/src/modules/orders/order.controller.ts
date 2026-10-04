import { AppError } from "../../errors/app-error.js";
import { assertOrderAccess, orderPrincipal } from "./order-access.js";
import type { AuthenticatedPrincipal } from "../../auth/principal.js";
import type { RequestHandler } from "express";
import type { OrderService } from "./order.service.js";
import type { CreateOrderInput } from "./order.types.js";

type CreateHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  { orderInput: CreateOrderInput; principal?: AuthenticatedPrincipal }
>;
type IdHandler = RequestHandler<
  Record<string, string>,
  unknown,
  unknown,
  Record<string, unknown>,
  { orderId: string; principal?: AuthenticatedPrincipal }
>;

export class OrderController {
  constructor(private readonly service: OrderService) {}
  list: RequestHandler = async (_req, res) => {
    const actor = orderPrincipal(res.locals.principal);
    const input = res.locals.orderListInput;
    if (
      input.scope === "all" &&
      !actor.roles.some((role) => role === "admin" || role === "order_manager")
    )
      throw new AppError(403, "Order management permission required");
    res.json(await this.service.list(input.scope === "all" ? null : actor.subject, input));
  };
  create: CreateHandler = async (_req, res) => {
    const order = await this.service.create(
      res.locals.orderInput,
      orderPrincipal(res.locals.principal).subject,
      orderPrincipal(res.locals.principal).customer,
    );
    res.location(`/api/v1/orders/${order.id}`).status(201).json(order);
  };
  initiatePayment: IdHandler = async (_req, res) => {
    assertOrderAccess(res.locals.principal, await this.service.findById(res.locals.orderId));
    res.status(200).json(await this.service.initiatePayment(res.locals.orderId));
  };
  findById: IdHandler = async (_req, res) => {
    const order = await this.service.findById(res.locals.orderId);
    assertOrderAccess(res.locals.principal, order);
    res.status(200).json(order);
  };
}
