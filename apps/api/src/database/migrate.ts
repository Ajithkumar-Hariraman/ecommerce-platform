import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { loadDatabaseConfig } from "../config/env.js";
import { createPool } from "./pool.js";

async function migrate(): Promise<void> {
  const target = process.argv.includes("--test") ? "test" : "application";
  const pool = createPool(loadDatabaseConfig(target));
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '30s'");
      // One migrating process at a time, automatically released at transaction end.
      await client.query("SELECT pg_advisory_xact_lock(730003)");
      await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
        version text PRIMARY KEY, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const directory = new URL("../../migrations/", import.meta.url);
      const names = (await readdir(directory)).filter(name => /^\d+_[a-z_]+\.sql$/.test(name)).sort();
      for (const name of names) {
        const sql = await readFile(new URL(name, directory), "utf8");
        const checksum = createHash("sha256").update(sql).digest("hex");
        const applied = await client.query<{ checksum: string }>(
          "SELECT checksum FROM public.schema_migrations WHERE version = $1", [name]);
        if (applied.rows[0]) {
          if (applied.rows[0].checksum !== checksum) throw new Error("Applied migration was modified: " + name);
          console.info("Already applied:", name);
          continue;
        }
        // SQL is a reviewed local migration file, never HTTP input.
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations(version, checksum) VALUES ($1, $2)", [name, checksum]);
        console.info("Applied:", name);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

migrate().catch((error: unknown) => {
  console.error("Migration failed", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
