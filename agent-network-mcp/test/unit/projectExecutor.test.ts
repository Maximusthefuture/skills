import { stat } from "node:fs/promises";
import { expect, it } from "vitest";
import { isolatedCoordinatorExecutor } from "../../src/project/executor.js";
it("uses isolated fixed CLI settings and waits for its result before removing the workspace", async () => {
  let folder = "";
  const executor = isolatedCoordinatorExecutor({ snapshot: async () => ({ projectId: "p1" }), run: async (argv, env, cwd) => {
    folder = cwd!;
    expect((await stat(folder)).isDirectory()).toBe(true);
    expect(argv).toContain("--strict-mcp-config");
    expect(argv[argv.indexOf("--tools") + 1]).toBe("");
    expect(argv[argv.indexOf("--settings") + 1]).toContain('"disableAllHooks":true');
    expect(env.AGENT_ID).toBeUndefined(); expect(env.NETWORK_DIR).toBeUndefined();
    return { code: 0, result: { text: "Answer" } };
  } });
  const answer = await executor({ message: { messageId: "m1", content: "Question", createdAt: "now" }, run: { runId: "r1", messageId: "m1", state: "running" }, signal: new AbortController().signal });
  expect(answer).toBe("Answer");
  await expect(stat(folder)).rejects.toThrow();
});
