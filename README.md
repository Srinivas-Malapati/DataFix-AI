# DataFix AI

**Messy data in. Trusted data out.**

DataFix AI is an autonomous CSV repair agent. It inspects a dataset, writes Python tailored to that file, runs the code inside a disposable [CreateOS](https://createos.sh) sandbox, independently verifies the result, and repairs its own code when a run fails. CreateOS is provisioned through [Stripe Projects](https://projects.dev).

- **Live app:** https://datafix-ai-hackathon.candyzebra32.chatgpt.site
- **Sample datasets:** https://datafix-ai-hackathon.candyzebra32.chatgpt.site/samples/
- Built for the CreateOS × Stripe Projects hackathon.

## How it works

```text
Browser                                 Server (Cloudflare Worker)                External
───────                                 ──────────────────────────                ────────
1. Upload CSV ─► parse + profile
   (never leaves the browser)
2. Prepare workflow ───────────────────► /api/plan
   headers + 12 sample rows              validate input ─► planner ──────────────► OpenAI (strict JSON schema)
                                         static script policy (repair once if needed)
   ◄──────────────── plan + Python + signed script token
3. Human reviews and approves
4. Execute ────────────────────────────► /api/execute
   CSV + script + token                  verify token signature
                                         agent loop (≤ 3 attempts) ───────────────► CreateOS sandbox
                                           policy check → run → verify             (no ingress, egress blocked,
                                           on failure: AI diagnoses + rewrites      destroyed after the run)
   ◄──────────────── cleaned CSV, logs, attempts, verification
5. Download modified CSV
```

### The agent loop

`lib/server/agent.ts` runs the approved script in a single sandbox. Each attempt can fail in one of five ways:

| Failure | Detected by |
|---|---|
| `policy` | Static check rejects the script before it runs |
| `runtime` | Non-zero exit code |
| `timeout` | The 120 s wall-clock limit enforced by DataFix's own Python launcher |
| `missing_output` | No `/workspace/output.csv` written |
| `validation` | A blocking independent check failed |

On any failure, the error type, summary, and logs go back to the model. The model diagnoses the problem and returns a corrected program. The loop stops at the first verified success or after three attempts. Every attempt, with its logs and the AI's diagnosis, is returned to the UI.

### Independent verification

The model never grades its own work. `lib/server/verify.ts` compares the original file and the output directly:

- **Blocking** (output is withheld if any fail): valid CSV, header preserved, has data, no rows added, consistent row width, no leading or trailing spaces.
- **Advisory** (shown to the reviewer): no exact duplicates remain, and missing values were not filled in.

The second advisory check is a lower bound, not a proof. A key-based dedupe can legitimately keep the row whose blank was filled in another copy, so it doesn't block the output.

### Security model

| Layer | Purpose |
|---|---|
| **CreateOS sandbox**: the isolation boundary | Fresh VM per run, no ingress, egress pinned to an unroutable host, always destroyed in `finally` |
| **Signed script tokens** (`lib/server/signing.ts`) | `/api/execute` only runs code this server generated in the last 2 hours. Tokens are HMAC-SHA256 bound to the exact script, so a client cannot submit arbitrary Python. |
| **Static script policy** (`lib/server/script-policy.ts`) | Allowlist of standard-library imports, with no `eval`/`exec`/`compile`, dunder escapes, or paths outside `/workspace`. This is defense in depth that catches contract violations before spending a sandbox run; the sandbox is the real boundary. |
| **Input limits** (`lib/contract.ts`) | 10 MB CSV, 2,000-character goal, 500 columns, 12 truncated sample rows, size-capped request bodies |
| **Error hygiene** (`lib/server/http.ts`) | Upstream errors are logged server-side and mapped to safe messages, because OpenAI errors can echo key fragments. Unexpected errors return a request ID. |
| **Data minimization** | Only headers and 12 truncated sample rows are sent to OpenAI. The full file goes only to the sandbox. |

## Project layout

```text
app/
  page.tsx, layout.tsx          Marketing shell and metadata
  HowItWorksTour.tsx            Animated walkthrough
  workspace/                    The product UI
    DataFixWorkspace.tsx        Orchestrates the flow
    state.ts                    Reducer: a typed state machine for upload → inspect → plan → execute
    api.ts                      Typed client for the two endpoints
    UploadPanel, InspectionReport, WorkflowReview, ExecutionReport, Toast
  api/plan/route.ts             Thin HTTP adapter → planner
  api/execute/route.ts          Thin HTTP adapter → agent
lib/
  contract.ts                   Shared types, limits, sandbox paths, the script contract
  csv.ts                        Single CSV parser and profiler used by browser and server
  server/
    agent.ts                    Execute → verify → repair loop
    planner.ts                  Prompts, JSON schemas, plan and repair generation
    createos.ts                 CreateOS Sandbox REST client with guaranteed cleanup
    openai.ts                   Responses API client (structured outputs, timeouts)
    verify.ts                   Independent output verification
    script-policy.ts            Static checks on generated code
    signing.ts                  Script token HMAC
    http.ts                     Errors, body limits, validators
tests/
  unit/                         Agent loop, verification, policy, signing, CSV, CreateOS client
  *.test.mjs                    Integration tests against the built worker
scripts/
  e2e.ts                        Real end-to-end run against a live server
  generate-load-test-csvs.mjs   Regenerates the 1k/10k/50k-row fixtures
```

Design choices worth noting:

- **Dependency injection at the seams.** The agent receives a `SandboxProvider` and a `RepairFn`, so the whole loop is unit-tested with in-memory fakes and no network.
- **One source of truth for the contract.** The allowed-module list feeds both the AI prompt and the static policy, so they cannot drift apart.
- **Stale-response safety in the UI.** Every dataset load gets an ID, and the reducer drops async results for a dataset the user has replaced.

## Running locally

Requires Node.js 22.18 or newer. The tests import TypeScript directly through Node's built-in type stripping.

```bash
npm install
npm run dev            # http://localhost:3000
```

### Configuration

Server-side environment variables. Never prefix them with `NEXT_PUBLIC_`.

| Variable | Purpose |
|---|---|
| `CREATEOS_PROJECT_API_KEY` | Injected by `stripe projects env --pull`. Used against the Sandbox API. |
| `OPENAI_API_KEY` | Planning and automatic repair |
| `OPENAI_MODEL` | Optional; defaults to `gpt-5.4-mini` |
| `DATAFIX_SIGNING_SECRET` | Recommended; dedicated HMAC secret for script tokens (falls back to `OPENAI_API_KEY`) |
| `CREATEOS_SANDBOX_API_KEY`, `CREATEOS_SANDBOX_BASE_URL` | Legacy alternatives to the Stripe-provisioned key |

Stripe also injects `CREATEOS_PROJECT_API_URL`. DataFix deliberately ignores it, because it points to the CreateOS platform API, not the Sandbox API (`https://api.sb.createos.sh`).

### Stripe Projects

```bash
stripe projects init datafix-ai
stripe projects add createos/free --accept-tos --yes
stripe projects add createos/project --accept-tos --yes
stripe projects env --pull      # writes .env (git-ignored)
```

`.projects/state.json` (the shareable manifest) is committed. Local state, the credential vault, and `.env*` files are git-ignored.

### Quality checks

```bash
npm run check          # lint + typecheck + build + all tests
npm run test:unit      # fast unit tests only
npm run e2e -- http://localhost:3000 sales_load_test_10000.csv   # real OpenAI + CreateOS run
```

## Limits and the path to scale

The current design is deliberately simple: one synchronous request per run and one sandbox per request. These are its limits, and the changes that would remove them:

| Current limit | Production design |
|---|---|
| 10 MB CSV, sent through a JSON request | Direct-to-object-storage upload (pre-signed URL); the sandbox pulls the file itself |
| Synchronous request for the whole agent loop (up to ~1 minute) | Job queue plus a durable workflow (e.g. Cloudflare Queues and Workflows); the client polls or subscribes for progress |
| CreateOS free plan: **10 sandboxes per day** | Paid plan plus a warm sandbox pool reused across jobs, reset between tenants |
| No authentication or per-user rate limits | Auth plus per-user quotas enforced in a Durable Object before any OpenAI or CreateOS spend |
| The model sees 12 sample rows | Column-level statistics (cardinality, top values, pattern classes) computed in the sandbox for wide or skewed data |
| Whole file processed in memory | Streaming, chunked processing in the generated script for multi-GB files |

## Demo rule

Never present local preview behavior as a sandbox run. The UI labels the executor and exposes the actual CreateOS logs. If the integration is unavailable, the product fails clearly rather than fabricating a successful execution trace.
