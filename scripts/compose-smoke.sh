#!/usr/bin/env bash
# US5 smoke: compose up, write through the collab endpoint, down/up, read back, check the port is loopback-only.
# 002: compile through the Docker socket and fetch the PDF.
set -euo pipefail
cd "$(dirname "$0")/.."

# own project name so `down -v` never touches a real overtree-data volume; images are kept
export COMPOSE_PROJECT_NAME=overtree-smoke
trap 'docker compose down -v >/dev/null 2>&1' EXIT

PORT="${PORT:-3000}"
URL="http://127.0.0.1:$PORT"
WS="ws://127.0.0.1:$PORT/collab"
MARK="% smoke $(date +%s)"

wait_up() {
	for _ in $(seq 60); do
		[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/")" = 200 ] && return 0
		sleep 1
	done
	echo "FAIL: no HTTP 200 on $URL" >&2
	docker compose logs app >&2
	exit 1
}

docker compose up -d --build
wait_up
echo "ok: HTTP 200 on $URL"

result="$(curl -s -X POST -H 'content-type: application/json' -d '{"stopOnFirstError":false}' "$URL/api/compile")"
if ! grep -q '"status":"success"' <<<"$result"; then
	echo "FAIL: compile returned $result" >&2
	exit 1
fi
echo "ok: compile succeeded"

if [ "$(curl -s "$URL/api/compile/output.pdf" | head -c 4)" = "%PDF" ]; then
	echo "ok: output.pdf starts with %PDF"
else
	echo "FAIL: output.pdf is not a PDF" >&2
	exit 1
fi

node --no-warnings scripts/collab-client.ts "$WS" append $'\n'"$MARK"
echo "ok: wrote '$MARK'"

docker compose down
docker compose up -d
wait_up
echo "ok: back up after down/up"

if node --no-warnings scripts/collab-client.ts "$WS" read | grep -qF "$MARK"; then
	echo "ok: text survived down/up"
else
	echo "FAIL: '$MARK' missing after restart" >&2
	exit 1
fi

published="$(docker compose port app 3000)"
case "$published" in
	127.0.0.1:*) echo "ok: published on $published only" ;;
	*) if [ "${OVERTREE_BIND:-127.0.0.1}" = 127.0.0.1 ]; then echo "FAIL: published on $published" >&2; exit 1; fi ;;
esac

echo "PASS"
