export type CheckoutMapping = {
  order_id: string;
  payment_id: string;
  idempotency_key: string;
  amount: string;
  currency: "INR";
  provider_order_id: string | null;
  creation_started: boolean;
};
export interface CheckoutSession {
  initialize(input: {
    orderId: string;
    paymentId: string;
    idempotencyKey: string;
    amount: number;
  }): Promise<void>;
  findOrder(orderId: string): Promise<CheckoutMapping | null>;
  startCreation(orderId: string): Promise<boolean>;
  setProviderOrder(orderId: string, providerId: string): Promise<void>;
  recordAttempt(
    paymentId: string,
    orderId: string,
    status: string,
    update: boolean,
  ): Promise<void>;
  claimEvent(
    eventId: string,
    hash: string,
  ): Promise<{ body_hash: string; processed: boolean }>;
  completeEvent(eventId: string): Promise<void>;
}
export interface CheckoutRepository extends CheckoutSession {
  findProviderOrder(providerId: string): Promise<CheckoutMapping | null>;
  locked<T>(
    orderId: string,
    action: (session: CheckoutSession) => Promise<T>,
  ): Promise<T>;
}
