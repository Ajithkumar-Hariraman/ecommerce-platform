export interface AuthenticatedPrincipal {
  subject: string;
  username?: string;
  roles: readonly string[];
  scopes: readonly string[];
}
