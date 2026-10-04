export function canManageCatalog(roles: readonly string[]) {
  return roles.some((role) => role === "catalog_manager" || role === "admin");
}
export function canManageOrders(roles: readonly string[]) {
  return roles.some((role) => role === "order_manager" || role === "admin");
}
export function safeReturnPath(path: string) {
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") && !/[\u0000-\u0020]/.test(path) ? path : "/";
}
export function profileFromClaims(claims: Record<string, unknown> | undefined) {
  const text = (key: string) => (typeof claims?.[key] === "string" ? String(claims[key]) : "");
  return {
    username: text("preferred_username"),
    firstName: text("given_name"),
    lastName: text("family_name"),
    email: text("email"),
    emailVerified: typeof claims?.email_verified === "boolean" ? claims.email_verified : null,
  };
}
