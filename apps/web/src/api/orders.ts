import { request } from "./http";
export type OrderStatus =
  | "CREATED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "PROCESSING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";
export interface Order {
  id: string;
  status: OrderStatus;
  totalInMinorUnits: number;
  createdAt: string;
  items: {
    productId: string;
    name?: string;
    quantity: number;
    unitPriceInMinorUnits: number;
    lineTotalInMinorUnits: number;
  }[];
}
export interface OrderList {
  orders: Order[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}
export const ordersApi = {
  get: (id: string, signal?: AbortSignal) =>
    request<Order>(`/orders/${encodeURIComponent(id)}`, { signal }),
  list: (page = 1, all = false, signal?: AbortSignal) =>
    request<OrderList>(`/orders?page=${page}&limit=20${all ? "&scope=all" : ""}`, { signal }),
  create: (items: { productId: string; quantity: number }[]) =>
    request<Order>("/orders", {
      method: "POST",
      body: JSON.stringify({ items: items.map((item) => ({ ...item, unitPriceInMinorUnits: 0 })) }),
    }),
  resume: (id: string) =>
    request<Order>(`/orders/${encodeURIComponent(id)}/payment`, { method: "POST" }),
};
