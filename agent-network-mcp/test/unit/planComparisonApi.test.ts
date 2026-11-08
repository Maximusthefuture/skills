import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStore } from "../../src/storage/fileStore.js";
import { NetworkService } from "../../src/service.js";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => { await ui?.close(); ui = undefined; });

describe("review snapshot API", () => {
  it("serves stored changes, refuses cross-stage comparisons and identifies legacy versions", async () => {
    const dir = join(await tmpDir(), ".agent-network");
    const operator = await NetworkService.create(dir, { id: "operator", type: "ui" });
    await NetworkService.create(dir, { id: "lead", type: "test" });
    await NetworkService.create(dir, { id: "reviewer", type: "test" });
    const task = await operator.createTaskAsOperator({ title: "Review", description: "Review versions", agents: ["lead", "reviewer"], planReview: true });
    const fs = await FileStore.open(dir);
    const version = (n: number, stage: "input" | "change", snapshot?: true) => ({ n, stage, snapshot, by: "lead", at: "2026-11-08T00:00:00Z", bytes: 0 });
    await fs.writeJson(["tasks", task.id, "plan", "state.json"], { versions: [version(1, "input"), version(2, "change", true), version(3, "change", true), version(4, "change")], feedback: [] });
    await fs.writeJson(["tasks", task.id, "plan", "v2.files.json"], [{ name: "spec.md", hash: "old", text: "old requirement", bytes: 15 }]);
    await fs.writeJson(["tasks", task.id, "plan", "v3.files.json"], [{ name: "spec.md", hash: "new", text: "new requirement", bytes: 15 }]);
    ui = await startUiServer([{ networkDir: dir }], { port: 0 });
    const url = `${ui.url}/api/tasks/${task.id}/plan/compare`;
    const response = await fetch(`${url}?from=2&to=3`);
    expect(response.status).toBe(200);
    const data = await response.json() as { available: boolean; files: { lines: string[] }[] };
    expect(data.available).toBe(true);
    expect(data.files[0]!.lines).toContain("-old requirement");
    expect(data.files[0]!.lines).toContain("+new requirement");
    expect((await fetch(`${url}?from=1&to=3`)).status).toBe(400);
    expect((await fetch(`${url}?from=3&to=2`)).status).toBe(400);
    expect((await fetch(`${url}?from=2&to=99`)).status).toBe(400);
    expect(await (await fetch(`${url}?from=3&to=4`)).json()).toMatchObject({ available: false, files: [] });
  });
});
