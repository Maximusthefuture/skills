/**
 * File ownership for the DISCUSS agreement. Every agent declares the files (or globs) it will change;
 * declarations of different agents must not overlap. Pure functions, no I/O.
 *
 * Glob syntax: `*` (within a path segment), `**` (across segments), `?`; a trailing `/` means the whole directory.
 */
const WILDCARD = /[*?]/;

export function normalizePath(p: string): string {
  let n = p.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/{2,}/g, "/");
  if (n.endsWith("/")) n += "**";
  return n;
}

export const hasWildcard = (p: string): boolean => WILDCARD.test(p);

function literalPrefix(p: string): string {
  const i = p.search(WILDCARD);
  return i < 0 ? p : p.slice(0, i);
}

/** Does `pattern` (path or glob) cover the concrete `path`? */
export function matches(pattern: string, path: string): boolean {
  const p = normalizePath(pattern);
  const f = normalizePath(path);
  return hasWildcard(p) ? globToRegExp(p).test(f) : p === f;
}

/** Does declaration `a` include everything `b` (path or glob) names? Conservative for globs. */
export function covers(a: string, b: string): boolean {
  const x = normalizePath(a);
  const y = normalizePath(b);
  if (x === y) return true;
  if (!hasWildcard(x)) return false;
  if (!hasWildcard(y)) return matches(x, y);
  return x.endsWith("**") && literalPrefix(y).startsWith(literalPrefix(x));
}

/** A glob as a sequence of tokens; matching (globToRegExp) and the overlap check are both built on it. */
type Token = { kind: "lit"; c: string } | { kind: "one" } | { kind: "star" } | { kind: "globstar" };

function tokenize(pattern: string): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      out.push({ kind: "globstar" });
      i++;
      if (pattern[i + 1] === "/") i++;
    } else if (c === "*") out.push({ kind: "star" });
    else if (c === "?") out.push({ kind: "one" });
    else out.push({ kind: "lit", c });
  }
  return out;
}

const loops = (t: Token) => t.kind === "star" || t.kind === "globstar";

/** Is there a character both tokens accept? `one` / `star` take any char but '/', `globstar` takes any. */
function shareChar(a: Token, b: Token): boolean {
  if (a.kind === "lit" && b.kind === "lit") return a.c === b.c;
  if (a.kind === "lit") return b.kind === "globstar" || a.c !== "/";
  if (b.kind === "lit") return a.kind === "globstar" || b.c !== "/";
  return true;
}

/** Exact: does some path match both globs? Walks the product of the two pattern automata. */
function intersect(x: Token[], y: Token[]): boolean {
  const seen = new Set<number>();
  const stack: [number, number][] = [[0, 0]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const key = i * (y.length + 1) + j;
    if (seen.has(key)) continue;
    seen.add(key);
    if (i === x.length && j === y.length) return true;
    const a = x[i];
    const b = y[j];
    if (a && loops(a)) stack.push([i + 1, j]); // the star matches nothing more
    if (b && loops(b)) stack.push([i, j + 1]);
    if (a && b && shareChar(a, b)) stack.push([loops(a) ? i : i + 1, loops(b) ? j : j + 1]);
  }
  return false;
}

function globToRegExp(pattern: string): RegExp {
  const part = (t: Token) =>
    t.kind === "globstar" ? ".*" : t.kind === "star" ? "[^/]*" : t.kind === "one" ? "[^/]" : t.c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${tokenize(pattern).map(part).join("")}$`);
}

/** Can the two declarations name the same file? Exact for paths and globs alike. */
export function overlaps(a: string, b: string): boolean {
  const x = normalizePath(a);
  const y = normalizePath(b);
  if (!hasWildcard(x) && !hasWildcard(y)) return x === y;
  return intersect(tokenize(x), tokenize(y));
}

export interface Declared {
  agentId: string;
  files?: string[];
}

export interface Overlap {
  agents: [string, string];
  files: [string, string];
}

export function findOverlaps(assignments: Declared[]): Overlap[] {
  const out: Overlap[] = [];
  for (let i = 0; i < assignments.length; i++) {
    for (let j = i + 1; j < assignments.length; j++) {
      for (const fa of assignments[i]!.files ?? []) {
        for (const fb of assignments[j]!.files ?? []) {
          if (overlaps(fa, fb)) out.push({ agents: [assignments[i]!.agentId, assignments[j]!.agentId], files: [fa, fb] });
        }
      }
    }
  }
  return out;
}

/** Agents whose declarations include `path`. */
export function ownersOf(path: string, assignments: Declared[]): string[] {
  return assignments.filter((a) => (a.files ?? []).some((f) => matches(f, path))).map((a) => a.agentId);
}

export function anyDeclared(assignments: Declared[]): boolean {
  return assignments.some((a) => (a.files ?? []).length > 0);
}
