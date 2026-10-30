# SPM · Squeek Prediction Market

A responsive, free prediction game for Squeektoshi’s next 24-hour running distance. This repository includes the finished static website in **`dist/`**, React/TypeScript source, and a working **shared SQLite score service**. Wallets prove ownership with a signed message; there are no token approvals, transactions, entry costs or payouts.

**Launch state:** the static export reads real Squeekhub data immediately. Public voting and the leaderboard need the included service running at an operator-set URL. They are clearly marked as unavailable until connected. At the live check on **2026-10-30**, the source supplied **2 of the required 7 complete days**, so real predictions also correctly wait for enough history. No missing day, public player or score is fabricated.

## Install, preview and rebuild

Use **Node.js 24 or newer** and npm.

```sh
npm ci
npm run typecheck
npm run build
npm run preview
```

Open the URL printed by preview (normally `http://127.0.0.1:4173`). `npm run dev` starts the development server on `http://127.0.0.1:5173`. The build configuration is in `scripts/toolchain.mjs`; Vite’s base is **`./`**. The export uses local assets and fragment navigation, so it works at a gateway subpath without server rewrites. `dist/` is intentionally included in the submission.

The contributor build kept installed dependencies outside the repository using the optional `SPM_TOOLCHAIN` directory setting. Normal `npm ci` installs need no such setting. That directory must contain the same `package.json`, lockfile and installed packages. No dependency directories, registry mirrors or package archives are delivered.

## Run the complete application locally

After building:

```sh
npm run service
```

Open **`http://localhost:8787`**. This serves `dist/`, exposes `/api`, creates `data/spm.sqlite`, synchronizes the source, and runs settlement every minute. It supplies the site’s API configuration automatically. The database persists votes and points across restarts. Initial history catch-up can take a little time; voting waits until it finishes.

For a separate development frontend, allow its origin:

```sh
npm run service -- --allow-origin http://127.0.0.1:5173
```

Then use **Score service** in the site footer and enter `http://localhost:8787/api`. A successful check saves that connection in this browser. Browser storage contains connection preferences and wagmi’s connection state, **not** shared votes or scores.

## After launch

1. Run the supplied service continuously on a persistent host with Node 24, a persistent SQLite volume, and an HTTPS reverse proxy. Use `--host 0.0.0.0` if the proxy/container requires it. `--port`, `--db`, `--origin`, `--allow-origin` (repeatable) and `--rpc` are supported. Set `--origin` to the service’s actual public origin and allow the static website’s actual origin. No private wallet key or API credential is needed.
2. Set **`public/spm-config.json` → `apiBase`** to that service’s HTTPS API URL ending in `/api`, then rebuild. This field is deliberately empty in the delivered export because no hosted service URL was supplied. The footer setting can test a connection before rebuilding; a browser override takes precedence over the published default. Clear the `spm-api-base` local-storage preference to restore the published default.
3. Keep the service process running and back up the SQLite database. Stop the process before copying the database, or use a SQLite-aware backup that includes its WAL. The service resumes from its stored archive cursor after a restart.
4. Wait for seven fully recorded historical days and fresh hardware readings. Missing source data keeps voting closed; an incomplete result archive keeps existing predictions pending. The UI explains both states.

Hosting/publication is outside this delivery. The entire scoring implementation and API contract are included, so an existing third-party backend or private account is not required. The delivered static files alone do not run a scheduler or a shared database.

## Rules and data decisions

- **Target:** the previous seven *complete* source days, each running **12:00 UTC to 12:00 UTC**, matching Squeekhub’s own daily boundaries. Today is excluded. Each day requires all 144 ten-minute rounds, full coverage and a non-null distance. `stats?range=30d` is used because the seven-day endpoint includes the unfinished current day. The chart shows missing and partial days distinctly. Until all seven exist, its observed average is explicitly provisional.
- **Window:** each accepted prediction runs for exactly 86,400,000 milliseconds, starting at server acceptance. One pending prediction per wallet; its choice and target are locked. Signature challenges expire after five minutes and can be consumed once.
- **Result:** the service counts eligible hardware passages in **`[startAt, expiresAt)`**, using the timestamped run archive. The API’s consistent, complete daily distance/work pairs supply the wheel calibration; no circumference is guessed. Scoring compares `7 × resultDistanceMm` with the frozen seven-day distance total using `BigInt`, preserving the unrounded target. Displayed kilometres are rounded to two decimals.
- **Points:** a correct Over or Under earns 1 point. A loss or an exact tie earns 0. Settlement is idempotent. The public leaderboard derives points from settled predictions in the shared database, with deterministic ordering by points, completed predictions and address. It includes participating wallets even before their first win.
- **Delays:** settlement starts after the 24-hour window and waits for the source archive to cover its end. Gaps, ineligible evidence or installation changes never produce an invented result. An installation change can leave older predictions pending for operator investigation. The process polls every minute, paces archive reads, honors rate-limit retry headers, and continues catch-up from a durable cursor.
- **Identity:** EIP-6963 browser wallet discovery, mobile “Open in” links for MetaMask/Coinbase/Rabby/Phantom, and Coinbase Smart Wallet share one sheet. Ethereum is the wallet identity/contract-signature network; SPM sends no transactions. EOA signatures are checked cryptographically; the service also supports viem’s public-client contract/counterfactual signature verification. That path needs a working Ethereum RPC (`--rpc`); the production default is `https://ethereum-rpc.publicnode.com`.
- **Privacy/trust:** wallet addresses, picks, timing and scores are public. Private keys never reach the service. Points are an operator-run game record, not onchain assets. Distances are wheel-based estimates from the supplied API, not independently verified animal travel.

The choices left open by the brief were the backend architecture, exact voting window, daily cutoff, ties and missing-data policy. The implementation above chooses persistent shared storage, a per-vote 24-hour window, source-native noon boundaries, zero points for ties, and waiting for complete evidence. These decisions make scoring reproducible without inventing a service URL or any financial value.

## Checks actually run

- `npm run typecheck`: passed, strict TypeScript, no emit.
- `npm run build`: passed; complete production export generated. Third-party wagmi/Query `use client` and pure-annotation bundler warnings are non-fatal; there were no build errors.
- `npm test`: **7 passing service/integration tests**, covering exact boundaries, Over/Under/ties, signature forgery/replay/expiry, duplicate votes, delayed/ineligible data, persistence, HTTP/CORS validation and a scheduler exercised at a short interval. These tests run without external services.
- `npm run test:browser`: **28 passing checks** in Chromium and WebKit against the actual export at `/preview/`, with widths 320/390/768/1440. Covers wallet discovery/rejection/reconnect, network switching, signed vote persistence, independent public readers, clock-advanced settlement, errors/retry, radio keyboard control, modal focus/dismissal, public address disclosure, pagination bounds, phone wallet rows, local assets and axe accessibility scans. Wallets and measurement feeds are controlled test fixtures; real cryptographic signatures are used. No transaction method was called.
- Pinned `taste.mjs --out test/scratch/taste`: **16/16 checks passed** on the final export. The actual mobile source view puts the main action at approximately **y=617–665** in a 390×844 viewport. Final browser screenshots and review details are in `artifacts/`.
- A live service sync against Squeekhub completed in approximately **19.4 seconds**, with fresh status, two fully covered days and no source error after archive pacing was fixed.

Re-run browser tests after `npx playwright install chromium webkit` (and install Playwright’s system libraries if your machine needs them). Browser fixtures are only in `test/` and are never bundled into the website. The pinned probe is an assignment input and is not part of the shipped application.

**Limits:** physical wallet apps, live Coinbase/passkey signing and deployed ERC-1271/counterfactual wallets were not exercised. Real elapsed 24-hour settlement was tested with an advanced clock and short scheduler interval, not by waiting a day. No manual screen-reader session, physical-device run or native browser-zoom certification was performed. Automated accessibility checks are not a full conformance claim. No public service was deployed. See [validation](artifacts/validation.md) for evidence and the six-domain review.

## Source map

| Path | Purpose |
| --- | --- |
| `src/App.tsx`, `src/components/` | Market, chart, leaderboard, score/history and accessible dialogs |
| `src/lib/data.mjs` | Shared source parsing, noon boundaries, baseline and exact scoring |
| `src/lib/api.ts`, `src/lib/wallet.ts` | Runtime service connection and wallet configuration |
| `src/styles.css`, `src/assets/` | Design tokens and locally bundled DM Sans |
| `server/` | Persistent API, signed votes, archive synchronization and automatic settlement |
| `public/`, `dist/` | Source public assets/configuration and complete static export |
| `test/` | Reproducible offline service and browser interaction checks |
| `DESIGN.md` | Implemented design system |
| `artifacts/API.md` | Shared service contract and operation details |
| `artifacts/validation.md` | Actual checks, fixes, screenshots and limitations |

Sources: [Squeekhub status](https://api.squeekchain.com/v1/status), [Squeekchain API contract](https://docs.squeekchain.com/developers/api/), [wheel measurement semantics](https://docs.squeekchain.com/system/measurement/). Attribution and retained licenses are listed in [NOTICE](artifacts/NOTICE.md).
