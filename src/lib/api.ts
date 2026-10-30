import {
  STATUS_URL,
  STATS_URL,
  parseStatus,
  parseStats,
  summarize,
} from "./data.mjs";
import type { Market } from "./types";
export async function request<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(18_000),
      headers: { Accept: "application/json", ...options?.headers },
    });
  } catch (cause) {
    throw new Error(
      cause instanceof Error && cause.name === "TimeoutError"
        ? "The service took too long. Try again."
        : "Couldn’t reach the service. Check your connection and try again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error || `The service returned HTTP ${response.status}. Try again.`,
    );
  if (data === null)
    throw new Error("The service returned an unreadable response. Try again.");
  return data as T;
}
export async function getConfig() {
  const config = await request<{ apiBase: string }>("./spm-config.json");
  let override: string | null = null;
  try {
    override = localStorage.getItem("spm-api-base");
  } catch {
    /* storage is optional */
  }
  return normalizeApi(override ?? config.apiBase);
}
export function normalizeApi(input: string) {
  if (!input.trim()) return "";
  const url = new URL(input.trim(), location.href);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTPS service URL without credentials, a query or a fragment.",
    );
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Use HTTPS for a public service.");
  return url.href.replace(/\/$/, "");
}
let historyCache: { value: unknown; receivedAt: number } | null = null;
async function getHistory() {
  if (historyCache && Date.now() - historyCache.receivedAt < 300_000)
    return historyCache.value;
  const value = parseStats(await request(STATS_URL));
  historyCache = { value, receivedAt: Date.now() };
  return value;
}
export async function getMarket(apiBase: string): Promise<Market> {
  if (apiBase) {
    const result = await request<Market>(`${apiBase}/market`);
    if (
      !result ||
      typeof result.ready !== "boolean" ||
      result.service !== "online" ||
      !Number.isFinite(result.serverTime) ||
      typeof result.counts?.over !== "number" ||
      typeof result.counts?.under !== "number"
    )
      throw new Error("This URL is not a compatible SPM score service.");
    return result;
  }
  const [statusRaw, statsRaw] = await Promise.all([
    request(STATUS_URL),
    getHistory(),
  ]);
  const status = parseStatus(statusRaw),
    baseline = summarize(parseStats(statsRaw));
  if (status.installationId !== baseline.installationId)
    throw new Error(
      "The live feed and history refer to different installations. Try refreshing.",
    );
  return {
    status,
    baseline,
    ready: false,
    reason: "Public predictions open when a shared score service is connected.",
    counts: { over: 0, under: 0 },
    service: "unconfigured",
    serverTime: Date.now(),
  };
}
export function post<T>(apiBase: string, path: string, data: unknown) {
  return request<T>(`${apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
