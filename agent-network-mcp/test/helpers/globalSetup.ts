import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Integration tests spawn the compiled server (dist/index.js), so build it once per run.
export default function setup(): void {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  execFileSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.build.json"], {
    cwd: root,
    stdio: "inherit",
  });
}
