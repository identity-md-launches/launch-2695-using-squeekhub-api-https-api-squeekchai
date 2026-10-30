// Synthetic measurements for automated tests only. Never imported by the website or production service.
import { DAY, expectedDates } from "../src/lib/data.mjs";
export function createFeed({
  now = Date.parse("2026-10-30T15:00:00Z"),
  dailyWork = 100,
  mmPerWork = 878,
} = {}) {
  const state = {
    now,
    dailyWork,
    mmPerWork,
    installation: "spm-automated-test",
    complete: true,
    // Oldest days left unrecorded. `complete: false` alone leaves one missing.
    missingDays: 0,
    stale: false,
    badCalibration: false,
    sourceError: false,
    archiveThrough: now,
    passages: [],
    ineligible: false,
    calls: [],
  };
  const status = () => ({
    schemaVersion: 1,
    installationId: state.installation,
    generatedAt: new Date(state.now).toISOString(),
    measurement: {
      freshness: state.stale ? "stale" : "online",
      observedAt: new Date(
        state.now - (state.stale ? 600_000 : 500),
      ).toISOString(),
      distanceMm: dailyWork * mmPerWork,
      cumulativeWorkUnits: "100000",
      provenance: "hardware",
      coreStatus: "IDLE",
      speedMmPerSecond: 0,
      rpmMilli: 0,
      counterEpoch: "automated-epoch",
    },
  });
  const recordedFrom = () =>
    state.complete ? state.missingDays : Math.max(1, state.missingDays);
  const missing = (index) => index < recordedFrom();
  const stats = () => ({
    schemaVersion: 1,
    installationId: state.installation,
    timezone: "UTC",
    generatedAt: new Date(state.now).toISOString(),
    activity: {
      days: expectedDates(state.now).map((date, index) => ({
        date,
        coverage: {
          expectedRoundCount: 144,
          observedRoundCount: missing(index) ? 0 : 144,
          coverageBps: missing(index) ? 0 : 10000,
        },
        observedWorkUnits: missing(index) ? "0" : String(dailyWork),
        distanceMm: missing(index)
          ? null
          : String(
              dailyWork * mmPerWork +
                (state.badCalibration && index === recordedFrom() ? 1 : 0),
            ),
      })),
    },
  });
  const archive = (cursor) => ({
    schemaVersion: "measurement-runs.v1",
    installationId: state.installation,
    coverageStartAt: new Date(state.now - 30 * DAY).toISOString(),
    coverageThroughAt: new Date(state.archiveThrough).toISOString(),
    items:
      Number(cursor || 0) >= state.passages.length
        ? []
        : state.passages.length
          ? [
              {
                workUnits: String(state.passages.length),
                measurementEligible: !state.ineligible,
                provenance: "hardware",
                passages: state.passages.map((at) => ({
                  at: typeof at === "string" ? at : new Date(at).toISOString(),
                })),
              },
            ]
          : [],
    nextCursor: String(state.passages.length),
  });
  const fetcher = async (url) => {
    state.calls.push(url);
    if (state.sourceError) return new Response("{}", { status: 503 });
    const parsed = new URL(url);
    const value =
      parsed.pathname === "/v1/status"
        ? status()
        : parsed.pathname === "/v1/measurement/stats"
          ? stats()
          : archive(parsed.searchParams.get("cursor"));
    return Response.json(value);
  };
  return { state, fetcher, status, stats };
}
