#!/usr/bin/env bash
# Smoke test of the Docker image: compose up, sign-in page up, everything else refuses a signed-out caller (pages
# redirect, API 401, /collab refuses), the test sign-in can't start in production, down/up, loopback-only port.
# 005: everything behind sign-in needs a Clerk session, so compile and the text round trip are covered by the e2e
# suite now. Needs the Clerk keys in the environment, e.g. through agent-secret (README.md, Clerk setup).
set -euo pipefail
cd "$(dirname "$0")/.."

# own project name so `down -v` never touches a real overtree-data volume; images are kept
export COMPOSE_PROJECT_NAME=overtree-smoke
trap 'docker compose down -v >/dev/null 2>&1' EXIT

PORT="${PORT:-3000}"
URL="http://127.0.0.1:$PORT"
WS="ws://127.0.0.1:$PORT/collab"

if [ -z "${PUBLIC_CLERK_PUBLISHABLE_KEY:-}" ] || [ -z "${CLERK_SECRET_KEY:-}" ]; then
	echo "FAIL: set PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY (the app exits without them)" >&2
	exit 1
fi

wait_up() {
	for _ in $(seq 60); do
		[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/sign-in")" = 200 ] && return 0
		sleep 1
	done
	echo "FAIL: no HTTP 200 on $URL/sign-in" >&2
	docker compose logs app >&2
	exit 1
}

docker compose up -d --build
wait_up
echo "ok: /sign-in answers 200 on $URL"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() { # <what> <expected> <actual>
	if [ "$3" = "$2" ]; then echo "ok: $1 → $2"; else echo "FAIL: $1 → $3, expected $2" >&2; exit 1; fi
}

location="$(curl -s -o /dev/null -w '%{redirect_url}' "$URL/")"
case "$location" in
	*/sign-in\?redirect=*) echo "ok: / redirects to sign-in" ;;
	*) echo "FAIL: / redirected to '$location'" >&2; exit 1 ;;
esac
expect "GET /api/projects signed out" 401 "$(code "$URL/api/projects")"
expect "POST /api/projects/x/compile signed out" 401 "$(code -X POST -H 'content-type: application/json' -d '{"stopOnFirstError":false}' "$URL/api/projects/x/compile")"
expect "GET /api/projects/x/zip signed out" 401 "$(code "$URL/api/projects/x/zip")"
expect "GET /api/admin/users signed out" 401 "$(code "$URL/api/admin/users")"

node --no-warnings scripts/collab-client.ts "$WS" refused
echo "ok: /collab refuses a connection without a token"

# research R4: the image is a production build, so the test sign-in must refuse to start
if out="$(docker compose run --rm --no-deps -e OVERTREE_TEST_AUTH=1 app 2>&1)"; then
	echo "FAIL: the app started with OVERTREE_TEST_AUTH=1" >&2
	exit 1
fi
grep -q 'refused with NODE_ENV=production' <<<"$out" || { echo "FAIL: unexpected output: $out" >&2; exit 1; }
echo "ok: OVERTREE_TEST_AUTH=1 is refused in the image"

docker compose down
docker compose up -d
wait_up
echo "ok: back up after down/up"

published="$(docker compose port app 3000)"
case "$published" in
	127.0.0.1:*) echo "ok: published on $published only" ;;
	*) if [ "${OVERTREE_BIND:-127.0.0.1}" = 127.0.0.1 ]; then echo "FAIL: published on $published" >&2; exit 1; fi ;;
esac

echo "PASS"
