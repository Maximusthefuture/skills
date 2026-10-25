import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forgetProject, listProjects, peekProject, registerProject, releaseProjects } from "../../src/registry.js";
import { NetworkService } from "../../src/service.js";
import { RunnerPool } from "../../src/ui/runners.js";
import { startUiServer, type UiProject, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

/** A git repository <root>/<name> with its network. */
async function repo(name: string) {
  const dir = join(await tmpDir(), name);
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  const networkDir = join(dir, ".agent-network");
  return { dir, networkDir, operator: await NetworkService.create(networkDir, { id: "operator", type: "cli" }) };
}

describe("the list of all projects", () => {
  it("remembers projects, newest first; a page that is gone serves nothing; forgetting leaves the folder", async () => {
    const file = join(await tmpDir(), "projects.json");
    const shop = await repo("shop");
    const blog = await repo("blog");
    await registerProject(shop.dir, { served: { pid: process.pid, url: "http://127.0.0.1:1" } }, file);
    // a page whose process ended
    const dead = spawn(process.execPath, ["-e", ""]);
    await new Promise((r) => dead.on("exit", r));
    await registerProject(blog.dir, { config: "/c/blog.json", served: { pid: dead.pid!, url: "http://127.0.0.1:2" } }, file);
    const list = await listProjects(file);
    expect(list.map((p) => [p.name, p.servedBy?.url ?? null, p.config ?? null])).toEqual([["blog", null, "/c/blog.json"], ["shop", "http://127.0.0.1:1", null]]);
    await releaseProjects([shop.dir], process.pid, file);
    expect((await listProjects(file)).find((p) => p.name === "shop")!.servedBy).toBeUndefined();

    await shop.operator.createTaskAsOperator({ title: "t", description: "d", agents: ["a", "b"] });
    expect(await peekProject(shop.dir)).toMatchObject({ exists: true, open: 1, blocked: 0, lastActivity: expect.any(String) });
    expect(await peekProject(join(shop.dir, "gone"))).toMatchObject({ exists: false });
    expect(await forgetProject(blog.dir, file)).toBe(true);
    expect((await listProjects(file)).map((p) => p.name)).toEqual(["shop"]);
  });
});

let ui: UiServer | undefined;
afterEach(async () => {
  await ui?.close();
  ui = undefined;
});

describe("projects opened and closed on a running page", () => {
  it("opens one from the list with all it runs, refuses one another page runs, closes it into the list", async () => {
    const file = join(await tmpDir(), "projects.json");
    const shop = await repo("shop");
    const blog = await repo("blog");
    const wiki = await repo("wiki");
    writeFileSync(join(blog.dir, "README.md"), "blog");
    await blog.operator.createTaskAsOperator({ title: "Posts", description: "list the posts", agents: ["a", "b"] });
    await registerProject(blog.dir, {}, file);
    await registerProject(wiki.dir, { served: { pid: process.ppid, url: "http://127.0.0.1:4999" } }, file);

    const events: string[] = [];
    const spec = (networkDir: string, name: string): UiProject => ({
      networkDir, runners: new RunnerPool(networkDir, [{ id: "a", command: ["x"], cwd: join(networkDir, ".."), autostart: false }]),
      start: async (_url, id) => void events.push(`start ${name} as ${id}`),
      stop: async () => void events.push(`stop ${name}`),
    });
    const opened: string[] = [];
    ui = await startUiServer([spec(shop.networkDir, "shop")], {
      port: 0, registry: file,
      openProject: async (dir) => {
        opened.push(dir);
        return spec(join(dir, ".agent-network"), "blog");
      },
    });
    const post = async (path: string, body: unknown) => {
      const r = await fetch(`${ui!.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: (await r.json()) as any };
    };
    const projects = async () => (await (await fetch(`${ui!.url}/api/projects`)).json()) as any;
    expect(events).toEqual(["start shop as shop"]);
    const before = await projects();
    expect(before).toMatchObject({ canOpen: true, projects: [{ id: "shop" }] });
    expect(before.known.map((k: any) => [k.name, k.open, k.servedBy])).toEqual([["wiki", 0, "http://127.0.0.1:4999"], ["blog", 1, null]]);
    expect((await listProjects(file)).find((p) => p.name === "shop")!.servedBy).toMatchObject({ pid: process.pid, url: ui.url });

    expect(await post("/api/projects/open", { dir: wiki.dir })).toMatchObject({ status: 400, body: { message: expect.stringContaining("http://127.0.0.1:4999") } });
    expect(await post("/api/projects/open", { dir: "relative/path" })).toMatchObject({ status: 400 });
    expect(await post("/api/projects/close", { id: "shop" })).toMatchObject({ status: 400, body: { message: expect.stringContaining("only project") } });
    const r = await post("/api/projects/open", { dir: blog.dir });
    expect(r).toMatchObject({ status: 200, body: { project: { id: "blog" } } });
    expect(await post("/api/projects/open", { dir: blog.dir })).toMatchObject({ status: 200, body: { already: true } });
    expect(opened).toEqual([blog.dir]);
    expect(events).toEqual(["start shop as shop", "start blog as blog"]);
    const state = (await (await fetch(`${ui.url}/api/state?project=blog`)).json()) as any;
    expect(state.tasks.map((t: any) => t.title)).toEqual(["Posts"]);
    expect((await projects()).known.map((k: any) => k.name)).toEqual(["wiki"]);
    expect(await post("/api/projects/forget", { dir: blog.dir })).toMatchObject({ status: 400 });

    expect(await post("/api/projects/close", { id: "blog" })).toMatchObject({ status: 200, body: { closed: "blog" } });
    expect(events.at(-1)).toBe("stop blog");
    expect((await fetch(`${ui.url}/api/state?project=blog`)).status).toBe(404);
    expect((await projects()).known.map((k: any) => [k.name, k.servedBy])).toEqual([["blog", null], ["wiki", "http://127.0.0.1:4999"]]);
    expect(await post("/api/projects/forget", { dir: blog.dir })).toMatchObject({ status: 200, body: { forgotten: true } });

    // the supervisor does not open or close projects
    const sup = await fetch(`${ui.url}/api/projects/open`, { method: "POST", headers: { "content-type": "application/json", "x-agent-network-actor": "supervisor" }, body: JSON.stringify({ dir: blog.dir }) });
    expect(sup.status).toBe(400);
    await ui.close();
    ui = undefined;
    expect(events.at(-1)).toBe("stop shop");
    expect((await listProjects(file)).find((p) => p.name === "shop")!.servedBy).toBeUndefined();
  });

  it("a page without the list cannot open projects", async () => {
    const shop = await repo("shop");
    ui = await startUiServer([{ networkDir: shop.networkDir, runners: new RunnerPool(shop.networkDir, []) }], { port: 0 });
    expect(((await (await fetch(`${ui.url}/api/projects`)).json()) as any)).toMatchObject({ canOpen: false, known: [] });
    const r = await fetch(`${ui.url}/api/projects/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir: shop.dir }) });
    expect(r.status).toBe(400);
  });
});

describe("«Открыть» loads a project as `ui` in its folder would", () => {
  it("creates its config from the template the first time, then everything it runs", async () => {
    const { openProjectAt } = await import("../../src/ui/assemble.js");
    const shop = await repo("shop");
    writeFileSync(join(shop.dir, "package.json"), JSON.stringify({ name: "shop", scripts: { test: "node --test" } }));
    execFileSync("git", ["add", "."], { cwd: shop.dir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: shop.dir });
    const lines: string[] = [];
    const spec = await openProjectAt(shop.dir, { env: { PATH: "" } }, (l) => lines.push(l));
    expect(lines[0]).toContain("(new, from the qwen template)");
    expect(spec).toMatchObject({ networkDir: shop.networkDir, configPath: join(shop.networkDir, "runners.json") });
    expect(spec.runners!.list().length).toBeGreaterThan(0);
    await spec.stop!();
    await expect(openProjectAt(await tmpDir(), {}, () => undefined)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
