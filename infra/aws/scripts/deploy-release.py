#!/usr/bin/env python3
"""Register immutable releases, gate deployment on migration success, wait for stability."""
import json
import os
import pathlib
import re
import subprocess
import sys
if len(sys.argv) != 2 or not re.fullmatch(r"[a-f0-9]{12,40}(?:-[a-f0-9]{8,16})?", sys.argv[1]):
    sys.exit("Supply an immutable Git/source release identifier")
aws = ["aws", "--region", "ap-south-1"]
if not os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"):
    aws += ["--profile", "cloudops"]
def call(args):
    return json.loads(subprocess.check_output(aws + args + ["--output", "json"]))
def register(name):
    task = call(["ecs", "describe-task-definition", "--task-definition", "ecommerce-dev-" + name])["taskDefinition"]
    keep = ["family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory", "runtimePlatform", "ephemeralStorage"]
    task = {k:v for k,v in task.items() if k in keep}
    repository = "keycloak" if name == "keycloak" else "web" if name == "web" else "api"
    for container in task["containerDefinitions"]:
        container["image"] = f"201943655840.dkr.ecr.ap-south-1.amazonaws.com/ecommerce-{repository}:{sys.argv[1]}"
    return call(["ecs", "register-task-definition", "--cli-input-json", json.dumps(task)])["taskDefinition"]["taskDefinitionArn"]
register("migration")
subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("run-task.py")), "migration"], check=True)
for group in [["keycloak"], ["api", "relay", "worker"], ["web"]]:
    for name in group:
        arn = register(name)
        call(["ecs", "update-service", "--cluster", "ecommerce-dev", "--service", "ecommerce-" + name, "--task-definition", arn, "--desired-count", "1"])
    subprocess.run(aws + ["ecs", "wait", "services-stable", "--cluster", "ecommerce-dev", "--services"] + ["ecommerce-" + n for n in group], check=True)
print("Migration and service stabilization completed; E2E verification remains required.")
