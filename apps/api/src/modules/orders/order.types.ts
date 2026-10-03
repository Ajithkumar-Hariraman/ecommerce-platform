export type OrderStatus =
  | "CREATED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

export interface OrderItemInput {
  productId: string;
  quantity: number;
  unitPriceInMinorUnits: number;
}

export interface CreateOrderInput {
  items: OrderItemInput[];
}

export interface OrderItem extends OrderItemInput {
  lineTotalInMinorUnits: number;
}

export interface Order {
  id: string;
  // Historical customer reference; never used for authorization.
  customerId: string | null;
  ownerSubject?: string | null;
  items: OrderItem[];
  version: number;
  status: OrderStatus;
  totalInMinorUnits: number;
  paymentId: string | null;
  createdAt: string;
  updatedAt: string;
}
