/** Provider boundary for Bitbucket data. The MCP implementation can replace the mock without UI changes. */
export type BitbucketRepo = { id: string; name: string; workspace: string; project?: string; url: string };
export type BitbucketPullRequest = {
  id: string; repoId: string; title: string; description: string; author: string;
  sourceBranch: string; targetBranch: string; sourceCommit: string; targetCommit: string;
  state: "OPEN" | "MERGED" | "DECLINED"; url: string;
};
export type BitbucketDiffFile = {
  path: string; status: "added" | "modified" | "deleted" | "renamed" | "binary";
  oldPath?: string; diff: string;
};

export interface BitbucketProvider {
  listRepositories(): Promise<BitbucketRepo[]>;
  listPullRequests(repoId: string): Promise<BitbucketPullRequest[]>;
  getPullRequest(repoId: string, pullRequestId: string): Promise<BitbucketPullRequest>;
  getDiff(repoId: string, pullRequestId: string): Promise<BitbucketDiffFile[]>;
  getFile(repoId: string, commit: string, path: string): Promise<string>;
}

const demoRepo: BitbucketRepo = { id: "demo/orders", name: "orders", workspace: "demo", url: "https://bitbucket.org/demo/orders" };
const demoPr: BitbucketPullRequest = {
  id: "42", repoId: demoRepo.id, title: "Validate order quantity", description: "Reject invalid quantities before saving.",
  author: "alex", sourceBranch: "feature/order-quantity", targetBranch: "main",
  sourceCommit: "a1b2c3d4", targetCommit: "e5f6a7b8", state: "OPEN", url: `${demoRepo.url}/pull-requests/42`,
};
const demoDiff: BitbucketDiffFile[] = [{ path: "src/orders.ts", status: "modified", diff: "@@ -12,3 +12,6 @@\n export function saveOrder(order) {\n+  if (order.quantity < 0) throw new Error('Invalid quantity');\n   return db.save(order);\n }" }];

/** Deterministic fixture provider used until an MCP server is selected and connected. */
export class MockBitbucketProvider implements BitbucketProvider {
  async listRepositories(): Promise<BitbucketRepo[]> { return [demoRepo]; }
  async listPullRequests(repoId: string): Promise<BitbucketPullRequest[]> {
    if (repoId !== demoRepo.id) return [];
    return [demoPr];
  }
  async getPullRequest(repoId: string, pullRequestId: string): Promise<BitbucketPullRequest> {
    if (repoId !== demoPr.repoId || pullRequestId !== demoPr.id) throw new Error("Pull request not found");
    return demoPr;
  }
  async getDiff(repoId: string, pullRequestId: string): Promise<BitbucketDiffFile[]> {
    await this.getPullRequest(repoId, pullRequestId);
    return demoDiff;
  }
  async getFile(repoId: string, commit: string, path: string): Promise<string> {
    if (repoId !== demoRepo.id || ![demoPr.sourceCommit, demoPr.targetCommit].includes(commit) || path !== "src/orders.ts") throw new Error("File not found at commit");
    return "export function saveOrder(order) {\n  if (!Number.isInteger(order.quantity) || order.quantity <= 0) throw new Error('Invalid quantity');\n  return db.save(order);\n}\n";
  }
}
