import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { assertCommit, assertRelativeFilePath } from "../../src/validation.js";

describe("assertRelativeFilePath", () => {
  it.each(["src/auth/AuthService.java", "README.md", "a/b.c/d..e.txt"])("accepts %s", (p) => {
    expect(assertRelativeFilePath(p)).toBe(p);
  });
  it.each(["../x", "../../x", "a/../../x", "a/..", "/etc/passwd", "C:\\Windows", "c:/x", "a\\..\\b", "", "a\0b"])("rejects %j", (p) => {
    expect(() => assertRelativeFilePath(p)).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("assertCommit", () => {
  it("accepts hashes and rejects garbage", () => {
    expect(assertCommit("abc123")).toBe("abc123");
    expect(() => assertCommit("--upload-pack=x")).toThrow();
    expect(() => assertCommit("zzzz")).toThrow();
  });
});

describe("loadConfig", () => {
  const env = { AGENT_ID: "backend", AGENT_TYPE: "qwen", AGENT_ROLE: "backend", NETWORK_DIR: "/tmp/p/.agent-network" };
  it("reads identity and network dir from env", () => {
    expect(loadConfig(env)).toEqual({ identity: { id: "backend", type: "qwen", role: "backend" }, candidates: ["backend"], networkDir: "/tmp/p/.agent-network" });
  });
  it("requires AGENT_ID and NETWORK_DIR", () => {
    expect(() => loadConfig({ ...env, AGENT_ID: "" })).toThrow(/AGENT_ID/);
    expect(() => loadConfig({ ...env, NETWORK_DIR: "" })).toThrow(/NETWORK_DIR/);
  });
  it("rejects a relative, root or malformed value", () => {
    expect(() => loadConfig({ ...env, NETWORK_DIR: "relative/.agent-network" })).toThrow(/absolute/);
    expect(() => loadConfig({ ...env, NETWORK_DIR: "/" })).toThrow(/root/);
    expect(() => loadConfig({ ...env, AGENT_ID: "../evil" })).toThrow(/AGENT_ID/);
  });
  it("accepts a comma-separated identity pool", () => {
    const c = loadConfig({ ...env, AGENT_ID: "backend, reviewer" });
    expect(c.candidates).toEqual(["backend", "reviewer"]);
    expect(c.identity.id).toBe("backend");
    expect(() => loadConfig({ ...env, AGENT_ID: "a,a" })).toThrow(/duplicates/);
    expect(() => loadConfig({ ...env, AGENT_ID: "a,../b" })).toThrow(/AGENT_ID/);
    expect(() => loadConfig({ ...env, AGENT_ID: "a," })).toThrow(/AGENT_ID/);
  });
  it("normalizes NETWORK_DIR", () => {
    expect(loadConfig({ ...env, NETWORK_DIR: "/tmp/p/x/../.agent-network" }).networkDir).toBe("/tmp/p/.agent-network");
  });
});
