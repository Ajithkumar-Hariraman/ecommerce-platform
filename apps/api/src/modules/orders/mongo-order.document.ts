import type { OrderItem, OrderStatus } from "./order.types.js";

export interface MongoOrderDocument {
  _id: string;

  customerId: string | null;

  ownerSubject?: string | null;

  items: OrderItem[];

  status: OrderStatus;

  totalInMinorUnits: number;

  paymentId: string | null;

  version: number;

  createdAt: Date;

  updatedAt: Date;
}
