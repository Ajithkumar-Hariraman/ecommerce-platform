#!/usr/bin/env python3
"""Run the complete host test runner against Compose infrastructure (test DB only)."""
from pathlib import Path
from urllib.parse import quote
import os,subprocess
root=Path(__file__).resolve().parents[1]
env=os.environ.copy()
for line in (root/'infra/.env').read_text().splitlines():
    if line and not line.startswith('#') and '=' in line:
        key,value=line.split('=',1);env[key]=value.strip().strip(chr(34)).strip(chr(39))
env.update(DB_HOST='127.0.0.1',DB_PORT='5433',DB_USER='ecommerce_app',DB_NAME='ecommerce_dev',DB_TEST_NAME='ecommerce_test',OIDC_TEST_ISSUER='http://127.0.0.1:8180/realms/ecommerce')
env['MONGODB_TEST_URI']='mongodb://'+quote(env['MONGO_INITDB_ROOT_USERNAME'],safe='')+':'+quote(env['MONGO_INITDB_ROOT_PASSWORD'],safe='')+'@127.0.0.1:27018/?authSource=admin'
# Fixed well-known local mappings match the existing complete integration conventions.
subprocess.run(['npm','run','test:integration'],cwd=root/'apps/api',env=env,check=True)
