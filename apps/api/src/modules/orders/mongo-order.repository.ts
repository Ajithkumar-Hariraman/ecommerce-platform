import type { OrderListQuery, OrderListResult } from "./order-list.js";
import { AppError } from "../../errors/app-error.js";
import type { Collection, Db } from "mongodb";

import type { MongoOrderDocument } from "./mongo-order.document.js";

import type { OrderRepository } from "./order.repository.js";

import type { Order } from "./order.types.js";

export class MongoOrderRepository implements OrderRepository {
  private readonly collection: Collection<MongoOrderDocument>;

  constructor(db: Db) {
    this.collection = db.collection<MongoOrderDocument>("orders");
  }

  async save(order: Order): Promise<void> {
    await this.collection.insertOne({
      _id: order.id,

      customerId: order.customerId,
      ...(order.customer ? { customer: order.customer } : {}),
      ...(order.ownerSubject != null ? { ownerSubject: order.ownerSubject } : {}),

      items: order.items.map((item) => ({
        ...item,
      })),

      status: order.status,

      totalInMinorUnits: order.totalInMinorUnits,

      paymentId: order.paymentId,

      version: order.version,

      createdAt: new Date(order.createdAt),

      updatedAt: new Date(order.updatedAt),
    });
  }

  async list(query: OrderListQuery): Promise<OrderListResult> {
    const filter = query.ownerSubject === null ? {} : { ownerSubject: query.ownerSubject };
    const total = await this.collection.countDocuments(filter);
    const rows = await this.collection
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(query.offset)
      .limit(query.limit)
      .toArray();
    return { orders: rows.map(toOrder), total };
  }
  async findById(id: string): Promise<Order | null> {
    const document = await this.collection.findOne({
      _id: id,
    });

    if (!document) {
      return null;
    }

    return toOrder(document);
  }

  async update(order: Order): Promise<void> {
    const result = await this.collection.updateOne(
      {
        _id: order.id,

        version: order.version - 1,
      },

      {
        $set: {
          status: order.status,

          paymentId: order.paymentId,

          version: order.version,

          updatedAt: new Date(order.updatedAt),
        },
      },
    );

    if (result.matchedCount !== 1) {
      throw new AppError(409, "Order update conflict");
    }
  }
}

function toOrder(document: MongoOrderDocument): Order {
  return {
    id: document._id,

    customerId: document.customerId,
    ...(document.customer ? { customer: document.customer } : {}),
    ...(document.ownerSubject != null ? { ownerSubject: document.ownerSubject } : {}),

    items: document.items.map((item) => ({
      ...item,
    })),

    status: document.status,

    totalInMinorUnits: document.totalInMinorUnits,

    paymentId: document.paymentId,

    version: document.version,

    createdAt: document.createdAt.toISOString(),

    updatedAt: document.updatedAt.toISOString(),
  };
}
