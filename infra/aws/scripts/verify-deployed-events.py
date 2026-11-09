#!/usr/bin/env python3
"""Verify real ECS relay/worker with one owned fixture; this is not a Razorpay checkout."""
import json
import subprocess
import uuid
aws = ["aws", "--profile", "cloudops", "--region", "ap-south-1"]
def call(args):
    return json.loads(subprocess.check_output(aws + args + ["--output", "json"]))
event_id = str(uuid.uuid4())
code = '''import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {loadDatabaseConfig} from './dist/config/env.js';
import {createPool} from './dist/database/pool.js';
import {insertPostgresOutbox} from './dist/outbox/postgres-outbox.repository.js';
import {orderPaid} from './dist/events/order-paid.js';
const event=orderPaid({eventId:EVENT_ID,orderId:randomUUID(),paymentId:randomUUID(),type:'payment.succeeded',occurredAt:new Date().toISOString()});
const pool=createPool(loadDatabaseConfig());
async function until(check) {for(let i=0;i<240;i++){if(await check()) return;await delay(250);}throw new Error('Pipeline deadline');}
async function published(){return (await pool.query('SELECT status FROM outbox_events WHERE event_id=$1',[event.eventId])).rows[0]?.status==='PUBLISHED';}
async function count(){return Number((await pool.query('SELECT count(*) FROM order_notifications WHERE event_id=$1',[event.eventId])).rows[0].count);}
try {
 const client=await pool.connect();try{await insertPostgresOutbox(client,event);}finally{client.release();}
 await until(published);await until(async()=>await count()===1);
 await pool.query("UPDATE outbox_events SET status='PENDING',published_at=NULL,lease_token=NULL,available_at=now() WHERE event_id=$1",[event.eventId]);
 await until(published);await delay(15000);assert.equal(await count(),1);
 console.log({operation:'deployed-event-verification',eventId:event.eventId,outcome:'PASS',notificationCount:1,syntheticFixture:true});
} catch(e){console.error({operation:'deployed-event-verification',eventId:event.eventId,outcome:'FAIL',name:e.name});process.exitCode=1;}
finally {
 await pool.query('DELETE FROM outbox_events WHERE event_id=$1',[event.eventId]);
 await pool.query('DELETE FROM order_notifications WHERE event_id=$1',[event.eventId]);
 await pool.end();console.log({operation:'deployed-event-fixture-cleanup',eventId:event.eventId,outcome:'complete'});
}'''.replace("EVENT_ID", json.dumps(event_id))
network = {"awsvpcConfiguration": {"subnets": ["subnet-0cbeb9371ea7783c0", "subnet-0ba6867cacb3d8149"], "securityGroups": ["sg-01773ba489c9c1153"], "assignPublicIp": "ENABLED"}}
result=call(["ecs","run-task","--cluster","ecommerce-dev","--launch-type","FARGATE","--task-definition","ecommerce-dev-migration","--network-configuration",json.dumps(network),"--overrides",json.dumps({"containerOverrides":[{"name":"migration","command":["node","--input-type=module","-e",code]}]})])
if result.get("failures") or not result.get("tasks"):
    raise SystemExit("Verification RunTask failed")
arn=result["tasks"][0]["taskArn"]
print("Verifying owned event " + event_id,flush=True)
subprocess.run(aws+["ecs","wait","tasks-stopped","--cluster","ecommerce-dev","--tasks",arn],check=True)
task=call(["ecs","describe-tasks","--cluster","ecommerce-dev","--tasks",arn])["tasks"][0]
if any(c.get("exitCode") != 0 for c in task.get("containers",[])):
    raise SystemExit("Deployed event fixture failed; inspect sanitized migration/relay/worker logs")
messages=call(["logs","filter-log-events","--log-group-name","/ecommerce/dev/worker","--filter-pattern",json.dumps(event_id)])
messages=[event["message"] for event in messages.get("events",[])]
if not any('"outcome":"processed"' in message for message in messages) or not any('"outcome":"duplicate"' in message for message in messages):
    raise SystemExit("Worker processing/duplicate logs not both observed; do not claim event-flow PASS")
print("PASS: actual ECS relay -> SNS -> SQS -> actual ECS worker -> one durable notification; duplicate observed; owned fixture cleaned")
