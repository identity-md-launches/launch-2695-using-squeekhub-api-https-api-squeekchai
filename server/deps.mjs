import { createRequire } from "node:module";
import { resolve } from "node:path";
export const dependencyRequire = createRequire(
  resolve(
    process.env.SPM_TOOLCHAIN || resolve(import.meta.dirname, ".."),
    "package.json",
  ),
);
