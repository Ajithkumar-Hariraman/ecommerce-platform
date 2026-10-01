#!/usr/bin/env python3
"""Generate disposable credentials on an ephemeral CI runner; never overwrite local config."""
from pathlib import Path
import secrets
root=Path(__file__).resolve().parents[1]
p=root/'infra/.env'
if p.exists(): raise SystemExit('Refusing to overwrite existing infra/.env')
values={k:secrets.token_hex(24) for k in ['MONGO_INITDB_ROOT_PASSWORD','KC_BOOTSTRAP_ADMIN_PASSWORD','ECOMMERCE_READER_CLIENT_SECRET','ECOMMERCE_MANAGER_CLIENT_SECRET','ECOMMERCE_UNPRIVILEGED_CLIENT_SECRET','POSTGRES_PASSWORD','DB_PASSWORD','PAYMENT_WEBHOOK_SECRET']}
values.update(MONGO_INITDB_ROOT_USERNAME='ecommerce_ci',KC_BOOTSTRAP_ADMIN_USERNAME='ecommerce_ci',COMPOSE_DB_NAME='ecommerce_test')
values['COMPOSE_MONGODB_URI']='mongodb://ecommerce_ci:'+values['MONGO_INITDB_ROOT_PASSWORD']+'@mongodb:27017/?authSource=admin'
with p.open('x') as f:
    f.write(''.join(k+'='+v+'\n' for k,v in values.items()))
p.chmod(0o600)
print('Disposable CI configuration generated; values withheld')
