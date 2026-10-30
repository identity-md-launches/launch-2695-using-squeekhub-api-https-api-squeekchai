import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { dependencyRequire } from "../server/deps.mjs";
import { createService } from "../server/service.mjs";
import { createHttpServer } from "../server/http.mjs";
import { createFeed } from "./fixtures.mjs";
import {
  DAY,
  summarize,
  expectedDates,
  deviceDay,
  outcome,
  parseStats,
} from "../src/lib/data.mjs";
const { verifyMessage } = dependencyRequire("viem");
const { generatePrivateKey, privateKeyToAccount } =
  dependencyRequire("viem/accounts");
const account = () => privateKeyToAccount(generatePrivateKey());
async function setup(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "spm-test-"));
  const feed = createFeed(options);
  const dbPath = join(directory, "scores.sqlite");
  const make = () =>
    createService({
      dbPath,
      origin: "https://spm.example",
      clock: () => feed.state.now,
      fetcher: feed.fetcher,
      archiveIntervalMs: 0,
      signatureVerifier: (address, message, signature) =>
        verifyMessage({ address, message, signature }),
    });
  const service = make();
  await service.sync();
  return {
    service,
    feed,
    directory,
    make,
    close: async () => {
      await service.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
const signVote = async (service, wallet, side = "over") => {
  const challenge = service.challenge(wallet.address, side);
  const signature = await wallet.signMessage({ message: challenge.message });
  return {
    prediction: await service.vote(challenge.id, signature),
    challenge,
    signature,
  };
};

test("noon UTC calendar, seven-day window with a three-day start; current day excluded; missing is never zero", () => {
  const feed = createFeed();
  assert.equal(deviceDay("2026-10-30T11:59:59Z"), "2026-10-29");
  assert.equal(deviceDay("2026-10-30T12:00:00Z"), "2026-10-30");
  assert.deepEqual(expectedDates(feed.state.now), [
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
  ]);
  assert.equal(summarize(feed.stats(), feed.state.now).averageMm, "87800");
  feed.state.complete = false;
  const partial = summarize(feed.stats(), feed.state.now);
  assert.equal(partial.completeDays, 6);
  assert.equal(partial.ready, true);
  assert.equal(partial.fullWeek, false);
  assert.equal(partial.averageMm, "87800");
  feed.state.missingDays = 4;
  const starter = summarize(feed.stats(), feed.state.now);
  assert.equal(starter.completeDays, 3);
  assert.equal(starter.ready, true);
  assert.equal(starter.totalMm, "263400");
  assert.deepEqual(
    starter.days.filter((day) => day.complete).map((day) => day.date),
    ["2026-10-27", "2026-10-28", "2026-10-29"],
  );
  feed.state.missingDays = 5;
  const tooShort = summarize(feed.stats(), feed.state.now);
  assert.equal(tooShort.completeDays, 2);
  assert.equal(tooShort.ready, false);
  const raw = feed.stats();
  raw.activity.days[1].distanceMm = "-1";
  assert.throws(() => parseStats(raw), /invalid daily/);
  assert.equal(outcome("87800", "614600"), "tie");
  assert.equal(outcome("87801", "614600"), "over");
  assert.equal(outcome("87799", "614600"), "under");
  // A three-day total of 263,401 mm averages 87,800.33 mm: 87,800 is under, not a tie.
  assert.equal(outcome("87800", "263400", 3), "tie");
  assert.equal(outcome("87800", "263401", 3), "under");
  assert.equal(outcome("87801", "263401", 3), "over");
  assert.throws(() => outcome("1", "1", 0), /at least one day/);
});

test("signed prediction saves, denies spoofing, replay and duplicate pending votes", async () => {
  const ctx = await setup();
  try {
    assert.equal(ctx.service.market().ready, true);
    const alice = account(),
      bob = account();
    const challenge = ctx.service.challenge(alice.address, "over");
    assert.match(challenge.message, /No tokens, fees or transactions/);
    const forged = await bob.signMessage({ message: challenge.message });
    await assert.rejects(
      ctx.service.vote(challenge.id, forged),
      /does not match/,
    );
    const signature = await alice.signMessage({ message: challenge.message });
    const vote = await ctx.service.vote(challenge.id, signature);
    assert.equal(vote.expiresAt - vote.startAt, DAY);
    assert.equal(vote.state, "pending");
    await assert.rejects(
      ctx.service.vote(challenge.id, signature),
      /expired|already/,
    );
    assert.throws(
      () => ctx.service.challenge(alice.address, "under"),
      /already/,
    );
    assert.equal(ctx.service.wallet(alice.address).predictions.length, 1);
    assert.equal(ctx.service.leaderboard().items[0].points, 0);
    assert.deepEqual(ctx.service.market().counts, { over: 1, under: 0 });
  } finally {
    await ctx.close();
  }
});

test("24-hour exact interval, delayed evidence, one point, shared leaderboard and durable restart", async () => {
  const ctx = await setup();
  let restarted;
  try {
    const alice = account(),
      bob = account();
    const a = await signVote(ctx.service, alice, "over");
    await signVote(ctx.service, bob, "under");
    // 101 passages in [start,expiry), and two excluded passages on opposite boundaries.
    ctx.feed.state.passages = [
      a.prediction.startAt - 1,
      ...Array.from(
        { length: 101 },
        (_, index) => a.prediction.startAt + index * 1000,
      ),
      a.prediction.expiresAt,
    ];
    ctx.feed.state.now = a.prediction.expiresAt - 1;
    ctx.feed.state.archiveThrough = ctx.feed.state.now;
    await ctx.service.sync();
    assert.equal(
      ctx.service.wallet(alice.address).predictions[0].state,
      "pending",
    );
    ctx.feed.state.now += 1;
    ctx.feed.state.archiveThrough = ctx.feed.state.now - 5000;
    await ctx.service.sync();
    assert.equal(
      ctx.service.wallet(alice.address).predictions[0].state,
      "pending",
      "incomplete archive cannot award points",
    );
    ctx.feed.state.archiveThrough = ctx.feed.state.now;
    await ctx.service.sync();
    assert.equal(ctx.service.wallet(alice.address).predictions[0].state, "won");
    assert.equal(
      ctx.service.wallet(alice.address).predictions[0].distanceMm,
      String(101 * 878),
    );
    assert.equal(ctx.service.wallet(bob.address).predictions[0].state, "lost");
    assert.equal(
      ctx.service.leaderboard().items[0].address,
      alice.address.toLowerCase(),
    );
    assert.equal(ctx.service.leaderboard().items[0].points, 1);
    await ctx.service.sync();
    ctx.service.settle();
    assert.equal(
      ctx.service.leaderboard().items[0].points,
      1,
      "settlement is idempotent",
    );
    await ctx.service.close();
    restarted = ctx.make();
    assert.equal(
      restarted.wallet(alice.address).player.points,
      1,
      "new service process sees durable points",
    );
    assert.equal(restarted.leaderboard().total, 2);
  } finally {
    if (restarted) await restarted.close();
    else await ctx.service.close();
    await rm(ctx.directory, { recursive: true, force: true });
  }
});

test("under wins, exact ties earn zero, and ineligible hardware never settles", async () => {
  for (const [count, ineligible, expected, points] of [
    [99, false, "won", 1],
    [100, false, "tie", 0],
    [99, true, "pending", 0],
  ]) {
    const ctx = await setup();
    try {
      const wallet = account();
      const { prediction } = await signVote(ctx.service, wallet, "under");
      ctx.feed.state.passages = Array.from(
        { length: count },
        (_, index) => prediction.startAt + index * 1000,
      );
      ctx.feed.state.ineligible = ineligible;
      ctx.feed.state.now = prediction.expiresAt;
      ctx.feed.state.archiveThrough = prediction.expiresAt;
      await ctx.service.sync();
      assert.equal(
        ctx.service.wallet(wallet.address).predictions[0].state,
        expected,
      );
      assert.equal(ctx.service.wallet(wallet.address).player.points, points);
    } finally {
      await ctx.close();
    }
  }
});

test("stale feeds, partial weeks, inconsistent calibration, expired signatures and source outages fail closed", async () => {
  const ctx = await setup();
  try {
    const wallet = account();
    ctx.feed.state.stale = true;
    await ctx.service.sync();
    assert.equal(ctx.service.market().ready, false);
    assert.throws(() => ctx.service.challenge(wallet.address, "over"), /stale/);
    ctx.feed.state.stale = false;
    ctx.feed.state.missingDays = 5;
    await ctx.service.sync();
    assert.match(ctx.service.market().reason, /3 complete days \(2\/3 available\)/);
    assert.throws(
      () => ctx.service.challenge(wallet.address, "over"),
      /3 complete days/,
    );
    ctx.feed.state.missingDays = 0;
    ctx.feed.state.badCalibration = true;
    await ctx.service.sync();
    assert.throws(
      () => ctx.service.challenge(wallet.address, "over"),
      /calibration/,
    );
    ctx.feed.state.badCalibration = false;
    await ctx.service.sync();
    const challenge = ctx.service.challenge(wallet.address, "over");
    const signature = await wallet.signMessage({ message: challenge.message });
    ctx.feed.state.now += 300_001;
    await assert.rejects(ctx.service.vote(challenge.id, signature), /expired/);
    ctx.feed.state.sourceError = true;
    await ctx.service.sync();
    assert.equal(ctx.service.market().ready, false);
    assert.match(ctx.service.market().sourceError, /503/);
    assert.throws(() => ctx.service.wallet("invalid"), /valid wallet/);
  } finally {
    await ctx.close();
  }
});

test("HTTP integration: real signatures, two independent clients, CORS and malformed requests", async () => {
  const ctx = await setup();
  const server = createHttpServer(ctx.service, {
    allowedOrigins: ["https://spm.example"],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api`;
  const json = (data) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  try {
    const first = await fetch(`${url}/market`);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).ready, true);
    const wallet = account();
    const challengeResponse = await fetch(
      `${url}/challenge`,
      json({ address: wallet.address, side: "under" }),
    );
    assert.equal(challengeResponse.status, 201);
    const challenge = await challengeResponse.json();
    const signature = await wallet.signMessage({ message: challenge.message });
    assert.equal(
      (await fetch(`${url}/votes`, json({ id: challenge.id, signature })))
        .status,
      201,
    );
    const publicRead = await fetch(`${url}/leaderboard`);
    assert.equal(
      (await publicRead.json()).items[0].address,
      wallet.address.toLowerCase(),
    );
    assert.equal(
      (
        await fetch(`${url}/market`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const allowed = await fetch(`${url}/market`, {
      headers: { Origin: "https://spm.example" },
    });
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://spm.example",
    );
    assert.equal((await fetch(`${url}/leaderboard?offset=-1`)).status, 400);
    assert.equal(
      (await fetch(`${url}/challenge`, { ...json({}), body: "{" })).status,
      400,
    );
    assert.equal(
      (await fetch(`${url}/votes`, json({ signature: "bad" }))).status,
      400,
    );
    assert.equal((await fetch(`${url}/unknown`)).status, 404);
    assert.equal(
      (await fetch(`${url}/challenge`, json({ huge: "x".repeat(25_000) })))
        .status,
      413,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await ctx.close();
  }
});

test("scheduler runs with a short test interval without waiting 24 real hours", async () => {
  const ctx = await setup();
  try {
    const wallet = account();
    const { prediction } = await signVote(ctx.service, wallet, "under");
    ctx.feed.state.now = prediction.expiresAt;
    ctx.feed.state.archiveThrough = prediction.expiresAt;
    ctx.service.start(20);
    const deadline = Date.now() + 2000;
    while (
      ctx.service.wallet(wallet.address).predictions[0].state === "pending" &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ctx.service.wallet(wallet.address).player.points, 1);
  } finally {
    await ctx.close();
  }
});

test("three complete days open voting, lock a three-day target and score against it", async () => {
  const ctx = await setup();
  try {
    ctx.feed.state.missingDays = 4;
    await ctx.service.sync();
    assert.equal(ctx.service.market().ready, true);
    assert.equal(ctx.service.market().baseline.completeDays, 3);
    const alice = account(),
      bob = account();
    const a = await signVote(ctx.service, alice, "over");
    assert.match(a.challenge.message, /Baseline: 3 complete days, total 263400 mm/);
    assert.match(a.challenge.message, /Target: baseline total divided by 3/);
    assert.equal(a.challenge.baselineDays, 3);
    assert.equal(a.prediction.baselineDays, 3);
    assert.equal(a.prediction.totalMm, "263400");
    assert.equal(a.prediction.averageMm, "87800");
    // The day count is part of the signed baseline. A fourth day completing mid-signature is refused.
    const challenge = ctx.service.challenge(bob.address, "under");
    const signature = await bob.signMessage({ message: challenge.message });
    ctx.feed.state.missingDays = 3;
    await ctx.service.sync();
    await assert.rejects(ctx.service.vote(challenge.id, signature), /baseline changed/);
    // Alice's locked three-day target holds after the window grows: 101 passages × 878 mm is over 87,800.
    ctx.feed.state.passages = Array.from(
      { length: 101 },
      (_, index) => a.prediction.startAt + index * 1000,
    );
    ctx.feed.state.now = a.prediction.expiresAt;
    ctx.feed.state.archiveThrough = a.prediction.expiresAt;
    await ctx.service.sync();
    const settled = ctx.service.wallet(alice.address).predictions[0];
    assert.equal(settled.state, "won");
    assert.equal(settled.baselineDays, 3);
    assert.equal(ctx.service.wallet(alice.address).player.points, 1);
    assert.equal(ctx.service.market().baseline.completeDays, 4);
  } finally {
    await ctx.close();
  }
});

test("databases from the seven-day release migrate and keep scoring old votes against seven days", async () => {
  const directory = await mkdtemp(join(tmpdir(), "spm-migrate-"));
  const dbPath = join(directory, "scores.sqlite");
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const old = new DatabaseSync(dbPath);
    old.exec(`CREATE TABLE challenges (id TEXT PRIMARY KEY, address TEXT NOT NULL, side TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL, total TEXT NOT NULL, calibration TEXT NOT NULL, installation TEXT NOT NULL, baselineDate TEXT NOT NULL);
      CREATE TABLE predictions (id TEXT PRIMARY KEY, address TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('over','under')), start INTEGER NOT NULL, expires INTEGER NOT NULL, total TEXT NOT NULL, calibration TEXT NOT NULL, installation TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', distance TEXT, settled INTEGER);
      INSERT INTO predictions (id,address,side,start,expires,total,calibration,installation) VALUES ('old','0x00000000000000000000000000000000000000a1','over',1,2,'614600','878','x');`);
    old.close();
    const feed = createFeed();
    const service = createService({
      dbPath,
      origin: "https://spm.example",
      clock: () => feed.state.now,
      fetcher: feed.fetcher,
      archiveIntervalMs: 0,
    });
    const [row] = service.wallet(
      "0x00000000000000000000000000000000000000a1",
    ).predictions;
    assert.equal(row.baselineDays, 7);
    assert.equal(row.averageMm, "87800");
    await service.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
