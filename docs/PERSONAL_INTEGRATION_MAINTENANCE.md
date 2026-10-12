# Daily fork maintenance and image publishing

Scope: `/Users/traceywooden/bookorbit`, `personal-integration`, upstream `bookorbit/bookorbit`, fork `rygwdn/bookorbit`. Build/publish only. Never deploy the production server or edit witchhunt. Read installed `bookorbit-upstream-rebase` and `bookorbit-deploy` skills before each run. Repository instructions and current user authorization take precedence.

## Hermes scheduled OMP contract

Run one noninteractive OMP task daily with this document as the procedure. Record command exit codes, full output artifact paths, before/after refs, test results, workflow URL, registry digest and source SHA in the scheduler's durable run record. Do not print environment variables or secrets. Set a finite scheduler deadline longer than the 45-minute CI build timeout. A timeout is an unresolved run, never success.

The scheduled task may fetch, create backup refs, perform a conflict-free integration rebase, run checks and publish via the existing workflow if all gates below pass. It must stop for conflict decisions, semantic adaptations requiring test-first changes, migration lineage changes, unexpected dirty files, concurrent changes, or rewritten published history. Never force-push noninteractively. Never restack topics merely because they share ancestry.

## Lock and discovery

Hold an atomic directory lock for the entire task, including remote artifact readback. On macOS, use `mkdir`, not a presumed `flock` installation. Run these commands in one persistent shell owned by the scheduled task:

```sh
set -eu
cd /Users/traceywooden/bookorbit
COMMON=$(git rev-parse --git-common-dir)
LOCK="$COMMON/hermes-maintenance.lock"
mkdir "$LOCK" || { echo 'BLOCKED: another run or stale lock'; exit 1; }
trap 'rmdir "$LOCK"' EXIT
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BRANCH=$(git branch --show-current)
[ "$BRANCH" = personal-integration ]
[ -z "$(git status --porcelain)" ]
[ ! -d "$COMMON/rebase-merge" ]
[ ! -d "$COMMON/rebase-apply" ]
[ ! -f "$COMMON/MERGE_HEAD" ]
git remote -v
git worktree list
git branch -vv
git config --get-regexp 'branch\.|remote\..*\.(url|fetch)|.*stack.*|.*graphite.*' || true
git for-each-ref --format='%(refname) %(objectname)' refs
UPSTREAM_DEFAULT=$(git ls-remote --symref upstream HEAD)
printf '%s\n' "$UPSTREAM_DEFAULT"
```

Confirm upstream default is `refs/heads/main`, remotes match the repositories above, and active stack metadata does not designate a different integration scope. Inspect common-directory metadata as well as Git configuration. Never remove a stale lock automatically: require an operator to establish the previous owner has stopped. Other branches, worktrees and existing stashes are not inputs to this operation.

## Backups, fetch and upstream report

```sh
BEFORE=$(git rev-parse HEAD)
OLD_UPSTREAM=$(git rev-parse upstream/main)
OLD_ORIGIN=$(git rev-parse origin/personal-integration)
git branch --no-track "backup/personal-integration-pre-upstream-rebase-$STAMP" "$BEFORE"
git branch --no-track "backup/upstream-main-before-fetch-$STAMP" "$OLD_UPSTREAM"
git branch --no-track "backup/origin-personal-integration-before-fetch-$STAMP" "$OLD_ORIGIN"
git fetch upstream
git fetch origin
NEW_UPSTREAM=$(git rev-parse upstream/main)
REMOTE=$(git rev-parse origin/personal-integration)
printf 'before=%s oldUpstream=%s newUpstream=%s remote=%s\n' "$BEFORE" "$OLD_UPSTREAM" "$NEW_UPSTREAM" "$REMOTE"
git log --oneline "$OLD_UPSTREAM..$NEW_UPSTREAM"
git diff --stat "$OLD_UPSTREAM" "$NEW_UPSTREAM"
git log --oneline upstream/main..HEAD
git diff --name-only "$OLD_UPSTREAM" "$NEW_UPSTREAM" -- server/src/db
[ "$BEFORE" = "$REMOTE" ] || { echo 'BLOCKED: local/remote divergence needs review'; exit 1; }
```

Summarize meaningful changes, not just commit counts. No upstream commits means an empty range, not a fabricated feature summary. Before rebase, inspect changed contracts and migration files. Preserve shipped SQL hashes, tags and timestamps. Migration changes require human review and the skill's old-image/new-image runtime replay plus fresh-install schema comparison on disposable local PostgreSQL. No production deployment is authorized by this procedure. Report API/plugin/workflow contract changes to the parallel witchhunt worker without editing its repository.

Journal indices and timestamps define runtime ordering. Shipped filename prefixes need not match journal indices or lexical journal order after lineage reconciliation. The permanent journal test checks contiguous indices, unique tags, valid increasing timestamps and referenced SQL existence. Do not rename shipped files or rewrite timestamps to satisfy incidental filename-order assertions. Check SQL/journal set completeness separately during maintenance.

## Integration and verification gates

If migrations, deletions or behavior choices need interpretation, stop before integration and report exact files and decisions. Otherwise:

```sh
git rebase upstream/main
```

On any conflict, stop and retain the in-progress state and backups. Do not resolve automatically by choosing ours/theirs. Semantic adaptations must begin with a relevant failing behavior test, followed by implementation and passing verification. A no-op rebase requires no semantic test additions.

```sh
pnpm install --frozen-lockfile
pnpm verify
SHA=$(git rev-parse HEAD)
SHORT=$(printf '%s' "$SHA" | cut -c1-12)
docker build --build-arg "APP_VERSION=sha-$SHORT" -t "bookorbit-maintenance:$SHORT" .
```

Run the built image against a uniquely named disposable local PostgreSQL container using `pgvector/pgvector:pg18`, a uniquely named Docker network and ephemeral test credentials. Publish the app only on `127.0.0.1` with a dynamically assigned port. Observe actual entrypoint migration completion and HTTP 200 at `/api/v1/health`. Never mount production data or use production credentials. Record logs and health response. Stop only containers created by this run; do not prune unrelated Docker resources. Keep evidence of failures. Do not publish until verification passes.

Example smoke commands, executed while holding the same lock:

```sh
NET="bookorbit-maintenance-$STAMP"
PG="$NET-pg"
APP="$NET-app"
docker network create "$NET"
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=smoke -e POSTGRES_PASSWORD=local-smoke-only \
  -e POSTGRES_DB=smoke pgvector/pgvector:pg18
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U smoke -d smoke; then ready=true; break; fi
  sleep 2
done
[ "$ready" = true ]
docker run -d --name "$APP" --network "$NET" -p 127.0.0.1::3000 \
  -e "DATABASE_URL=postgresql://smoke:local-smoke-only@$PG:5432/smoke" \
  -e JWT_SECRET=disposable-smoke-jwt-not-production \
  -e SETUP_BOOTSTRAP_TOKEN=disposable-smoke-bootstrap-not-production \
  -e PODCAST_ENCRYPTION_KEY=disposable-smoke-podcast-not-production \
  -e APP_URL=http://localhost:3000 "bookorbit-maintenance:$SHORT"
PORT=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}' "$APP")
healthy=false
for attempt in $(seq 1 90); do
  if curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/v1/health"; then healthy=true; break; fi
  sleep 2
done
docker logs "$APP"
[ "$healthy" = true ]
docker exec "$PG" psql -U smoke -d smoke -Atqc \
  'select count(*), max(created_at) from drizzle.__drizzle_migrations'
docker stop "$APP" "$PG"
```

`sleep` above is bounded application-readiness retry, not CI polling. On failure, retain logs and stop the run-owned containers after collecting evidence. Retain stopped scratch resources for operator cleanup; never automatically delete existing resources.

## Publish without rewriting published history

Use `.github/workflows/deploy-image.yml`, not upstream's release workflow. This builds `linux/amd64` and publishes `ghcr.io/rygwdn/bookorbit:personal-integration` and `:sha-<12-character-SHA>`.

```sh
LIVE=$(git ls-remote origin refs/heads/personal-integration | cut -f1)
[ "$LIVE" = "$REMOTE" ] || { echo 'BLOCKED: origin changed during run'; exit 1; }
git merge-base --is-ancestor "$LIVE" HEAD || {
  printf 'BLOCKED: force-with-lease approval required branch=personal-integration expectedRemote=%s candidate=%s\n' "$LIVE" "$SHA"
  exit 1
}
```

Never force-push without separate explicit approval for the exact branch and expected remote tip. A runbook documentation commit may be published using an ordinary fast-forward push after formatting and checks. Do not commit unrelated files.

Duplicate-run guard: use `gh run list --repo rygwdn/bookorbit --workflow deploy-image.yml --limit 100 --json databaseId,headSha,status,conclusion,url`. Filter by exact `$SHA`, not the latest run. Reuse a running or successful matching run. If no matching run exists and HEAD equals origin, explicitly dispatch:

```sh
gh workflow run deploy-image.yml --repo rygwdn/bookorbit --ref personal-integration
```

If a fast-forward push is needed, `git push origin HEAD:personal-integration` triggers the workflow; do not also dispatch. Capture the matching run ID, then:

```sh
RUN_ID=$(gh run list --repo rygwdn/bookorbit --workflow deploy-image.yml \
  --limit 100 --json databaseId,headSha,status,conclusion \
  --jq "map(select(.headSha == \"$SHA\")) | .[0].databaseId // empty")
[ -n "$RUN_ID" ] || { echo 'BLOCKED: matching workflow run not visible yet; retain run record for operator review'; exit 1; }
gh run watch --repo rygwdn/bookorbit "$RUN_ID" --exit-status
gh run view --repo rygwdn/bookorbit "$RUN_ID" --json headSha,status,conclusion,url,jobs
docker buildx imagetools inspect "ghcr.io/rygwdn/bookorbit:sha-$SHORT"
docker buildx imagetools inspect "ghcr.io/rygwdn/bookorbit:personal-integration"
docker buildx imagetools inspect "ghcr.io/rygwdn/bookorbit:sha-$SHORT" \
  --format '{{json .Provenance.SLSA.runDetails.metadata.buildkit_metadata.vcs}}'
REG_SHA=$(docker buildx imagetools inspect "ghcr.io/rygwdn/bookorbit:sha-$SHORT" \
  --format '{{.Provenance.SLSA.runDetails.metadata.buildkit_metadata.vcs.revision}}')
[ "$REG_SHA" = "$SHA" ] || { echo 'BLOCKED: registry source revision mismatch'; exit 1; }
```

Verify both tags resolve to the same registry manifest digest and the successful run's `headSha` equals `$SHA`. Read the remote manifest/BuildKit provenance and verify its source revision, not just the tag spelling. `docker buildx imagetools inspect --raw` and the attestation manifest expose the provenance; use an anonymous GHCR pull token when needed, keeping the token only in memory and never printing it. Pull by verified digest for runtime readback. Verify `APP_VERSION=sha-$SHORT` and `linux/amd64`. Missing or mismatching provenance, digest, version, architecture or workflow SHA is a blocker, not success.

## Completion and blockers

Report backup refs; upstream before/after range and summary; integration outcome; untouched branch/stack scope; actual check/build/smoke output; workflow URL; image URL, tags, digest and source SHA; witchhunt contract impact; unresolved issues. Never claim production deployment. Failed checks, dirty worktrees, changed remote tips, conflicts, schema decisions, missing registry provenance, missing credentials, stale locks and required force-push approval must fail closed with an actionable report. Do not reset, discard, delete branches, edit migration ledgers, expose secrets or silently reduce verification.

## Behavioral compatibility notes

The 2026-10-11 maintenance pass removed invalid migration filename-order checks without changing shipped migrations. It also restored the user-form Workflows permission group: Admin selects both `run_workflows` and `manage_workflows`, Standard selects neither, and backend authorization is unchanged.

The user explicitly superseded the teardown/rearm approach and dependency patch proposal. The task-introduced watcher implementation, async caller migrations, associated tests and Chokidar patch/config/lockfile changes were reverted. `FileWatcherService.pauseWatcher()` and `resumeWatcher()` retain their original synchronous `boolean` contract and live watcher handles. No Chokidar patch was installed or retained.

The original assertion in `server/src/modules/scanner/file-watcher.service.test.ts`, test `pauseWatcher() against a real filesystem > ignores a file created while paused and sees one created after resuming`, remains intact: processed paths must not contain `while-paused.epub`, and must contain `after-resume.epub`. Fixed sleeps were removed; the test waits for the actual post-resume event. It is not skipped or weakened.

The user explicitly authorized a temporary, one-release exception for the original paused-event assertion failure on macOS and Linux, with investigation deferred. This is a recorded failure, not a green gate. Every other gate must pass; no test skip, fixed sleep, weakened assertion, watcher behavior change or Chokidar patch is authorized. This exception does not automatically waive future scheduled runs.

The same paused-event leakage was observed in the original Linux/arm64 local image and the existing published Linux/amd64 image, using real file writes, no fixed sleeps and no injected stale callback. Both delivered `while-paused.epub` as well as `after-resume.epub`. The release report must identify all observed platforms rather than describe the failure as macOS-only. Publication remains authorized under the explicit exception for this same original failure only.

For a parallel witchhunt worker: no HTTP routes, request DTOs, response shapes, plugin APIs, watcher service signatures or database schema changed. Workflow permission administration is now available through the existing user form. Do not integrate newer upstream or feature-unification work as part of this maintenance pass.

The 2026-10-12 history-only maintenance pass groups local follow-up commits by feature before rebasing. Previously shipped migration SQL and journal timestamps remain unchanged; colliding snapshot filenames are retained separately. Workflow output delivery carries the output file's own revision and filesystem identity into upstream delivery selection, while upstream's default streaming behavior remains intact. History maintenance does not authorize publication or production deployment.

Deployment preflight for that rebase found `0106_add_book_request_pairs` below production's migration watermark, with both request-pair columns absent. Generated forward migration `0115_reconcile_skipped_request_pairs` restores the two columns, foreign keys, and partial indexes with idempotent guards. Shipped migration SQL and timestamps are not rewritten.
