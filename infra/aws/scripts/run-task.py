#!/usr/bin/env python3
"""Run an explicit ECS task and require a successful container exit before continuing."""
import os
import json
import subprocess
import sys
aws = ["aws", "--region", "ap-south-1"]
if not os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"):
    aws += ["--profile", "cloudops"]
def call(args):
    return json.loads(subprocess.check_output(aws + args + ["--output", "json"]))
if len(sys.argv) != 2 or sys.argv[1] not in ["database-bootstrap", "migration", "verification"]:
    sys.exit("Usage: run-task.py database-bootstrap|migration|verification")
network = {"awsvpcConfiguration": {"subnets": ["subnet-0cbeb9371ea7783c0", "subnet-0ba6867cacb3d8149"], "securityGroups": ["sg-0d6cbc7bbf664f875" if sys.argv[1] == "verification" else "sg-01773ba489c9c1153"], "assignPublicIp": "ENABLED"}}
result = call(["ecs", "run-task", "--cluster", "ecommerce-dev", "--launch-type", "FARGATE", "--task-definition", "ecommerce-dev-" + sys.argv[1], "--network-configuration", json.dumps(network)])
if result.get("failures") or len(result.get("tasks", [])) != 1:
    sys.exit("RunTask failed; inspect ECS failures without exposing secrets")
arn = result["tasks"][0]["taskArn"]
print("Started " + arn, flush=True)
subprocess.run(aws + ["ecs", "wait", "tasks-stopped", "--cluster", "ecommerce-dev", "--tasks", arn], check=True)
result = call(["ecs", "describe-tasks", "--cluster", "ecommerce-dev", "--tasks", arn])
containers = result["tasks"][0].get("containers", [])
if not containers or any(c.get("exitCode") != 0 for c in containers):
    sys.exit("Task did not exit successfully; inspect /ecommerce/dev/migration logs")
print("Task exit code: 0")
