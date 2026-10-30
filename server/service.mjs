import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { dependencyRequire } from "./deps.mjs";
import {
  DAY,
  SOURCE,
  parseStats,
  parseStatus,
  summarize,
  calibration,
  isFresh,
  outcome,
} from "../src/lib/data.mjs";
const { isAddress, getAddress, verifyMessage, createPublicClient, http } =
  dependencyRequire("viem");
const { mainnet } = dependencyRequire("viem/chains");

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function createService({
  dbPath,
  origin,
  rpcUrl = "https://ethereum-rpc.publicnode.com",
  clock = Date.now,
  fetcher = fetch,
  signatureVerifier,
  archiveIntervalMs = 550,
} = {}) {
  if (!dbPath || !origin)
    throw new Error("Set a database path and the public service origin.");
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, address TEXT NOT NULL, side TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL, total TEXT NOT NULL, calibration TEXT NOT NULL, installation TEXT NOT NULL, baselineDate TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS predictions (id TEXT PRIMARY KEY, address TEXT NOT NULL, side TEXT NOT NULL CHECK(side IN ('over','under')), start INTEGER NOT NULL, expires INTEGER NOT NULL, total TEXT NOT NULL, calibration TEXT NOT NULL, installation TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', distance TEXT, settled INTEGER);
    CREATE UNIQUE INDEX IF NOT EXISTS one_pending ON predictions(address) WHERE state = 'pending';
    CREATE INDEX IF NOT EXISTS prediction_wallet ON predictions(address,start);
    CREATE TABLE IF NOT EXISTS passages (installation TEXT NOT NULL, at TEXT NOT NULL, time INTEGER NOT NULL, eligible INTEGER NOT NULL, PRIMARY KEY(installation,at));
    CREATE INDEX IF NOT EXISTS passage_time ON passages(installation,time);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const meta = (key) =>
    db.prepare("SELECT value FROM metadata WHERE key=?").get(key)?.value;
  const setMeta = (key, value) =>
    db
      .prepare(
        "INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  let status = meta("status") ? JSON.parse(meta("status")) : null;
  let stats = meta("stats") ? JSON.parse(meta("stats")) : null;
  let lastError = null,
    syncing = false,
    stopped = false,
    timer,
    sourceRetryAt = 0,
    lastArchiveRequest = 0;
  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }),
  });
  const verify =
    signatureVerifier ||
    (async (address, message, signature) => {
      try {
        if (await verifyMessage({ address, message, signature })) return true;
      } catch {
        /* contract wallet path */
      }
      try {
        return await client.verifyMessage({ address, message, signature });
      } catch {
        return false;
      }
    });
  const addressOf = (address) => {
    if (
      typeof address !== "string" ||
      !isAddress(address) ||
      /^0x0{40}$/i.test(address)
    )
      throw new ApiError(400, "Use a valid wallet address.");
    return getAddress(address).toLowerCase();
  };
  const getJson = async (path) => {
    const response = await fetcher(`${SOURCE}${path}`, {
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      const retry = Number(response.headers.get("Retry-After"));
      if ([429, 503].includes(response.status))
        sourceRetryAt =
          clock() +
          Math.min(
            3600_000,
            Math.max(1000, Number.isFinite(retry) ? retry * 1000 : 60_000),
          );
      throw new Error(`Squeekhub returned HTTP ${response.status}.`);
    }
    return response.json();
  };
  function baseline() {
    return stats ? summarize(stats, clock()) : null;
  }
  function readiness() {
    const base = baseline();
    if (!status || !stats) return "Waiting for Squeekhub measurements.";
    if (status.installationId !== stats.installationId)
      return "The source installation changed. Waiting for matching history.";
    if (!isFresh(status, clock()))
      return "The wheel feed is stale. Predictions reopen when fresh readings return.";
    if (
      clock() - Date.parse(stats.generatedAt) > 15 * 60_000 ||
      Date.parse(stats.generatedAt) > clock() + 30_000
    )
      return "Waiting for a fresh history snapshot.";
    if (!base.ready)
      return `Waiting for seven complete days (${base.completeDays}/7 available).`;
    try {
      calibration(
        stats,
        base.days.map((day) => day.date),
      );
    } catch {
      return "Waiting for consistent distance calibration.";
    }
    if (meta(`installation:${status.installationId}:drained`) !== "true")
      return "The settlement archive is catching up.";
    return null;
  }
  function market() {
    const counts = db
      .prepare(
        "SELECT side,COUNT(*) as n FROM predictions WHERE state='pending' GROUP BY side",
      )
      .all();
    const reason = readiness();
    return {
      baseline: baseline(),
      status,
      ready: !reason,
      reason,
      counts: {
        over: Number(counts.find((row) => row.side === "over")?.n || 0),
        under: Number(counts.find((row) => row.side === "under")?.n || 0),
      },
      serverTime: clock(),
      service: "online",
      sourceError: lastError,
    };
  }
  function leaderboard(limit = 20, offset = 0) {
    const rows = db
      .prepare(
        `SELECT address, COUNT(*) AS predictions, SUM(state='won') AS points, SUM(state='won') AS wins, SUM(state!='pending') AS settled FROM predictions GROUP BY address ORDER BY points DESC, settled DESC, address ASC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);
    return {
      items: rows.map((row, index) => ({ ...row, rank: offset + index + 1 })),
      total: Number(
        db.prepare("SELECT COUNT(DISTINCT address) as n FROM predictions").get()
          .n,
      ),
      predictions: Number(
        db.prepare("SELECT COUNT(*) as n FROM predictions").get().n,
      ),
    };
  }
  function serialize(row) {
    return {
      id: row.id,
      address: row.address,
      side: row.side,
      startAt: row.start,
      expiresAt: row.expires,
      totalMm: row.total,
      averageMm: (BigInt(row.total) / 7n).toString(),
      state: row.state,
      distanceMm: row.distance,
      settledAt: row.settled,
    };
  }
  function wallet(address) {
    address = addressOf(address);
    const player =
      db
        .prepare(
          `WITH scores AS (SELECT address, COUNT(*) AS predictions, SUM(state='won') AS points, SUM(state='won') AS wins, SUM(state!='pending') AS settled FROM predictions GROUP BY address), ranked AS (SELECT *, ROW_NUMBER() OVER(ORDER BY points DESC, settled DESC, address ASC) AS rank FROM scores) SELECT * FROM ranked WHERE address=?`,
        )
        .get(address) || null;
    return {
      player,
      predictions: db
        .prepare(
          "SELECT * FROM predictions WHERE address=? ORDER BY start DESC LIMIT 50",
        )
        .all(address)
        .map(serialize),
    };
  }
  function challenge(address, side) {
    address = addressOf(address);
    if (!["over", "under"].includes(side))
      throw new ApiError(400, "Choose Over or Under.");
    const reason = readiness();
    if (reason) throw new ApiError(409, reason);
    if (
      db
        .prepare(
          "SELECT id FROM predictions WHERE address=? AND state='pending'",
        )
        .get(address)
    )
      throw new ApiError(
        409,
        "You already have an active prediction. Wait for its result.",
      );
    const base = baseline(),
      id = randomBytes(24).toString("hex"),
      expires = clock() + 300_000;
    const value = calibration(
      stats,
      base.days.map((day) => day.date),
    );
    const message = [
      "Squeek Prediction Market",
      `Service: ${origin}`,
      `Wallet: ${getAddress(address)}`,
      `Prediction: ${side}`,
      `Seven-day distance total: ${base.totalMm} mm`,
      "Target: seven-day distance total divided by 7",
      `Baseline ends: ${base.days.at(-1).date} (noon UTC)`,
      `Installation: ${base.installationId}`,
      "Window: 24 hours from server acceptance",
      "Reward: 1 point if correct. An exact tie awards no points.",
      "This message records a free prediction. No tokens, fees or transactions.",
      `Nonce: ${id}`,
      `Signature expires: ${new Date(expires).toISOString()}`,
    ].join("\n");
    db.prepare("DELETE FROM challenges WHERE expires < ? OR address=?").run(
      clock(),
      address,
    );
    db.prepare("INSERT INTO challenges VALUES(?,?,?,?,?,?,?,?,?)").run(
      id,
      address,
      side,
      message,
      expires,
      base.totalMm,
      value,
      base.installationId,
      base.days.at(-1).date,
    );
    return { id, message, expiresAt: expires, averageMm: base.averageMm };
  }
  async function vote(id, signature) {
    if (
      typeof id !== "string" ||
      typeof signature !== "string" ||
      signature.length > 20_000 ||
      !/^0x[0-9a-f]+$/i.test(signature)
    )
      throw new ApiError(400, "A valid wallet signature is required.");
    const signed = db.prepare("SELECT * FROM challenges WHERE id=?").get(id);
    if (!signed || signed.expires < clock())
      throw new ApiError(
        409,
        "This signature request expired. Submit your prediction again.",
      );
    if (!(await verify(signed.address, signed.message, signature)))
      throw new ApiError(
        401,
        "The signature does not match this wallet. Reconnect and try again.",
      );
    const reason = readiness();
    if (reason) throw new ApiError(409, reason);
    const base = baseline();
    if (
      base.installationId !== signed.installation ||
      base.days.at(-1).date !== signed.baselineDate ||
      base.totalMm !== signed.total
    )
      throw new ApiError(
        409,
        "The baseline changed while signing. Review it and try again.",
      );
    const now = clock(),
      predictionId = randomUUID();
    db.exec("BEGIN IMMEDIATE");
    try {
      const consumed = db
        .prepare("DELETE FROM challenges WHERE id=? AND expires>=?")
        .run(id, now);
      if (!consumed.changes)
        throw new ApiError(
          409,
          "This signature has already been used or expired.",
        );
      if (
        db
          .prepare(
            "SELECT id FROM predictions WHERE address=? AND state='pending'",
          )
          .get(signed.address)
      )
        throw new ApiError(409, "You already have an active prediction.");
      db.prepare(
        "INSERT INTO predictions (id,address,side,start,expires,total,calibration,installation) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        predictionId,
        signed.address,
        signed.side,
        now,
        now + DAY,
        signed.total,
        signed.calibration,
        signed.installation,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return serialize(
      db.prepare("SELECT * FROM predictions WHERE id=?").get(predictionId),
    );
  }
  async function syncArchive(installation) {
    const prefix = `installation:${installation}:`;
    let cursor = meta(prefix + "cursor") || null;
    setMeta(prefix + "drained", "false");
    // Bounded catch-up. The next tick continues from its durable cursor.
    for (let page = 0; page < 100; page++) {
      if (archiveIntervalMs > 0 && lastArchiveRequest)
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, archiveIntervalMs - (Date.now() - lastArchiveRequest)),
          ),
        );
      if (stopped) return;
      lastArchiveRequest = Date.now();
      const raw = await getJson(
        `/v1/measurement/runs?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (
        raw.schemaVersion !== "measurement-runs.v1" ||
        raw.installationId !== installation ||
        !Array.isArray(raw.items)
      )
        throw new Error("The passage archive returned an unsupported format.");
      const insert = db.prepare(
        "INSERT OR IGNORE INTO passages VALUES(?,?,?,?)",
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const segment of raw.items) {
          if (
            !Array.isArray(segment.passages) ||
            String(segment.passages.length) !== segment.workUnits
          )
            throw new Error("A passage segment is incomplete.");
          for (const passage of segment.passages) {
            const time = Date.parse(passage.at);
            if (!Number.isFinite(time))
              throw new Error("A passage timestamp is invalid.");
            insert.run(
              installation,
              passage.at,
              time,
              segment.measurementEligible === true &&
                segment.provenance === "hardware"
                ? 1
                : 0,
            );
          }
        }
        if (raw.nextCursor) setMeta(prefix + "cursor", raw.nextCursor);
        if (!raw.items.length) {
          if (raw.coverageStartAt)
            setMeta(prefix + "start", String(Date.parse(raw.coverageStartAt)));
          if (raw.coverageThroughAt)
            setMeta(
              prefix + "through",
              String(Date.parse(raw.coverageThroughAt)),
            );
          setMeta(prefix + "drained", "true");
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      if (!raw.items.length) return;
      if (!raw.nextCursor || raw.nextCursor === cursor)
        throw new Error("The passage cursor did not advance.");
      cursor = raw.nextCursor;
    }
  }
  function settle() {
    const due = db
      .prepare("SELECT * FROM predictions WHERE state='pending' AND expires<=?")
      .all(clock());
    for (const row of due) {
      const prefix = `installation:${row.installation}:`;
      if (
        meta(prefix + "drained") !== "true" ||
        !meta(prefix + "start") ||
        Number(meta(prefix + "start")) > row.start ||
        !meta(prefix + "through") ||
        Number(meta(prefix + "through")) < row.expires
      )
        continue;
      const invalid = db
        .prepare(
          "SELECT COUNT(*) as n FROM passages WHERE installation=? AND time>=? AND time<? AND eligible=0",
        )
        .get(row.installation, row.start, row.expires).n;
      if (invalid) continue;
      const count = db
        .prepare(
          "SELECT COUNT(*) as n FROM passages WHERE installation=? AND time>=? AND time<? AND eligible=1",
        )
        .get(row.installation, row.start, row.expires).n;
      const distance = BigInt(count) * BigInt(row.calibration);
      const result = outcome(distance, row.total);
      db.prepare(
        "UPDATE predictions SET state=?,distance=?,settled=? WHERE id=? AND state='pending'",
      ).run(
        result === "tie" ? "tie" : result === row.side ? "won" : "lost",
        distance.toString(),
        clock(),
        row.id,
      );
    }
  }
  async function sync() {
    if (syncing || stopped || clock() < sourceRetryAt) return;
    syncing = true;
    try {
      const [nextStatus, nextStats] = await Promise.all([
        getJson("/v1/status"),
        getJson("/v1/measurement/stats?range=30d"),
      ]);
      status = parseStatus(nextStatus);
      stats = parseStats(nextStats);
      setMeta("status", JSON.stringify(status));
      setMeta("stats", JSON.stringify(stats));
      await syncArchive(status.installationId);
      settle();
      lastError = null;
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "Source unavailable.";
    } finally {
      syncing = false;
    }
  }
  function start(interval = 60_000) {
    void sync();
    timer = setInterval(() => void sync(), interval);
    timer.unref();
  }
  async function close() {
    stopped = true;
    clearInterval(timer);
    while (syncing) await new Promise((resolve) => setTimeout(resolve, 10));
    db.close();
  }
  return {
    market,
    leaderboard,
    wallet,
    challenge,
    vote,
    sync,
    start,
    close,
    settle,
  };
}
