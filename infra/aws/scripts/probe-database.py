#!/usr/bin/env python3
"""Read-only RDS startup diagnostic: emits only SQLSTATE and expected role/database names."""
import json
import subprocess
code = '''import {loadDatabaseConfig} from './dist/config/env.js';
import {createPool} from './dist/database/pool.js';
let pool;
try {
 pool=createPool(loadDatabaseConfig());
 console.log({operation:'db-probe',ssl:(await pool.query('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()')).rows[0].ssl});
 console.log({operation:'db-probe',roles:(await pool.query("SELECT rolname FROM pg_roles WHERE rolname IN ('ecommerce_runtime','ecommerce_migration','ecommerce_keycloak')")).rows});
 console.log({operation:'db-probe',databases:(await pool.query("SELECT datname FROM pg_database WHERE datname IN ('ecommerce_prod','keycloak_prod')")).rows});
} catch(e) {console.log({operation:'db-probe',name:e.name,code:e.code});process.exitCode=1;} finally {await pool?.end();}'''
network = {"awsvpcConfiguration": {"subnets": ["subnet-0cbeb9371ea7783c0", "subnet-0ba6867cacb3d8149"], "securityGroups": ["sg-01773ba489c9c1153"], "assignPublicIp": "ENABLED"}}
args = ["aws", "--profile", "cloudops", "--region", "ap-south-1", "ecs", "run-task", "--cluster", "ecommerce-dev", "--launch-type", "FARGATE", "--task-definition", "ecommerce-dev-database-bootstrap", "--network-configuration", json.dumps(network), "--overrides", json.dumps({"containerOverrides": [{"name": "migration", "command": ["node", "--input-type=module", "-e", code]}]}), "--query", "tasks[].taskArn", "--output", "json"]
subprocess.run(args, check=True)
