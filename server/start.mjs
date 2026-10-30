import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createService } from "./service.mjs";
import { createHttpServer } from "./http.mjs";
const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8787" },
    host: { type: "string", default: "127.0.0.1" },
    origin: { type: "string" },
    db: { type: "string", default: "data/spm.sqlite" },
    "allow-origin": { type: "string", multiple: true },
    rpc: { type: "string" },
  },
});
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Use a valid TCP port.");
const origin = values.origin || `http://localhost:${port}`;
if (
  !["http:", "https:"].includes(new URL(origin).protocol) ||
  new URL(origin).origin !== origin
)
  throw new Error("--origin must be an HTTP(S) origin with no path.");
const path = resolve(values.db);
await mkdir(dirname(path), { recursive: true });
const service = createService({ dbPath: path, origin, rpcUrl: values.rpc });
const server = createHttpServer(service, {
  allowedOrigins: [origin, ...(values["allow-origin"] || [])],
});
server.listen(port, values.host, () =>
  console.log(
    `SPM site and score service: ${origin}\nDatabase: ${path}\nSource: https://api.squeekchain.com/v1/status`,
  ),
);
service.start();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      await service.close();
      process.exit(0);
    });
  });
