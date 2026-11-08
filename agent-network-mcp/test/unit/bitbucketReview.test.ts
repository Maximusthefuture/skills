import { afterEach, describe, expect, it } from "vitest";
import { startUiServer, type UiServer } from "../../src/ui/server.js";
import { tmpDir } from "../helpers/tmp.js";

let ui: UiServer | undefined;
afterEach(async () => { await ui?.close(); ui = undefined; });

describe("Bitbucket PR review mock workflow", () => {
  it("loads repositories, PRs and diff, then returns a visibly mocked review", async () => {
    ui = await startUiServer(await tmpDir(), { port: 0, notifySend: null });
    const base = ui.url;
    const repositories = await fetch(`${base}/api/bitbucket/repositories`).then(r => r.json()) as { mode: string; repositories: { id: string }[] };
    expect(repositories).toMatchObject({ mode: "mock", repositories: [{ id: "demo/orders" }] });
    const repoId = repositories.repositories[0]!.id;
    const prs = await fetch(`${base}/api/bitbucket/pull-requests?repo=${encodeURIComponent(repoId)}`).then(r => r.json()) as { pullRequests: { id: string }[] };
    expect(prs.pullRequests).toHaveLength(1);
    const prId = prs.pullRequests[0]!.id;
    const diff = await fetch(`${base}/api/bitbucket/repositories/${encodeURIComponent(repoId)}/pull-requests/${prId}/diff`).then(r => r.json()) as { files: { path: string }[] };
    expect(diff.files[0]).toMatchObject({ path: "src/orders.ts" });
    const started = await fetch(`${base}/api/bitbucket/review`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ repoId, pullRequestId: prId, agents: ["reviewer"] }) });
    expect(started.status).toBe(202);
    const review = await started.json() as { mode: string; agents: string[]; findings: { file: string; reviewers: string[] }[]; review: { status: string; id: string } };
    expect(review).toMatchObject({ mode: "mock", agents: ["reviewer"], findings: [{ file: "src/orders.ts", reviewers: ["reviewer"] }], review: { status: "running" } });
    const inProgress = await fetch(`${base}/api/bitbucket/reviews`).then(r => r.json()) as { reviews: { status: string; id: string }[] };
    expect(inProgress.reviews[0]).toMatchObject({ id: review.review.id, status: "running" });
    await new Promise(resolve => setTimeout(resolve, 1900));
    const stillRunning = await fetch(`${base}/api/bitbucket/reviews`).then(r => r.json()) as { reviews: { status: string; id: string }[] };
    expect(stillRunning.reviews[0]).toMatchObject({ id: review.review.id, status: "running" });
    await fetch(`${base}/api/bitbucket/reviews/${review.review.id}/status`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ status: "completed" }) });
    const completed = await fetch(`${base}/api/bitbucket/reviews`).then(r => r.json()) as { reviews: { status: string; id: string }[] };
    expect(completed.reviews[0]).toMatchObject({ id: review.review.id, status: "completed" });
    const page = await fetch(base).then(r => r.text());
    expect(page).toContain("Ревью PR");
  });
});
