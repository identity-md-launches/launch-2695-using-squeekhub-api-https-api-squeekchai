import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { dependencyRequire } from "../server/deps.mjs";
import { createService } from "../server/service.mjs";
import { createHttpServer } from "../server/http.mjs";
import { createFeed } from "./fixtures.mjs";
const { chromium, webkit } = dependencyRequire("playwright");
const { default: AxeBuilder } = dependencyRequire("@axe-core/playwright");
const { generatePrivateKey, privateKeyToAccount } =
  dependencyRequire("viem/accounts");
const { hexToString, verifyMessage } = dependencyRequire("viem");
const output = resolve("test/scratch/browser-validation");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), "spm-browser-"));
const results = [];
let browser, currentPage;
const feed = createFeed({ now: Date.now(), dailyWork: 10_000 });
const service = createService({
  dbPath: join(directory, "score.sqlite"),
  origin: "https://spm-browser-test.example",
  clock: () => feed.state.now,
  fetcher: feed.fetcher,
  archiveIntervalMs: 0,
  signatureVerifier: (address, message, signature) =>
    verifyMessage({ address, message, signature }),
});
await service.sync();
const allowedOrigins = [];
const handler = createHttpServer(service, {
  allowedOrigins,
  requestsPerMinute: 240,
});
const server = createServer((req, res) => {
  if (req.url === "/preview/spm-config.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end('{"apiBase":""}');
  }
  if (req.url.startsWith("/preview/"))
    req.url = req.url.slice("/preview".length);
  handler.emit("request", req, res);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
allowedOrigins.push(origin);
async function check(name, fn) {
  await fn();
  results.push({ name, passed: true });
  console.log(`PASS ${name}`);
}
async function eventually(fn, message) {
  const end = Date.now() + 6000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(message);
}
try {
  // SPM_BROWSERS=chromium limits the run where a machine lacks one engine's system libraries.
  const engines = (process.env.SPM_BROWSERS || "chromium,webkit").split(",");
  for (const [engine, type] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ].filter(([engine]) => engines.includes(engine))) {
    feed.state.now = Date.now();
    feed.state.archiveThrough = feed.state.now;
    feed.state.installation = `spm-browser-${engine}`;
    feed.state.passages = [];
    // The live state at this release: three complete days, the four oldest still unrecorded.
    feed.state.missingDays = 4;
    await service.sync();
    browser = await type.launch({
      headless: true,
      args: engine === "chromium" ? ["--no-sandbox"] : [],
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const wallet = privateKeyToAccount(generatePrivateKey());
    const methods = [];
    await context.exposeBinding("spmTestSign", async (_, raw) =>
      wallet.signMessage({ message: hexToString(raw) }),
    );
    await context.addInitScript(
      ({ address }) => {
        let chain = sessionStorage.getItem("spm-test-chain") || "0xaa36a7",
          connected = sessionStorage.getItem("spm-test-connected") === "yes";
        const listeners = new Map();
        const emit = (event, data) =>
          (listeners.get(event) || []).forEach((fn) => fn(data));
        const provider = {
          on(event, fn) {
            listeners.set(event, [...(listeners.get(event) || []), fn]);
          },
          removeListener(event, fn) {
            listeners.set(
              event,
              (listeners.get(event) || []).filter(
                (listener) => listener !== fn,
              ),
            );
          },
          async request({ method, params }) {
            window.spmTestMethods.push(method);
            if (method === "eth_chainId") return chain;
            if (method === "eth_accounts") return connected ? [address] : [];
            if (method === "eth_requestAccounts") {
              if (window.spmRejectConnect) {
                const error = new Error("User rejected connection");
                error.code = 4001;
                throw error;
              }
              connected = true;
              sessionStorage.setItem("spm-test-connected", "yes");
              return [address];
            }
            if (method === "wallet_switchEthereumChain") {
              chain = params[0].chainId;
              sessionStorage.setItem("spm-test-chain", chain);
              emit("chainChanged", chain);
              return null;
            }
            if (method === "wallet_requestPermissions")
              return [{ parentCapability: "eth_accounts" }];
            if (method === "wallet_getPermissions")
              return connected ? [{ parentCapability: "eth_accounts" }] : [];
            if (method === "personal_sign") {
              if (window.spmRejectSign) {
                const error = new Error("User rejected signature");
                error.code = 4001;
                throw error;
              }
              return window.spmTestSign(params[0]);
            }
            throw new Error(`Unsupported test-wallet method: ${method}`);
          },
        };
        window.spmTestMethods = [];
        const detail = {
          info: {
            uuid: "fa849db8-875a-4cf0-924d-171d8fcaf058",
            name: "SPM test wallet",
            icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"><rect width="28" height="28" rx="5" fill="%23254d38"/><circle cx="14" cy="14" r="6" fill="white"/></svg>',
            rdns: "example.spm.test",
          },
          provider,
        };
        window.addEventListener("eip6963:requestProvider", () =>
          window.dispatchEvent(
            new CustomEvent("eip6963:announceProvider", { detail }),
          ),
        );
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail }),
        );
      },
      { address: wallet.address },
    );
    await context.route("https://api.squeekchain.com/**", async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        json: url.pathname === "/v1/status" ? feed.status() : feed.stats(),
      });
    });
    const page = await context.newPage();
    currentPage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/preview/`);
    await page.getByText("Average of the last three complete days").waitFor();
    await check(`${engine}: three-day starter average opens voting`, async () => {
      await page.getByText("the target uses the three complete days so far").waitFor();
      await page.getByText("Three-day average").waitFor();
      assert.equal(service.market().ready, true);
      assert.equal(service.market().baseline.completeDays, 3);
    });
    await check(
      `${engine}: static export at gateway subpath and metadata`,
      async () => {
        assert.match(await page.title(), /Squeek Prediction Market/);
        assert.equal(
          await page
            .locator('meta[property="og:image"]')
            .getAttribute("content"),
          "./share.png",
        );
        assert.equal(
          (await page.request.get(`${origin}/preview/share.png`)).status(),
          200,
        );
        const images = await page
          .locator("img")
          .evaluateAll((images) =>
            images
              .filter((image) => !image.complete || !image.naturalWidth)
              .map((image) => image.src),
          );
        assert.deepEqual(images, []);
        assert.equal(
          await page.evaluate(() => document.fonts.check('400 16px "DM Sans"')),
          true,
        );
      },
    );
    await check(`${engine}: responsive first screen and overflow`, async () => {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
          false,
          `overflow at ${width}`,
        );
        if (width === 390) {
          const box = await page
            .getByRole("button", { name: "Connect to predict" })
            .boundingBox();
          assert(
            box.y + box.height < 844,
            "primary action must be on first screen",
          );
        }
        await page.screenshot({
          path: join(output, `${engine}-${width}.png`),
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
    });
    await check(
      `${engine}: choice keyboard operation and modal focus restore`,
      async () => {
        await page.getByRole("radio", { name: "Under", exact: true }).check();
        assert.equal(await page.locator("#pick-under").isChecked(), true);
        await page.locator("#pick-under").focus();
        await page.keyboard.press("ArrowUp");
        assert.equal(await page.locator("#pick-over").isChecked(), true);
        await page.getByRole("button", { name: "Connect to predict" }).click();
        await page.getByRole("dialog", { name: "Connect a wallet" }).waitFor();
        assert.equal(
          await page.getByRole("button", { name: "SPM test wallet" }).count(),
          1,
        );
        assert.equal(
          await page
            .getByRole("button", { name: "Browser wallet", exact: true })
            .count(),
          0,
        );
        const focusInside = await page.evaluate(() =>
          document.querySelector("dialog").contains(document.activeElement),
        );
        assert.equal(focusInside, true);
        for (let index = 0; index < 6; index++)
          await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() =>
            document.querySelector("dialog").contains(document.activeElement),
          ),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(await page.getByRole("dialog").count(), 0);
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.textContent?.includes("Connect to predict"),
          ),
          true,
        );
      },
    );
    await check(
      `${engine}: EIP-6963 wallet rejection, connection and network switch`,
      async () => {
        await page.evaluate(() => {
          window.spmRejectConnect = true;
        });
        await page.getByRole("button", { name: "Connect to predict" }).click();
        await page.getByRole("button", { name: "SPM test wallet" }).click();
        await page
          .getByText("Connection declined. Choose a wallet to try again.")
          .waitFor();
        await page.evaluate(() => {
          window.spmRejectConnect = false;
        });
        await page.getByRole("button", { name: "SPM test wallet" }).click();
        await page
          .getByRole("button", { name: "Switch to Ethereum", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Switch to Ethereum", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Predictions opening soon",
            exact: true,
          })
          .waitFor();
        assert(
          (await page.locator(".wallet-summary").textContent()).includes(
            "Unavailable",
          ),
          "an unconfigured service must not invent a zero score",
        );
        assert(
          (await page.evaluate(() => window.spmTestMethods)).includes(
            "wallet_switchEthereumChain",
          ),
        );
      },
    );
    await check(
      `${engine}: service validation error then shared service connection`,
      async () => {
        await page
          .getByRole("button", { name: "Score service", exact: true })
          .click();
        await page
          .getByLabel("Score service API URL")
          .fill(origin + "/missing");
        await page.getByRole("button", { name: "Save connection" }).click();
        await page
          .locator("#service-error")
          .filter({ hasText: /does not exist/ })
          .waitFor();
        await page.getByLabel("Score service API URL").fill(origin + "/api");
        await page.getByRole("button", { name: "Save connection" }).click();
        await page
          .getByRole("button", { name: "Predict Over", exact: true })
          .waitFor();
      },
    );
    await check(
      `${engine}: signature rejection, retry and actual signed vote persistence`,
      async () => {
        await page.evaluate(() => {
          window.spmRejectSign = true;
        });
        await page
          .getByRole("button", { name: "Predict Over", exact: true })
          .click();
        await page
          .getByText(
            "Signature declined. Your prediction was not saved. Try again when you’re ready.",
          )
          .waitFor();
        assert.equal(service.wallet(wallet.address).predictions.length, 0);
        await page.evaluate(() => {
          window.spmRejectSign = false;
        });
        await page
          .getByRole("button", { name: "Predict Over", exact: true })
          .click();
        await page.getByText("You picked Over", { exact: true }).waitFor();
        assert.equal(service.wallet(wallet.address).predictions.length, 1);
        assert.equal(
          service.wallet(wallet.address).predictions[0].state,
          "pending",
        );
        methods.push(...(await page.evaluate(() => window.spmTestMethods)));
        assert.equal(
          methods.some((method) =>
            /sendTransaction|signTransaction|sendCalls/.test(method),
          ),
          false,
        );
        await page.screenshot({
          path: join(output, `${engine}-prediction-saved.png`),
          fullPage: true,
        });
      },
    );
    await check(
      `${engine}: wallet reconnect and saved prediction survive reload`,
      async () => {
        await page.reload();
        await page.getByText("You picked Over", { exact: true }).waitFor();
        assert.equal(service.wallet(wallet.address).predictions.length, 1);
        assert.equal(
          await page.locator(".connect-button").textContent(),
          `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`,
        );
      },
    );
    await check(
      `${engine}: independent visitor sees public leaderboard`,
      async () => {
        const visitor = await browser.newContext();
        const other = await visitor.newPage();
        await other.goto(`${origin}/preview/`);
        await other
          .getByRole("button", { name: "Score service", exact: true })
          .click();
        await other.getByLabel("Score service API URL").fill(origin + "/api");
        await other.getByRole("button", { name: "Save connection" }).click();
        await other.locator(".leaderboard-rows li").first().waitFor();
        assert(
          (await other.locator(".leaderboard-rows").textContent()).includes(
            wallet.address.slice(0, 6),
          ),
        );
        await visitor.close();
      },
    );
    await check(
      `${engine}: 24-hour settlement updates UI with one point`,
      async () => {
        const prediction = service.wallet(wallet.address).predictions[0];
        feed.state.passages = Array.from(
          { length: 10_001 },
          (_, index) => prediction.startAt + index * 1000,
        );
        feed.state.now = prediction.expiresAt;
        feed.state.archiveThrough = prediction.expiresAt;
        // A new test feed archive can contain earlier passages; primary-key deduplication preserves history.
        await service.sync();
        assert.equal(service.wallet(wallet.address).player.points, 1);
        await page
          .getByRole("button", { name: "Refresh wheel history" })
          .click();
        await eventually(
          async () =>
            (await page.locator(".wallet-summary").textContent()).includes(
              "1 point",
            ),
          "wallet score should update",
        );
        await page.getByText("+1 point", { exact: true }).waitFor();
        await page.getByRole("radio", { name: "Over", exact: true }).check();
        await page.screenshot({
          path: join(output, `${engine}-settled.png`),
          fullPage: true,
        });
      },
    );
    await check(
      `${engine}: stale data and failed request recover without saving a vote`,
      async () => {
        feed.state.stale = true;
        await service.sync();
        await page
          .getByRole("button", { name: "Refresh wheel history" })
          .click();
        await page
          .getByRole("button", {
            name: "Waiting for fresh wheel data",
            exact: true,
          })
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", {
              name: "Waiting for fresh wheel data",
              exact: true,
            })
            .isDisabled(),
          true,
        );
        await page
          .getByText(
            "The wheel feed is stale. Predictions reopen when fresh readings return.",
          )
          .waitFor();
        feed.state.stale = false;
        await service.sync();
        await page.route("**/api/market", (route) => route.abort());
        await page
          .getByRole("button", { name: "Refresh wheel history" })
          .click();
        await page
          .getByText(
            "Couldn’t reach the service. Check your connection and try again.",
          )
          .waitFor();
        assert.equal(service.wallet(wallet.address).predictions.length, 1);
        await page.unroute("**/api/market");
        await page
          .getByRole("button", { name: "Refresh wheel history" })
          .click();
        await eventually(
          async () =>
            !(await page
              .getByRole("button", { name: "Predict Over", exact: true })
              .isDisabled()),
          "refresh should recover after the service returns",
        );
      },
    );
    await check(
      `${engine}: automated accessibility and resources`,
      async () => {
        const axe = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        await writeFile(
          join(output, `${engine}-axe.json`),
          JSON.stringify(axe.violations, null, 2),
        );
        assert.deepEqual(
          axe.violations.map((item) => ({
            id: item.id,
            nodes: item.nodes.map((node) => node.target),
          })),
          [],
        );
        assert.deepEqual(errors, []);
      },
    );
    await check(
      `${engine}: public leaderboard details and pagination bounds`,
      async () => {
        await page
          .getByRole("button", { name: /View all \d+ players/ })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "The public leaderboard",
        });
        await dialog.locator(".leaderboard-rows li").first().waitFor();
        await dialog.locator(".player-wallet summary").first().click();
        assert.match(
          await dialog.locator(".full-address").first().textContent(),
          /^0x[a-fA-F0-9]{40}$/,
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: "Previous", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          await dialog
            .getByRole("button", { name: "Next", exact: true })
            .isDisabled(),
          true,
        );
        await page.keyboard.press("Escape");
      },
    );
    await check(`${engine}: modal rules and disconnect`, async () => {
      await page.getByRole("button", { name: "Rules & scoring" }).click();
      await page
        .getByRole("dialog")
        .getByText("Recent days set the target.")
        .waitFor();
      await page.getByRole("button", { name: "Got it" }).click();
      await page.locator(".connect-button").click();
      await page.getByRole("button", { name: "Disconnect wallet" }).click();
      await page.getByRole("button", { name: "Connect to predict" }).waitFor();
    });
    await check(
      `${engine}: phone wallet links, marks and bottom-sheet dismissal`,
      async () => {
        const phone = await browser.newContext({
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
          userAgent:
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        });
        await phone.route("https://api.squeekchain.com/**", (route) =>
          route.fulfill({
            json: route.request().url().includes("/status")
              ? feed.status()
              : feed.stats(),
          }),
        );
        const mobilePage = await phone.newPage();
        await mobilePage.goto(`${origin}/preview/`);
        await mobilePage.locator(".connect-button").click();
        for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
          await mobilePage
            .getByRole("link", { name: `Open in ${name}` })
            .waitFor();
        await mobilePage
          .getByRole("button", { name: "Coinbase Smart Wallet" })
          .waitFor();
        assert.equal(
          await mobilePage
            .getByRole("button", { name: "Browser wallet", exact: true })
            .count(),
          0,
        );
        await eventually(
          async () =>
            await mobilePage
              .locator(".wallet-row img")
              .evaluateAll((images) =>
                images.every(
                  (image) => image.complete && image.naturalWidth > 0,
                ),
              ),
          "wallet marks should load locally",
        );
        await mobilePage.screenshot({
          path: join(output, `${engine}-phone-wallets.png`),
        });
        await mobilePage.mouse.click(20, 20);
        assert.equal(await mobilePage.getByRole("dialog").count(), 0);
        await phone.close();
      },
    );
    await context.close();
    await browser.close();
    browser = null;
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({
      path: join(output, "failure.png"),
      fullPage: true,
    });
    await writeFile(
      join(output, "failure.txt"),
      await currentPage.locator("body").innerText(),
    );
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
  handler.close();
  await service.close();
  await rm(directory, { recursive: true, force: true });
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`${results.length} browser checks passed.`);
}
