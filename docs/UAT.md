# env-vault + pi Kimi UAT — v0.3

**Prereqs**: macOS, pi v0.68+ installed, this repo cloned and built (`npm install && npm run build`).
Your real `~/.pi/agent/auth.json` is **never touched** — Phase 3+ uses `PI_CODING_AGENT_DIR` to isolate a scratch pi config dir.

## Phase 1 — Baseline pi+Kimi (no envault)
1. `pi --model kimi-coding/kimi-for-coding "say hello in one word"` — uses your existing live key in `~/.pi/agent/auth.json`. Proves pi+Kimi works on this machine. Expect a one-word Kimi response.

## Phase 2 — Envault secret setup via web UI
2. `./dist/cli.js init` (skip if `~/.ssh/envault_key` already exists).
3. `./dist/cli.js ui` — prints `envault ui listening at http://127.0.0.1:<port>/#t=<token>` to stderr and opens the browser.
4. In the browser, click **+ Add**. Name: `KIMI_API_KEY`. Paste your real Kimi key. Save.
5. Click the new entry in the sidebar; copy the displayed pseudokey (format: `envault-xxxxxxxx`). **Do not** click Reveal in this phase.
6. Press **Ctrl-C** in the terminal running `envault ui` to stop the server (or let it exit after 15 min idle).

## Phase 3 — Envault → pi env-var path (isolated pi config)
7. `mkdir -p /tmp/pi-uat`
8. `PI_CODING_AGENT_DIR=/tmp/pi-uat ./dist/cli.js run -- pi --model kimi-coding/kimi-for-coding "list files in /etc"`
   - envault resolves `KIMI_API_KEY` from its vault into the child env.
   - pi in scratch config has no `auth.json` → falls back to the env var → succeeds.
9. Inspect `/tmp/pi-uat/agent/sessions/<encoded-cwd>/<latest>.jsonl` — confirm Kimi responded (look for a real assistant message).

## Phase 4 — Pseudokey in .env pseudokey path
10. `mkdir -p /tmp/uat-project && cd /tmp/uat-project`
11. Create `.env` containing `KIMI_API_KEY=envault-<pseudokey-from-step-5>` (one line).
12. `PI_CODING_AGENT_DIR=/tmp/pi-uat ~/Development/env-vault/dist/cli.js run -- pi --model kimi-coding/kimi-for-coding "hi"`
13. Same result as Phase 3. Verifies the `.env` → pseudokey → resolve → pi flow.

## Phase 5 — Fetch interceptor in-process substitution
14. Copy the fixture into the project: `cp ~/Development/env-vault/docs/uat-fixtures/test-fetch.mjs /tmp/uat-project/test-fetch.mjs`. The fixture calls `POST https://api.kimi.com/coding/v1/messages` with a minimal Anthropic-messages body, passing the pseudokey in the `Authorization` header.
15. From `/tmp/uat-project`: `~/Development/env-vault/dist/cli.js run -- node test-fetch.mjs` → request succeeds (interceptor substituted the `Authorization` header before send). Script prints `HTTP 200` and the first 200 chars of the response body.
16. `~/Development/env-vault/dist/cli.js run --no-intercept -- node test-fetch.mjs` → request fails with `HTTP 401` (literal pseudokey sent on the wire). Confirms the interceptor is load-bearing for this flow.

## Phase 6 — CLI papercuts
17. `echo "$REAL_KIMI_KEY" | ~/Development/env-vault/dist/cli.js set KIMI_FROM_STDIN --stdin`. `history | grep envault` shows the command but NOT the value.
18. `~/Development/env-vault/dist/cli.js identity show` — prints fingerprint + cache status.
19. `~/Development/env-vault/dist/cli.js list` — no decrypted values in output.

## Phase 7 — Web UI reveal flow (optional)
20. Start `envault ui` again.
21. Click the `KIMI_FROM_STDIN` entry; click **Reveal value**. The real key appears, then auto-hides after 15 seconds. Clicking Reveal again costs a new nonce (visible in Network tab: fresh `POST /api/reveal/nonce` before each reveal).

## Cleanup
22. `rm -rf /tmp/pi-uat /tmp/uat-project`
23. Optional: `envault rm KIMI_API_KEY KIMI_FROM_STDIN` to clear test keys from the vault.

## Pass criteria
- Phases 1, 3, 4, 5 all produce Kimi responses with tool use (read/bash/etc.).
- Phase 2 lets you add a secret entirely via the browser — no value in shell history, no value in Network tab responses.
- Phase 5 proves the interceptor is real (request fails without it, succeeds with it).
- Phase 6 confirms the stdin + identity papercuts.
- Phase 7 confirms the reveal UX: value visible, auto-hides, fresh nonce per click.

## Reporting bugs
Open an issue at https://github.com/Darren-A11att/env-vault/issues with the phase number, exact command, and observed output.
