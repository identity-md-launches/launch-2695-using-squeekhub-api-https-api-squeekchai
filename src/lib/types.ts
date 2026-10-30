export type Side = "over" | "under";
export interface Day {
  date: string;
  distanceMm: string | null;
  complete: boolean;
  coverageBps: number;
}
export interface Baseline {
  days: Day[];
  completeDays: number;
  totalMm: string;
  averageMm: string | null;
  ready: boolean;
  generatedAt: string;
  installationId: string;
}
export interface WheelStatus {
  schemaVersion: number;
  installationId: string;
  generatedAt: string;
  measurement: null | {
    freshness: string;
    observedAt: string;
    provenance: string;
    coreStatus: string;
    distanceMm: number;
    speedMmPerSecond: number;
    rpmMilli: number;
    cumulativeWorkUnits: string;
    counterEpoch: string;
  };
}
export interface Market {
  baseline: Baseline | null;
  status: WheelStatus | null;
  ready: boolean;
  reason: string | null;
  counts: { over: number; under: number };
  serverTime: number;
  service: "online" | "unconfigured" | "offline";
}
export interface Prediction {
  id: string;
  address: string;
  side: Side;
  startAt: number;
  expiresAt: number;
  averageMm: string;
  totalMm: string;
  state: "pending" | "won" | "lost" | "tie";
  distanceMm: string | null;
  settledAt: number | null;
}
export interface Player {
  address: string;
  points: number;
  predictions: number;
  wins: number;
  settled: number;
  rank: number;
}
export interface Leaderboard {
  items: Player[];
  total: number;
  predictions: number;
}
export interface WalletData {
  player: Player | null;
  predictions: Prediction[];
}
