import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { ApiError } from "./service.mjs";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

export function createHttpServer(
  service,
  {
    allowedOrigins = [],
    distPath = resolve("dist"),
    requestsPerMinute = 60,
  } = {},
) {
  const buckets = new Map();
  const limited = (req) => {
    const key = req.socket.remoteAddress || "unknown";
    const now = Date.now(),
      old = buckets.get(key);
    if (!old || now - old.start > 60_000)
      buckets.set(key, { start: now, count: 1 });
    else if (++old.count > requestsPerMinute)
      throw new ApiError(
        429,
        "Too many requests. Wait a minute and try again.",
      );
    if (buckets.size > 10_000)
      for (const [address, bucket] of buckets)
        if (now - bucket.start > 60_000) buckets.delete(address);
  };
  return createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    try {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      const url = new URL(req.url || "/", "http://service.local");
      if (url.pathname.startsWith("/api/")) {
        if (origin && !allowedOrigins.includes(origin))
          throw new ApiError(
            403,
            "This site is not allowed to use this score service.",
          );
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          return res.end();
        }
        limited(req);
        if (req.method === "GET" && url.pathname === "/api/market")
          return send(200, service.market());
        if (req.method === "GET" && url.pathname === "/api/leaderboard") {
          const limit = Number(url.searchParams.get("limit") || 20),
            offset = Number(url.searchParams.get("offset") || 0);
          if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > 100 ||
            !Number.isInteger(offset) ||
            offset < 0 ||
            offset > 1_000_000
          )
            throw new ApiError(400, "Invalid leaderboard page.");
          return send(200, service.leaderboard(limit, offset));
        }
        if (req.method === "GET" && url.pathname.startsWith("/api/wallet/"))
          return send(
            200,
            service.wallet(url.pathname.slice("/api/wallet/".length)),
          );
        if (
          req.method === "POST" &&
          ["/api/challenge", "/api/votes"].includes(url.pathname)
        ) {
          if (
            !(req.headers["content-type"] || "").startsWith("application/json")
          )
            throw new ApiError(415, "Send a JSON request.");
          let body = "",
            bytes = 0;
          for await (const chunk of req) {
            bytes += chunk.length;
            if (bytes > 24_000)
              throw new ApiError(413, "The request is too large.");
            body += chunk.toString();
          }
          let data;
          try {
            data = JSON.parse(body);
          } catch {
            throw new ApiError(400, "The JSON request is invalid.");
          }
          if (!data || typeof data !== "object")
            throw new ApiError(400, "The request must be an object.");
          if (url.pathname === "/api/challenge")
            return send(201, service.challenge(data.address, data.side));
          return send(201, await service.vote(data.id, data.signature));
        }
        throw new ApiError(404, "This endpoint does not exist.");
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new ApiError(405, "Use GET for site assets.");
      if (url.pathname === "/spm-config.json")
        return send(200, { apiBase: "/api" });
      const file = resolve(
        distPath,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
      if (!file.startsWith(resolve(distPath) + sep))
        throw new ApiError(403, "Invalid asset path.");
      if (!(await stat(file).catch(() => null))?.isFile())
        throw new ApiError(404, "This file does not exist.");
      res.writeHead(200, {
        "Content-Type": MIME[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch (error) {
      send(error instanceof ApiError ? error.status : 500, {
        error:
          error instanceof ApiError
            ? error.message
            : "The score service could not complete this request. Try again.",
      });
    }
  });
}
