#!/usr/bin/env python3
"""Copy explicitly authorized local Test Mode credentials to AWS without outputting values."""
import json
import pathlib
import subprocess
import sys
root = pathlib.Path(__file__).resolve().parents[3]
source = '''import {loadRazorpayConfig} from "./src/config/env.ts";
try { process.stdout.write(JSON.stringify(loadRazorpayConfig())); }
catch { process.exitCode = 1; }'''
try:
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", source], cwd=root / "apps/api", capture_output=True, check=True)
    values = json.loads(result.stdout)
    for name, value in [("razorpay-key-id", values["keyId"]), ("razorpay-key-secret", values["keySecret"]), ("razorpay-webhook-secret", values["webhookSecret"])]:
        subprocess.run(["aws", "secretsmanager", "put-secret-value", "--profile", "cloudops", "--region", "ap-south-1", "--secret-id", "ecommerce/dev/" + name, "--secret-string", "file:///dev/stdin"], input=value.encode(), capture_output=True, check=True)
        print("Configured ecommerce/dev/" + name)
except Exception:
    print("Secret import failed; no credential values were printed. Check local Test Mode configuration and AWS secret provisioning.", file=sys.stderr)
    sys.exit(1)
