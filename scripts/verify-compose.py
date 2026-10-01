#!/usr/bin/env python3
"""Run only against the Compose ecommerce_test runtime; clean owned database rows."""
from pathlib import Path
import os, subprocess
root=Path(__file__).resolve().parents[1]
env=os.environ.copy()
for line in (root/'infra/.env').read_text().splitlines():
    if line and not line.startswith('#') and '=' in line:
        key,value=line.split('=',1);env[key]=value.strip().strip(chr(34)).strip(chr(39))
env['COMPOSE_DB_NAME']='ecommerce_test'
compose=['docker','compose','-f',str(root/'infra/compose.yaml')]
subprocess.run(compose+['stop','outbox-relay'],env=env,check=True)
payment_id=None
try:
    command=compose+['exec','-T']
    for role in ['READER','MANAGER','UNPRIVILEGED']:
        command+=['-e','ECOMMERCE_'+role+'_CLIENT_SECRET']
    command+=['api','node','--input-type=module']
    child=subprocess.Popen(command,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    child.stdin.write((root/'scripts/verify-compose.mjs').read_text());child.stdin.close()
    for line in child.stdout:
        print(line,end='',flush=True)
        if line.startswith('OWNED_PAYMENT '): payment_id=line.split()[1]
        if 'OUTBOX_PENDING_VERIFIED' in line:
            subprocess.run(compose+['start','outbox-relay'],env=env,check=True)
    if child.wait(): raise SystemExit('Container smoke failed')
finally:
    if payment_id:
        cleanup="const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.PAYMENT_DATABASE_PATH);db.prepare('DELETE FROM payments WHERE payment_id=?').run(process.argv[1]);db.close();"
        subprocess.run(compose+['exec','-T','payment-provider','node','-e',cleanup,payment_id],env=env,check=True)
    subprocess.run(compose+['start','outbox-relay'],env=env,check=True)
