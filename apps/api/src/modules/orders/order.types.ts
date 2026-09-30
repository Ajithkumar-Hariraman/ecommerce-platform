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
  customerId: string;
  items: OrderItemInput[];
}

export interface OrderItem extends OrderItemInput {
  lineTotalInMinorUnits: number;
}

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  version: number;
  status: OrderStatus;
  totalInMinorUnits: number;
  paymentId: string | null;
  createdAt: string;
  updatedAt: string;
}
