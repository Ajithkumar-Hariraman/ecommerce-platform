#!/usr/bin/env python3
"""Generate private Compose credentials for a fresh development or CI stack."""
from argparse import ArgumentParser
import os
from pathlib import Path
import secrets

parser = ArgumentParser(description=__doc__)
parser.add_argument(
    "--database", choices=("ecommerce_test", "ecommerce_dev"), default="ecommerce_test"
)
args = parser.parse_args()

path = Path(__file__).resolve().parents[1] / "infra/.env"
secret_names = (
    "MONGO_INITDB_ROOT_PASSWORD",
    "KC_BOOTSTRAP_ADMIN_PASSWORD",
    "ECOMMERCE_READER_CLIENT_SECRET",
    "ECOMMERCE_MANAGER_CLIENT_SECRET",
    "ECOMMERCE_UNPRIVILEGED_CLIENT_SECRET",
    "POSTGRES_PASSWORD",
    "DB_PASSWORD",
    "PAYMENT_WEBHOOK_SECRET",
)
values = {name: secrets.token_hex(24) for name in secret_names}
values.update(
    MONGO_INITDB_ROOT_USERNAME="ecommerce_ci",
    KC_BOOTSTRAP_ADMIN_USERNAME="ecommerce_ci",
    COMPOSE_DB_NAME=args.database,
)
values["COMPOSE_MONGODB_URI"] = (
    f"mongodb://{values['MONGO_INITDB_ROOT_USERNAME']}:"
    f"{values['MONGO_INITDB_ROOT_PASSWORD']}@mongodb:27017/?authSource=admin"
)
try:
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as config:
        for key, value in values.items():
            config.write(f"{key}={value}\n")
except FileExistsError:
    raise SystemExit("Refusing to overwrite existing infra/.env") from None

print("Private Compose configuration generated; values withheld")
