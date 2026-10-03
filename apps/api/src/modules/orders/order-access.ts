import { AppError } from "../../errors/app-error.js";
import type { AuthenticatedPrincipal } from "../../auth/principal.js";
import type { Order } from "./order.types.js";
export function orderPrincipal(
  principal: AuthenticatedPrincipal | undefined,
): AuthenticatedPrincipal {
  if (!principal || typeof principal.subject !== "string" || !principal.subject.trim())
    throw new AppError(401, "Authentication required");
  return principal;
}
export function assertOrderAccess(
  principal: AuthenticatedPrincipal | undefined,
  order: Order,
): void {
  const actor = orderPrincipal(principal);
  if (actor.roles.some((role) => role === "order_manager" || role === "admin")) return;
  // Unowned historical records never become owned by matching a client-supplied UUID.
  if (!order.ownerSubject || order.ownerSubject !== actor.subject)
    throw new AppError(404, "Order not found");
}
