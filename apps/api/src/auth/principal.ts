export interface AuthenticatedPrincipal {
  subject: string;
  customer?: { name?: string; email?: string };
  username?: string;
  roles: readonly string[];
  scopes: readonly string[];
}
