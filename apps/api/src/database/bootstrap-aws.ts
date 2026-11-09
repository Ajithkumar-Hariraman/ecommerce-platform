// One-time ECS RunTask for a fresh RDS instance, separate from application migrations.
import { loadDatabaseConfig, loadAwsDatabaseBootstrapConfig } from "../config/env.js";
import { createPool } from "./pool.js";
let stage = "configuration";
async function main() {
  const config = loadDatabaseConfig();
  if (
    config.database !== "ecommerce_prod" ||
    !config.ssl ||
    !config.host.endsWith(".rds.amazonaws.com")
  )
    throw new Error("Bootstrap requires verified fresh AWS RDS ecommerce_prod");
  const passwords = loadAwsDatabaseBootstrapConfig();
  const pool = createPool(config);
  const client = await pool.connect();
  try {
    for (const [role, password] of [
      ["ecommerce_runtime", passwords.runtimePassword],
      ["ecommerce_migration", passwords.migrationPassword],
      ["ecommerce_keycloak", passwords.keycloakPassword],
    ]) {
      stage = "create-role";
      const found = await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role]);
      if (!found.rowCount) {
        const statement = await client.query<{ sql: string }>(
          "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
          [role, password],
        );
        await client.query(statement.rows[0]!.sql);
      }
    }
    stage = "grant-bootstrap-membership";
    for (const role of ["ecommerce_migration", "ecommerce_keycloak"]) {
      const grant = await client.query<{ sql: string }>(
        "SELECT format('GRANT %I TO %I WITH SET TRUE', $1::text, $2::text) AS sql",
        [role, config.user],
      );
      await client.query(grant.rows[0]!.sql);
    }
    stage = "create-keycloak-database";
    if (
      !(await client.query("SELECT 1 FROM pg_database WHERE datname=$1", ["keycloak_prod"])).rowCount
    )
      await client.query("CREATE DATABASE keycloak_prod OWNER ecommerce_keycloak");
    stage = "configure-ownership";
    const ownership = await client.query<{ owner: string }>("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname='ecommerce_prod'");
    if (ownership.rows[0]?.owner !== "ecommerce_migration")
      await client.query("ALTER DATABASE ecommerce_prod OWNER TO ecommerce_migration");
    await client.query("SET ROLE ecommerce_migration");
    await client.query("ALTER SCHEMA public OWNER TO ecommerce_migration");
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await client.query("GRANT CONNECT ON DATABASE ecommerce_prod TO ecommerce_runtime");
    await client.query("GRANT USAGE ON SCHEMA public TO ecommerce_runtime");
    await client.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE ecommerce_migration IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ecommerce_runtime",
    );
    await client.query(
      "ALTER DEFAULT PRIVILEGES FOR ROLE ecommerce_migration IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO ecommerce_runtime",
    );
    await client.query("RESET ROLE");
    console.info({ operation: "aws-database-bootstrap", outcome: "complete" });
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error && /^[A-Z0-9]{5}$/.test(String(error.code)) ? String(error.code) : undefined;
  console.error({ operation: "aws-database-bootstrap", outcome: "failed", stage, code });
  process.exitCode = 1;
});
