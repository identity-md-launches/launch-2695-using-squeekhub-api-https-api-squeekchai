import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

// Normal installs resolve locally. Contributors may keep all installed dependencies outside the checkout.
const root = resolve(import.meta.dirname, "..");
const dependencyRoot = process.env.SPM_TOOLCHAIN || root;
const require = createRequire(resolve(dependencyRoot, "package.json"));
const command = process.argv[2] || "dev";
const run = (file, args = []) => {
  const result = spawnSync(process.execPath, [file, ...args], {
    stdio: "inherit",
    cwd: root,
    env: process.env,
  });
  process.exit(result.status ?? 1);
};
if (command === "typecheck") {
  const types = ["react", "react-dom", "node"].map((name) =>
    resolve(dependencyRoot, "node_modules/@types", name),
  );
  const config = {
    extends: resolve(root, "tsconfig.json"),
    compilerOptions: {
      baseUrl: root,
      paths: {
        react: [types[0] + "/index.d.ts"],
        "react/*": [types[0] + "/*"],
        "react-dom/*": [types[1] + "/*"],
        wagmi: [
          resolve(
            dependencyRoot,
            "node_modules/wagmi/dist/types/exports/index.d.ts",
          ),
        ],
        "wagmi/*": [
          resolve(dependencyRoot, "node_modules/wagmi/dist/types/exports/*"),
        ],
        viem: [resolve(dependencyRoot, "node_modules/viem/_types/index.d.ts")],
        "viem/*": [resolve(dependencyRoot, "node_modules/viem/_types/*")],
        "@tanstack/react-query": [
          resolve(
            dependencyRoot,
            "node_modules/@tanstack/react-query/build/modern/index.d.ts",
          ),
        ],
      },
      typeRoots: [resolve(dependencyRoot, "node_modules/@types")],
    },
    include: [resolve(root, "src"), resolve(root, "server")],
    exclude: [],
  };
  // This file lives beside external dependencies, never in the submission.
  const location = resolve(
    dependencyRoot === root ? "/tmp" : dependencyRoot,
    "spm-typecheck.json",
  );
  writeFileSync(location, JSON.stringify(config));
  run(require.resolve("typescript/bin/tsc"), ["--noEmit", "-p", location]);
}
if (command === "service")
  run(resolve(root, "server/start.mjs"), process.argv.slice(3));
if (command === "test") run(resolve(root, "test/service.mjs"));
if (command === "browser") run(resolve(root, "test/browser.mjs"));
const vite = await import(pathToFileURL(require.resolve("vite")).href);
const packages = [
  "react",
  "react-dom",
  "wagmi",
  "viem",
  "@tanstack/react-query",
];
const alias = packages.map((name) => ({
  find: new RegExp(`^${name.replace("/", "\\/")}(?=/|$)`),
  replacement: resolve(dependencyRoot, "node_modules", name),
}));
const config = {
  root,
  configFile: false,
  base: "./",
  resolve: { alias },
  esbuild: { jsx: "automatic" },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 1100 },
  server: { host: "127.0.0.1", port: 5173 },
  preview: { host: "127.0.0.1", port: 4173 },
};
if (command === "build") await vite.build(config);
else if (command === "preview") {
  const server = await vite.preview(config);
  server.printUrls();
} else {
  const server = await vite.createServer(config);
  await server.listen();
  server.printUrls();
}
