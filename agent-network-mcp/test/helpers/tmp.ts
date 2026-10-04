import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const dirs: string[] = [];

/** Fresh temp dir removed after each test. */
export async function tmpDir(prefix = "agent-network-test-"): Promise<string> {
  const dir = realpathSync(await mkdtemp(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
