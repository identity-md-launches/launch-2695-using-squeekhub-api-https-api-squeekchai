# SPM · Squeek Prediction Market

A responsive, free prediction game for Squeektoshi’s next 24-hour running distance. This repository includes the finished static website in **`dist/`**, React/TypeScript source, and a working **shared SQLite score service**. Wallets prove ownership with a signed message; there are no token approvals, transactions, entry costs or payouts.

**Launch state:** the static export reads real Squeekhub data immediately. Public voting and the leaderboard need the included service running at an operator-set URL. They are clearly marked as unavailable until connected. Squeekhub doesn’t have a full week of running data yet, so the target uses the **average of the complete days recorded so far, from three days up**, and grows to the seven-day average by itself. At the live check on **2026-10-30 (16:27 UTC)** the source had **3 complete days** (Oct 27–29), giving a **10.18 km/day** target, and the bundled service opened voting against live data. No missing day, public player or score is fabricated.

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

For this site, run the service with the published site’s origin allowed:

```sh
npm run service -- --host 0.0.0.0 --origin https://<your-service-host> --allow-origin https://spm-squeek-prediction-market.imd.site
```

1. Run the supplied service continuously on a persistent host with Node 24, a persistent SQLite volume, and an HTTPS reverse proxy. Use `--host 0.0.0.0` if the proxy/container requires it. `--port`, `--db`, `--origin`, `--allow-origin` (repeatable) and `--rpc` are supported. Set `--origin` to the service’s actual public origin and allow the static website’s actual origin. No private wallet key or API credential is needed.
2. Open the site, choose **Score service** in the footer and paste the service’s HTTPS URL ending in `/api`. **Save connection** only succeeds when `/api/market` answers as an SPM service and CORS allows the site’s origin. Then set **`public/spm-config.json` → `apiBase`** to the same URL, run `npm run build`, and commit `dist/` for republishing. This field is still empty in this delivery: no deployed service URL was supplied, and a guessed one would break the site for every visitor. The footer setting can test a connection before rebuilding; a browser override takes precedence over the published default. Clear the `spm-api-base` local-storage preference to restore the published default.
3. Keep the service process running and back up the SQLite database. Stop the process before copying the database, or use a SQLite-aware backup that includes its WAL. The service resumes from its stored archive cursor after a restart.
4. Voting needs at least three fully recorded days and fresh hardware readings. Missing source data keeps voting closed; an incomplete result archive keeps existing predictions pending. The UI explains both states. The service stores each prediction’s day count, so databases from the seven-day release migrate automatically on start and their existing predictions keep their seven-day targets.

Hosting/publication is outside this delivery. The entire scoring implementation and API contract are included, so an existing third-party backend or private account is not required. The delivered static files alone do not run a scheduler or a shared database.

## Rules and data decisions

- **Target:** the average of every *complete* source day among the previous seven, each running **12:00 UTC to 12:00 UTC**, matching Squeekhub’s own daily boundaries. Today is excluded. Each day requires all 144 ten-minute rounds, full coverage and a non-null distance. Voting opens once **3** such days exist (`MIN_DAYS` in `src/lib/data.mjs`). With fewer than seven, the UI says how many days the target uses; it becomes the seven-day average once a full week is recorded. Partial and missing days are never counted, as zero or otherwise. `stats?range=30d` is used because the seven-day endpoint includes the unfinished current day. The chart shows missing and partial days distinctly.
- **Window:** each accepted prediction runs for exactly 86,400,000 milliseconds, starting at server acceptance. One pending prediction per wallet; its choice, target total and day count are locked and stated in the signed message. If a day completes while a wallet is signing, the vote is refused and the user is asked to review the new target. Signature challenges expire after five minutes and can be consumed once.
- **Result:** the service counts eligible hardware passages in **`[startAt, expiresAt)`**, using the timestamped run archive. The API’s consistent, complete daily distance/work pairs supply the wheel calibration; no circumference is guessed. Scoring compares `days × resultDistanceMm` with the frozen baseline total using `BigInt`, where `days` is the prediction’s own locked day count, preserving the unrounded target. Displayed kilometres are rounded to two decimals.
- **Points:** a correct Over or Under earns 1 point. A loss or an exact tie earns 0. Settlement is idempotent. The public leaderboard derives points from settled predictions in the shared database, with deterministic ordering by points, completed predictions and address. It includes participating wallets even before their first win.
- **Delays:** settlement starts after the 24-hour window and waits for the source archive to cover its end. Gaps, ineligible evidence or installation changes never produce an invented result. An installation change can leave older predictions pending for operator investigation. The process polls every minute, paces archive reads, honors rate-limit retry headers, and continues catch-up from a durable cursor.
- **Identity:** EIP-6963 browser wallet discovery, mobile “Open in” links for MetaMask/Coinbase/Rabby/Phantom, and Coinbase Smart Wallet share one sheet. Ethereum is the wallet identity/contract-signature network; SPM sends no transactions. EOA signatures are checked cryptographically; the service also supports viem’s public-client contract/counterfactual signature verification. That path needs a working Ethereum RPC (`--rpc`); the production default is `https://ethereum-rpc.publicnode.com`.
- **Privacy/trust:** wallet addresses, picks, timing and scores are public. Private keys never reach the service. Points are an operator-run game record, not onchain assets. Distances are wheel-based estimates from the supplied API, not independently verified animal travel.

The choices left open by the brief were the backend architecture, exact voting window, daily cutoff, ties and missing-data policy. The implementation above chooses persistent shared storage, a per-vote 24-hour window, source-native noon boundaries, zero points for ties, a three-day minimum that grows into the seven-day average, and waiting for complete evidence. These decisions make scoring reproducible without inventing a service URL or any financial value.

## Checks actually run

Results from the 2026-10-30 three-day-average release, on the final source. The full six-domain design review is delivered as `artifacts/validation.md` alongside the repository.

- `npm run typecheck`: passed (exit 0), strict TypeScript, no emit.
- `npm run build`: passed; complete production export in `dist/`. Third-party wagmi/Query `use client` and comment-annotation bundler warnings are non-fatal.
- `npm test`: **9 passing, 0 failing** service/integration tests. New: three complete days open voting and lock a 3-day target; two days stay closed; a fourth day completing mid-signature is refused; a 3-day prediction settles against its own 3-day total after the window grows; exact non-integer 3-day averages; migration of a seven-day-release database.
- `SPM_BROWSERS=chromium npm run test:browser`: **15 passing, 0 failing** checks in Chromium against the export at `/preview/` with the live situation of three complete days: starter-average copy, signed vote, settlement, keyboard/modal, wallet, leaderboard, axe and 320/390/768/1440 overflow. **WebKit did not run on this machine**: Playwright’s WebKit build lacks system libraries here (GStreamer, libavif, libmanette and others), and they could not be installed. Run `npm run test:browser` without `SPM_BROWSERS` to cover both engines.
- Pinned `taste.mjs --out test/scratch/taste`: **16/16 checks passed** on the final export, with live Squeekhub data. The 390×844 screenshot shows the 10.18 km/day three-day target, both choices and the main action on the first screen.
- Live service sync against Squeekhub (scratch database): completed in about **22 seconds**, `ready: true`, 3 complete days, average 10,177,483 mm, and a valid challenge message for a 3-day target. No vote was signed against live data.

Re-run browser tests after `npx playwright install chromium webkit` (and install Playwright’s system libraries if your machine needs them). Browser fixtures are only in `test/` and are never bundled into the website. The pinned probe is an assignment input and is not part of the shipped application.

**Limits:** no public service was deployed by this delivery, so `spm-config.json` has no `apiBase` and the published site shows voting as waiting for the score service until the operator completes the steps in *After launch*. Physical wallet apps, live Coinbase/passkey signing and deployed ERC-1271/counterfactual wallets were not exercised. 24-hour settlement was tested with an advanced clock, not by waiting a day. No manual screen-reader session, physical-device run or native browser-zoom certification was performed. Automated accessibility checks are not a full conformance claim.

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
| `artifacts/validation.md` | Actual checks, design review, fixes and limitations |

Sources: [Squeekhub status](https://api.squeekchain.com/v1/status), [Squeekchain API contract](https://docs.squeekchain.com/developers/api/), [wheel measurement semantics](https://docs.squeekchain.com/system/measurement/). DM Sans is bundled under the SIL Open Font License ([`src/assets/OFL.txt`](src/assets/OFL.txt)).
