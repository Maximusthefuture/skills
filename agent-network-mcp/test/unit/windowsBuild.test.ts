import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBuildCommand, runBuild } from "../../src/build.js";
import { tmpDir } from "../helpers/tmp.js";

describe("Windows npm build commands", () => {
  it("resolves npm and npx CLI files from PATH while preserving literal arguments", async () => {
    const dir = await tmpDir();
    const bin = join(dir, "node_modules", "npm", "bin");
    await mkdir(bin, { recursive: true });
    for (const name of ["npm", "npx"]) {
      const entry = join(bin, `${name}-cli.js`);
      await writeFile(entry, "");
      expect(resolveBuildCommand([name, "test", "a & b", "%PATH%"], { Path: `"${dir}"` }, "win32", "node.exe"))
        .toEqual(["node.exe", entry, "test", "a & b", "%PATH%"]);
    }
  });
  it("preserves Unix and non-npm command invocation", () => {
    expect(resolveBuildCommand(["npm", "test"], {}, "linux")).toEqual(["npm", "test"]);
    expect(resolveBuildCommand(["pnpm", "test"], {}, "win32")).toEqual(["pnpm", "test"]);
  });
  it.runIf(process.platform === "win32")("runs a real npm build using runBuild", async () => {
    const dir = await tmpDir();
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { build: "node check.cjs" } }));
    await writeFile(join(dir, "check.cjs"), "require('node:fs').writeFileSync('built.txt','built');console.log('BUILD SUCCESS')");
    const result = await runBuild({ cwd: dir, argv: ["npm", "run", "build"], timeoutMs: 30_000 });
    expect(result.ok, await readFile(join(dir, result.logPath), "utf8")).toBe(true);
    expect(await readFile(join(dir, "built.txt"), "utf8")).toBe("built");
  });
});
