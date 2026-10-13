#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Private isolated diagnostic adapter; no user credential or live runtime.
from pathlib import Path
import subprocess, json, hashlib, time, datetime, os
q = Path(__file__).resolve().parent
home = q / "inference-home"
for name in ["config", "cache", "data", "state", "tmp"]:
    (home / name).mkdir(parents=True, exist_ok=True, mode=0o700)
env = {
    "PATH": "/usr/bin:/bin",
    "HOME": str(home),
    "XDG_CONFIG_HOME": str(home / "config"),
    "XDG_CACHE_HOME": str(home / "cache"),
    "XDG_DATA_HOME": str(home / "data"),
    "XDG_STATE_HOME": str(home / "state"),
    "TMPDIR": str(home / "tmp"),
    "LANG": "C.UTF-8",
    "TERM": "dumb",
    "OPENCODE_CONFIG": str(q / "probe-opencode-config.json"),
    "OPENCODE_MODELS_PATH": str(q / "models-dev-current-native.json"),
    "OPENCODE_DISABLE_MODELS_FETCH": "true",
    "OPENCODE_DISABLE_PROJECT_CONFIG": "true",
    "OPENCODE_DISABLE_CLAUDE_CODE": "true",
}
client = q / "client/package/bin/opencode"
model = json.loads((q / "probe-opencode-config.json").read_text())["model"]
version_started = datetime.datetime.now(datetime.timezone.utc).isoformat()
version_clock = time.monotonic()
try:
    version = subprocess.run([str(client), "--version"], env=env, check=True,
                             capture_output=True, text=True, timeout=10).stdout.strip()
except subprocess.TimeoutExpired:
    failure = {
        "stage": "version", "clientPath": str(client),
        "clientSha256": hashlib.sha256(client.read_bytes()).hexdigest(),
        "startedAt": version_started,
        "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "elapsedSeconds": time.monotonic() - version_clock,
        "timeoutSeconds": 10, "exitCode": 124, "timedOut": True,
        "diagnosticRunStarted": False, "suppliedProviderCredentials": False,
        "limits": "Version probe failed before HOST diagnostic or model invocation."
    }
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    failure_path = q / f"genuine-host-read-version-failure-{stamp}-{os.getpid()}.json"
    with failure_path.open("x") as failure_file:
        failure_file.write(json.dumps(failure, indent=2) + "\n")
    print(json.dumps({"exitCode": 124, "timedOut": True, "reportPath": str(failure_path)}))
    raise SystemExit(124)
assert version == "1.18.31", version
fixture_paths = sorted((q / "probe-project/fixture").glob("*"))
before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in fixture_paths}
cmd = [str(client), "run", "--pure", "--agent", "plan", "--model", model,
       "--format", "json", "--dir", str(q / "probe-project"),
       (q / "host-read-probe-prompt.txt").read_text()]
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
t = time.monotonic()
timed_out = False
with (q / "genuine-host-read.stdout.jsonl").open("xb") as out, \
     (q / "genuine-host-read.stderr.log").open("xb") as err:
    try:
        result = subprocess.run(cmd, env=env, cwd=q / "probe-project",
                                stdout=out, stderr=err, timeout=600)
        code = result.returncode
    except subprocess.TimeoutExpired:
        timed_out = True
        code = 124
after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in fixture_paths}
report = {
    "clientVersion": version, "clientPath": str(client),
    "clientSha256": hashlib.sha256(client.read_bytes()).hexdigest(),
    "model": model, "suppliedProviderCredentials": False,
    "environmentKeys": sorted(env), "startedAt": started,
    "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "elapsedSeconds": time.monotonic() - t, "exitCode": code, "timedOut": timed_out,
    "fixtureBefore": before, "fixtureAfter": after, "fixtureBytesUnchanged": before == after,
    "stdoutSha256": hashlib.sha256((q / "genuine-host-read.stdout.jsonl").read_bytes()).hexdigest(),
    "stderrSha256": hashlib.sha256((q / "genuine-host-read.stderr.log").read_bytes()).hexdigest(),
    "limits": "Isolated native HOST framing diagnostic. No code review, approval, understanding, live consumer or publication."
}
(q / "genuine-host-read-invocation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({k: report[k] for k in ["clientVersion", "model", "exitCode", "elapsedSeconds", "timedOut", "fixtureBytesUnchanged"]}))
raise SystemExit(code)
