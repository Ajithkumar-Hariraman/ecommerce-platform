#!/usr/bin/env python3
"""Push local verified images with an immutable source identifier; never push Git."""
import hashlib
import os
import pathlib
import subprocess
import tempfile
root = pathlib.Path(__file__).resolve().parents[3]
head = subprocess.check_output(["git", "rev-parse", "--short=12", "HEAD"], cwd=root).decode().strip()
paths = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root).split(b"\0")
digest = hashlib.sha256()
for raw in sorted(set(paths)):
    if not raw:
        continue
    path = root / os.fsdecode(raw)
    if path.is_file():
        digest.update(raw + b"\0" + path.read_bytes())
tag = head + "-" + digest.hexdigest()[:12]
registry = "201943655840.dkr.ecr.ap-south-1.amazonaws.com"
with tempfile.TemporaryDirectory(prefix="ecommerce-ecr-") as config:
    password = subprocess.check_output(["aws", "ecr", "get-login-password", "--profile", "cloudops", "--region", "ap-south-1"])
    subprocess.run(["docker", "--config", config, "login", "--username", "AWS", "--password-stdin", registry], input=password, check=True, stdout=subprocess.DEVNULL)
    for image in ["api", "keycloak", "web"]:
        target = f"{registry}/ecommerce-{image}:{tag}"
        subprocess.run(["docker", "tag", f"ecommerce-{image}:aws-validation", target], check=True)
        subprocess.run(["docker", "--config", config, "push", target], check=True)
pathlib.Path("/tmp/ecommerce-release-tag").write_text(tag + "\n")
print("Release identifier: " + tag)
