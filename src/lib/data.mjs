export const DAY = 86_400_000;
export const SOURCE = "https://api.squeekchain.com";
export const STATS_URL = `${SOURCE}/v1/measurement/stats?range=30d`;
export const STATUS_URL = `${SOURCE}/v1/status`;
// The window is the last seven complete days. Until a full week exists, voting opens on the
// complete days recorded so far, starting at three, and the average grows to seven by itself.
export const WINDOW_DAYS = 7;
export const MIN_DAYS = 3;

export function deviceDay(time) {
  return new Date(new Date(time).getTime() - 12 * 3_600_000)
    .toISOString()
    .slice(0, 10);
}
export function expectedDates(time) {
  const noon = Date.parse(`${deviceDay(time)}T12:00:00.000Z`);
  return Array.from({ length: WINDOW_DAYS }, (_, index) =>
    new Date(noon - (WINDOW_DAYS - index) * DAY).toISOString().slice(0, 10),
  );
}
const integer = (value) => typeof value === "string" && /^\d+$/.test(value);
export function parseStats(raw) {
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    typeof raw.installationId !== "string" ||
    raw.timezone !== "UTC" ||
    !Array.isArray(raw.activity?.days) ||
    !Number.isFinite(Date.parse(raw.generatedAt))
  ) {
    throw new Error("Squeekhub returned an unsupported history format.");
  }
  const dates = new Set();
  for (const day of raw.activity.days) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
      dates.has(day.date) ||
      (day.distanceMm !== null && !integer(day.distanceMm)) ||
      !integer(day.observedWorkUnits) ||
      !Number.isInteger(day.coverage?.observedRoundCount) ||
      !Number.isInteger(day.coverage?.expectedRoundCount) ||
      !Number.isInteger(day.coverage?.coverageBps)
    ) {
      throw new Error("Squeekhub returned invalid daily measurements.");
    }
    dates.add(day.date);
  }
  return raw;
}
export function parseStatus(raw) {
  if (
    !raw ||
    raw.schemaVersion !== 1 ||
    typeof raw.installationId !== "string" ||
    !Number.isFinite(Date.parse(raw.generatedAt))
  )
    throw new Error("Squeekhub returned an unsupported status format.");
  const measurement = raw.measurement;
  if (
    measurement &&
    (!Number.isSafeInteger(measurement.distanceMm) ||
      measurement.distanceMm < 0 ||
      !integer(measurement.cumulativeWorkUnits) ||
      !Number.isFinite(Date.parse(measurement.observedAt)))
  )
    throw new Error("Squeekhub returned an invalid wheel reading.");
  return raw;
}
export function summarize(stats, now = Date.now()) {
  parseStats(stats);
  const dates = expectedDates(now);
  const days = dates.map((date) => {
    const raw = stats.activity.days.find((day) => day.date === date);
    const complete =
      !!raw &&
      raw.distanceMm !== null &&
      raw.coverage.expectedRoundCount === 144 &&
      raw.coverage.observedRoundCount === 144 &&
      raw.coverage.coverageBps === 10000;
    return {
      date,
      distanceMm: raw?.distanceMm ?? null,
      complete,
      coverageBps: raw?.coverage.coverageBps ?? 0,
    };
  });
  const complete = days.filter((day) => day.complete);
  const sum = complete.reduce(
    (total, day) => total + BigInt(day.distanceMm),
    0n,
  );
  return {
    days,
    completeDays: complete.length,
    totalMm: sum.toString(),
    averageMm: complete.length
      ? (sum / BigInt(complete.length)).toString()
      : null,
    ready: complete.length >= MIN_DAYS,
    fullWeek: complete.length === WINDOW_DAYS,
    generatedAt: stats.generatedAt,
    installationId: stats.installationId,
  };
}
// Calibration comes from the API's complete daily distance/work pairs, never an invented circumference.
export function calibration(stats, dates) {
  const values = stats.activity.days
    .filter(
      (day) =>
        dates.includes(day.date) &&
        day.distanceMm !== null &&
        BigInt(day.observedWorkUnits) > 0n,
    )
    .map((day) => {
      const distance = BigInt(day.distanceMm),
        work = BigInt(day.observedWorkUnits);
      if (distance % work !== 0n)
        throw new Error("Distance calibration is not exact.");
      return distance / work;
    });
  if (
    !values.length ||
    values[0] <= 0n ||
    values.some((value) => value !== values[0])
  )
    throw new Error("A consistent wheel calibration is not available.");
  return values[0].toString();
}
export function isFresh(status, now = Date.now()) {
  const m = status?.measurement;
  const age = now - Date.parse(m?.observedAt);
  return (
    !!m &&
    m.freshness === "online" &&
    m.provenance === "hardware" &&
    m.coreStatus !== "COUNTER_FAULT" &&
    age >= -30_000 &&
    age <= 120_000
  );
}
// Compares one day's distance with total / days exactly, without rounding the average.
export function outcome(distanceMm, totalMm, days = WINDOW_DAYS) {
  if (!Number.isInteger(days) || days < 1)
    throw new Error("A baseline needs at least one day.");
  const comparison = BigInt(distanceMm) * BigInt(days) - BigInt(totalMm);
  return comparison > 0n ? "over" : comparison < 0n ? "under" : "tie";
}
export function km(mm, digits = 2) {
  if (mm === null || mm === undefined) return "Unavailable";
  return (Number(mm) / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
