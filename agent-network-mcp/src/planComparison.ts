/** A comparison uses immutable review snapshots, never the working folder. */
export interface ReviewFile { name: string; hash: string; bytes: number; text?: string; textUnavailable?: string }
export interface ReviewFileChange { name: string; status: string; binary: boolean; unavailable?: string; lines: string[]; truncated: boolean }
export function reviewFileDiff(before: ReviewFile[], after: ReviewFile[]): ReviewFileChange[] {
  const old = new Map(before.map(f => [f.name, f]));
  const now = new Map(after.map(f => [f.name, f]));
  return [...new Set([...old.keys(), ...now.keys()])].sort().flatMap<ReviewFileChange>(name => {
    const a = old.get(name), b = now.get(name);
    if (a && b && a.hash === b.hash) return [];
    const status = !a ? "added" : !b ? "removed" : "modified";
    if ((a && a.text === undefined) || (b && b.text === undefined)) return [{ name, status, binary: true, unavailable: a?.textUnavailable === "size-limit" || b?.textUnavailable === "size-limit" ? "size-limit" : "binary", lines: [] as string[], truncated: false }];
    const left = a ? a.text!.split("\n") : [], right = b ? b.text!.split("\n") : [];
    let prefix = 0, suffix = 0;
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
    while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
    // Bound work for large files; unchanged leading/trailing lines are context only.
    const lines = [
      `@@ -${Math.max(1, prefix + 1)},${left.length - prefix - suffix} +${Math.max(1, prefix + 1)},${right.length - prefix - suffix} @@`,
      ...left.slice(Math.max(0, prefix - 3), prefix).map(l => " " + l),
      ...left.slice(prefix, left.length - suffix).map(l => "-" + l),
      ...right.slice(prefix, right.length - suffix).map(l => "+" + l),
      ...right.slice(right.length - suffix, right.length - suffix + Math.min(3, suffix)).map(l => " " + l),
    ];
    return [{ name, status, binary: false, lines: lines.slice(0, 2000), truncated: lines.length > 2000 }];
  });
}
