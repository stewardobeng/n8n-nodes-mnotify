#!/usr/bin/env bash
#
# End-to-end load test: install this package into a real n8n instance and execute it.
#
# Proves, against a throwaway n8n:
#   1. the package installs the way a self-hosted user installs it
#   2. n8n registers the node types (mNotify, mNotify Tool, mNotify Trigger)
#   3. a stored workflow executes the node against the live mNotify API and returns data
#
# Requires: docker, and MN_API_KEY in the environment. The key is passed into the container as an
# environment variable, substituted inside the container's own filesystem, and never written to
# this repository or printed by this script.
#
# Usage:  MN_API_KEY=... bash test/manual/docker-load-verify.sh
#
set -euo pipefail

: "${MN_API_KEY:?set MN_API_KEY before running this script}"

NAME="${NAME:-n8n-mnotify-verify}"
IMAGE="${IMAGE:-n8nio/n8n:latest}"
PORT="${PORT:-5688}"
VOL="${VOL:-/tmp/n8n-mnotify-verify}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# n8n needs a task broker port that is free; the CLI execute runs in its own container so that it
# does not collide with the long-running instance sharing the same user folder.
N8N_ENV=(
	-e NODE_OPTIONS=--max-old-space-size=512
	-e N8N_DIAGNOSTICS_ENABLED=false
	-e N8N_VERSION_NOTIFICATIONS_ENABLED=false
	-e GENERIC_TIMEZONE=UTC
)

wait_for_n8n() {
	for _ in $(seq 1 60); do
		if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/healthz/readiness" || true)" = "200" ]; then
			echo "    n8n ready"
			return 0
		fi
		sleep 3
	done
	echo "    n8n did not become ready; last container log lines:" >&2
	docker logs "$NAME" 2>&1 | tail -5 >&2
	return 1
}

echo "== 1. build and pack"
cd "$REPO"
npm run build >/dev/null
TARBALL="$(npm pack --silent | tail -1)"
echo "    $TARBALL"

echo "== 2. fresh n8n instance"
docker rm -f "$NAME" >/dev/null 2>&1 || true
mkdir -p "$VOL"
# The container runs as uid 1000, which is not necessarily this shell's uid, so the mount point
# itself has to be writable by it: n8n writes its settings file and encryption key there and
# dies with EACCES on /home/node/.n8n/config otherwise. Throwaway test volume, hence 777.
chmod 777 "$VOL"
# Contents inside the volume are owned by the container's uid, so it clears them itself; a host
# rm would fail with permission denied on the installed package's files.
docker run --rm -v "${VOL}:/home/node/.n8n" --entrypoint sh "$IMAGE" -lc \
	'rm -rf /home/node/.n8n/* /home/node/.n8n/.[!.]* 2>/dev/null'
docker run -d --name "$NAME" --memory=1200m --memory-swap=1200m "${N8N_ENV[@]}" \
	-e N8N_SECURE_COOKIE=false -e N8N_LOG_LEVEL=info \
	-p "127.0.0.1:${PORT}:5678" -v "${VOL}:/home/node/.n8n" "$IMAGE" >/dev/null
wait_for_n8n

echo "== 3. install the package the manual way"
# --legacy-peer-deps: the package declares n8n-workflow as a peer, like every published community
# node does. A plain npm install would try to fetch n8n-workflow from the registry and, in this
# image, fail building its native isolated-vm dependency. n8n supplies n8n-workflow at runtime.
docker cp "$TARBALL" "${NAME}:/tmp/pkg.tgz" >/dev/null
docker exec "$NAME" sh -lc \
	'mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --no-audit --no-fund --legacy-peer-deps /tmp/pkg.tgz 2>&1 | tail -2'
docker restart "$NAME" >/dev/null
wait_for_n8n

echo "== 4. registered node types"
docker exec "$NAME" sh -lc 'n8n export:nodes --output=/tmp/nodes.json >/dev/null 2>&1
node -e "
	const n = require(\"/tmp/nodes.json\");
	const list = Array.isArray(n) ? n : (n.data || []);
	const mine = list.filter((x) => String(x.name).includes(\"mnotify\"));
	if (mine.length < 3) { console.error(\"expected 3 registered node types, got \" + mine.length); process.exit(1); }
	mine.forEach((x) => console.log(\"    \" + x.name + \" (\" + x.displayName + \")\"));
	console.log(\"    total node types in this instance: \" + list.length);
"'

echo "== 5. import the credential and the test workflows"
# The volume was cleared in step 2, so this database is fresh and repeated runs are identical.
docker cp test/manual/verify-credentials.template.json "${NAME}:/tmp/creds.template.json" >/dev/null
# The key is substituted inside the container from the environment; the file lives only there.
docker exec -e MN_KEY="$MN_API_KEY" "$NAME" sh -lc \
	'sed "s|__MN_API_KEY__|$MN_KEY|" /tmp/creds.template.json > /tmp/creds.json && n8n import:credentials --input=/tmp/creds.json'
for wf in verify-balance verify-contacts; do
	docker cp "test/manual/${wf}.workflow.json" "${NAME}:/tmp/${wf}.json" >/dev/null
	docker exec "$NAME" n8n import:workflow --input="/tmp/${wf}.json" >/dev/null
	echo "    imported ${wf}"
done

echo "== 6. execute both workflows against the live API"
for pair in "mnVerifyWf000001:balance" "mnVerifyWf000002:contacts"; do
	id="${pair%%:*}"
	label="${pair##*:}"
	out="$(docker run --rm --memory=1200m --memory-swap=1200m "${N8N_ENV[@]}" \
		-v "${VOL}:/home/node/.n8n" --entrypoint sh "$IMAGE" -lc "n8n execute --id=${id} --rawOutput" 2>/tmp/n8n-verify-exec.err || true)"
	printf '%s' "$out" | python3 -c "
import json, sys
raw = sys.stdin.read()
try:
	doc = json.loads(raw[raw.find('{'):raw.rfind('}') + 1])
except Exception:
	print('    $label: could not parse the execution result')
	sys.exit(1)
status = doc.get('status')
runs = doc['data']['resultData']['runData']['mNotify']
items = [i['json'] for e in runs for i in e['data']['main'][0]]
print('    $label: execution=' + str(status) + ', items=' + str(len(items)))
for item in items[:2]:
	print('        ' + json.dumps(item))
if status != 'success':
	sys.exit(1)
"
done

echo
echo "PASS: the package installs, registers and executes against the live mNotify API."
echo "The instance is still running on http://127.0.0.1:${PORT} (docker rm -f ${NAME} to remove it)."
