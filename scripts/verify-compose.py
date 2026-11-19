#!/usr/bin/env python3
"""Run the HTTP/event smoke against a disposable Compose ecommerce_test stack."""
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
env = os.environ.copy()
for line in (root / "infra/.env").read_text().splitlines():
    if line.strip() and not line.lstrip().startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        env.setdefault(key.strip(), value.strip().strip('"').strip("'"))

if env.get("COMPOSE_DB_NAME") != "ecommerce_test":
    raise SystemExit("Start a disposable ecommerce_test Compose stack before running the smoke test")

compose = ["docker", "compose", "-f", str(root / "infra/compose.yaml")]


def run(*args):
    subprocess.run(compose + list(args), env=env, check=True)


# Verify the running container before touching the relay.
run(
    "exec", "-T", "api", "node", "-e",
    'if (process.env.DB_NAME !== "ecommerce_test" || '
    'process.env.MONGODB_DB_NAME !== "ecommerce_test" || '
    'process.env.ORDER_STORAGE !== process.argv[1]) process.exit(1)',
    env.get("ORDER_STORAGE", "postgres"),
)
run("stop", "outbox-relay")
payment_id = None
relay_started = False
try:
    command = compose + ["exec", "-T"]
    for role in ("READER", "MANAGER", "UNPRIVILEGED"):
        command += ["-e", f"ECOMMERCE_{role}_CLIENT_SECRET"]
    command += ["api", "node", "--input-type=module"]
    with (root / "scripts/verify-compose.mjs").open() as script:
        with subprocess.Popen(command, env=env, stdin=script, stdout=subprocess.PIPE, text=True) as child:
            for line in child.stdout:
                print(line, end="", flush=True)
                if line.startswith("OWNED_PAYMENT "):
                    payment_id = line.split()[1]
                if line.strip() == "OUTBOX_PENDING_VERIFIED":
                    run("restart", "outbox-relay")
                    relay_started = True
            if child.wait():
                raise SystemExit("Container smoke failed")
finally:
    try:
        if payment_id:
            cleanup = (
                "const {DatabaseSync}=require('node:sqlite');"
                "const db=new DatabaseSync(process.env.PAYMENT_DATABASE_PATH);"
                "db.prepare('DELETE FROM payments WHERE payment_id=?').run(process.argv[1]);"
                "db.close();"
            )
            run("exec", "-T", "payment-provider", "node", "-e", cleanup, payment_id)
    finally:
        if not relay_started:
            run("restart", "outbox-relay")
