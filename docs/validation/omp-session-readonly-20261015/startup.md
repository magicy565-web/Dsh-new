# Actual npm entry and authority-race follow-up (2026-10-15)

The acceptance task was executed. A temporary real Host was started with the
actual `npm start` command, listened successfully, completed its HTTP/OMP checks,
and was stopped and removed by test cleanup. It is not a running user enterprise
Host and contains no real enterprise records.

## Entry and shortest commands

On the Session read-only branch, the existing entry already loads the new client:

`npm start` → `node --env-file-if-exists=.env scripts/workspace-omp.mjs --serve`
→ `server/index.mjs` → original Agent service → `sessionReadonlyClient` supplied
to the original business conversation adapter.

From a checkout of this branch with the fixed dependencies/runtime installed:

```sh
npm run build
npm start
```

`npm start` starts the original service. It does not manufacture member bindings,
logins, model configuration, budget approval or records when they are absent.
The launcher's `--check` cannot infer an authenticated browser Session from a
shell without one; missing Bearer alone is not proof that Session reads cannot
work. Run this keyless end-to-end acceptance command in the clean test checkout:

```sh
node --test test/workspace-omp-session-*.test.mjs
```

The two Session test files use explicit finite synthetic model responses and
synthetic identity/business data. The startup test launches `npm start` with a
whitelist environment; user model/business credentials are not inherited. It
refuses to run when a repository `.env` exists, so a private dotenv file is never
loaded into the synthetic Host. A test-only Node loader injects the existing OMP
`syntheticResponses` argument, leaving original startup, access/login/CSRF,
Runtime, disk Store, coordinator, OMP SDK and tool handling in use. The Node test
Host rejects outbound fetches; the OMP worker has only the finite synthetic
sequence and cannot fall back to a real provider. No production fixture flag,
identity framework or alternate agent loop was added.

The actual npm startup case verifies:

- Original signed login and CSRF, and an `agent:read`-only existing fixture member
  principal, with no `WS_AGENT_URL` or `WS_AGENT_TOKEN` in the startup environment.
- Original conversation/Run → official OMP SDK → existing task list/result tools.
- Correct owner-only task receipt, original saved result and document SHA.
- Missing principal rejected before another Run, logout rejects result reading,
  and a new Session cannot inherit the old Session's transcript binding.
- The two seeded synthetic business records remain two; no sample task is
  submitted to manufacture an answer.

## Authority-race correction

Review confirmed the shared artifact catch could swallow an internal ownership
404 as an ordinary unavailable artifact. The Session wrapper previously rechecked
only Session/principal authority at the end, allowing stale aggregate metadata
in a task deletion/owner-change race.

No ordinary Agent HTTP route was found that deletes or reassigns a task; the
original projection also treats ownership as immutable. The authoritative Store
is nevertheless reread by `engine.find` around asynchronous projection/artifact
work. Tests exercise concurrent Store deletion/owner changes explicitly as
synthetic maintenance/corruption races, without adding any such user API.

The fix preserves structured HTTP status on transport errors, propagates 401/403
and the original task-ownership rejection out of the artifact catch, and checks
all task IDs in the final aggregate against original `engine.find`. Thus earlier
metadata/events/artifacts cannot become a normal partial result after authority
is lost. Ordinary missing or temporary artifact failures still produce a truthful
partial result when the task remains owned and authorized.

Regressions cover deletion/owner change after a second artifact read, deletion
combined with an artifact I/O failure (which exercises the final aggregate
check), Session revocation during artifact I/O, ordinary unavailable artifacts,
and Bearer HTTP 401/403 during an artifact read.

## Results and real-data prerequisites

- `npm run build`: passed (TypeScript and Vite). Initially missing locked native
  build dependencies were restored with lifecycle scripts disabled; no lockfile
  or production dependency versions changed.
- 42 tests in the selected eight-file regression group passed with no skips.
- Final two-file Session suite: 11 passed, no skips. Ten overlap the group above;
  there are 43 distinct selected tests, not 53.
- Additional paid requests: 0. No deployment, main merge, production credential,
  principal or permission change. Shopify/MCP/Muse source was not modified.

At inspection time, this environment had a DeepSeek key present, but no business
Host URL, Agent principal, enterprise access/origin/member/public-key-file
configuration or OMP price/budget configuration. No authenticated user Host
Session was supplied to this task.
Both worktrees had no `.env` and no default `.data/workspace.json`; the default
`127.0.0.1:8787` Host was unreachable. The separate `/workspace/workspace-agent`
checkout was still at old commit `b9546e1d7e6d7ac1381f84327a4f15cbfc60598f`, so
starting from that checkout would not run this branch's new Session client.

The next real-record check needs the user's already-existing Host location and
its authoritative business data, plus a current original signed enterprise
Session (or the intended original local operator Host), an already-authorized
member/principal with `agent:read`, and a fresh OMP conversation after any Session
rotation. Missing bindings remain refused; lack of access/configuration is not
an empty task list. No real data was read in this follow-up. Sending real records
to a model and any additional paid invocation still require explicit applicable
authorization; this test grants neither.
