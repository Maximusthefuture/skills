import { flattenYaml } from "./deploy/notes.js";

/**
 * What a change of an OpenAPI spec means for its clients, without a YAML library: the spec flattened to key paths
 * (flattenYaml), flow values ([a, b], { type: string }) taken apart, and the paths compared by kind — operations,
 * parameters, responses, schema properties, required lists, enums, types. Breaking: a client that worked stops working
 * (an operation or a field gone, a new required input, a narrower enum, another type). Additive: new operations,
 * fields, enum values. Everything else (descriptions, examples) is a plain change. The kind decides the version bump.
 */

export type ApiChangeKind = "breaking" | "additive" | "changed";
export interface ApiChange {
  kind: ApiChangeKind;
  /** The spec file and where in it: "GET /orders/{id}", "Order.status". */
  where: string;
  what: string;
}
export type BumpKind = "breaking" | "additive" | "patch" | "none";

const METHODS = "get|put|post|delete|patch|head|options|trace";
const OP = new RegExp(`^paths\\.(.+?)\\.(${METHODS})(?:\\.|$)`);
const PARAM = new RegExp(`^paths\\.(.+?)\\.(${METHODS})\\.parameters\\[(\\d+)\\]\\.(name|in|required)$`);
const RESPONSE = new RegExp(`^paths\\.(.+?)\\.(${METHODS})\\.responses\\.([^.]+)(?:\\.|$)`);

/** "[a, b]" → ["a", "b"]; anything else → null. */
function list(v: string | undefined): string[] | null {
  if (v === undefined) return null;
  const m = /^\[(.*)\]$/.exec(v.trim());
  return m ? m[1]!.split(",").map((x) => x.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean) : null;
}

/** The spec as key paths, a flow mapping "{ type: string, format: date }" spread into its keys. */
export function flatSpec(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of flattenYaml(text)) {
    const m = /^\{(.*)\}$/.exec(v.trim());
    if (m && !/[{}[\]]/.test(m[1]!)) {
      for (const pair of m[1]!.split(",")) {
        const i = pair.indexOf(":");
        if (i > 0) out.set(`${k}.${pair.slice(0, i).trim()}`, pair.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""));
      }
      continue;
    }
    out.set(k, v.replace(/^['"]|['"]$/g, ""));
  }
  return out;
}

const opName = (path: string, method: string) => `${method.toUpperCase()} ${path}`;
/** "components.schemas.Order.properties.status" → "Order.status"; a path of a file of its own stays as it is. */
const shortProp = (p: string) => p.replace(/^components\.schemas\./, "").replace(/\.properties\./g, ".").replace(/^properties\./, "");

function index(m: Map<string, string>) {
  const ops = new Set<string>();
  const params = new Map<string, boolean>(); // "GET /x|query|limit" → required
  const responses = new Set<string>(); // "GET /x|200"
  const props = new Set<string>();
  const required = new Map<string, Set<string>>();
  const enums = new Map<string, Set<string>>();
  const types = new Map<string, string>();
  const byIndex = new Map<string, { op: string; name?: string; in?: string; required?: boolean }>();
  for (const [k, v] of m) {
    const op = OP.exec(k);
    if (op) ops.add(opName(op[1]!, op[2]!));
    const p = PARAM.exec(k);
    if (p) {
      const key = `${p[1]}|${p[2]}|${p[3]}`;
      const e = byIndex.get(key) ?? { op: opName(p[1]!, p[2]!) };
      if (p[4] === "name") e.name = v;
      else if (p[4] === "in") e.in = v;
      else e.required = v === "true";
      byIndex.set(key, e);
    }
    const r = RESPONSE.exec(k);
    if (r) responses.add(`${opName(r[1]!, r[2]!)}|${r[3]}`);
    if (k.startsWith("paths.")) continue; // the rest is about schemas (inline ones in paths are seen as changes below)
    const prop = /^(.*?\.?properties\.[^.[]+)(?:\.|$)/.exec(k);
    if (prop) props.add(prop[1]!);
    const req = list(v);
    if (k.endsWith(".required") || k === "required") {
      if (req) required.set(k.replace(/\.?required$/, ""), new Set(req));
    }
    if (k.endsWith(".enum") || k === "enum") {
      if (req) enums.set(k.replace(/\.?enum$/, ""), new Set(req));
    }
    if (/(^|\.)type$/.test(k) && /properties\.[^.]+\.type$|^components\.schemas\.[^.]+\.type$/.test(k)) types.set(k.replace(/\.?type$/, ""), v);
  }
  for (const e of byIndex.values()) if (e.name && e.in) params.set(`${e.op}|${e.in}|${e.name}`, !!e.required);
  return { ops, params, responses, props, required, enums, types };
}

/** The changes of one spec file between two versions of it (null: the file is new or gone). */
export function diffSpec(file: string, before: string | null, after: string | null): ApiChange[] {
  if (before === null && after === null) return [];
  if (before === null) return [{ kind: "additive", where: file, what: "новый файл спецификации" }];
  if (after === null) return [{ kind: "breaking", where: file, what: "файл спецификации удалён" }];
  const a = flatSpec(before);
  const b = flatSpec(after);
  const x = index(a);
  const y = index(b);
  const out: ApiChange[] = [];
  const add = (kind: ApiChangeKind, where: string, what: string) => out.push({ kind, where: `${file}: ${where}`, what });

  for (const op of x.ops) if (!y.ops.has(op)) add("breaking", op, "операция удалена");
  for (const op of y.ops) if (!x.ops.has(op)) add("additive", op, "новая операция");
  for (const [k, req] of y.params) {
    const [op, where, name] = k.split("|") as [string, string, string];
    if (!x.ops.has(op)) continue;
    const was = x.params.get(k);
    if (was === undefined && req) add("breaking", op, `новый обязательный параметр ${name} (${where})`);
    else if (was === undefined) add("additive", op, `новый параметр ${name} (${where})`);
    else if (!was && req) add("breaking", op, `параметр ${name} (${where}) стал обязательным`);
  }
  for (const k of x.params.keys()) {
    const [op, where, name] = k.split("|") as [string, string, string];
    if (y.ops.has(op) && !y.params.has(k)) add("changed", op, `параметр ${name} (${where}) убран`);
  }
  for (const k of x.responses) {
    const [op, code] = k.split("|") as [string, string];
    if (y.ops.has(op) && !y.responses.has(k)) add(/^2/.test(code) ? "breaking" : "changed", op, `ответ ${code} убран`);
  }
  for (const k of y.responses) {
    const [op, code] = k.split("|") as [string, string];
    if (x.ops.has(op) && !x.responses.has(k)) add("changed", op, `новый ответ ${code}`);
  }
  for (const p of x.props) if (!y.props.has(p)) add("breaking", shortProp(p), "поле удалено");
  for (const p of y.props) if (!x.props.has(p)) add("additive", shortProp(p), "новое поле");
  for (const [schema, names] of y.required) {
    const was = x.required.get(schema) ?? new Set<string>();
    const fresh = [...names].filter((n) => !was.has(n));
    if (fresh.length) add("breaking", shortProp(schema) || file, `стали обязательными: ${fresh.join(", ")}`);
  }
  for (const [path, values] of x.enums) {
    const now = y.enums.get(path);
    if (!now) continue;
    const gone = [...values].filter((v) => !now.has(v));
    const fresh = [...now].filter((v) => !values.has(v));
    if (gone.length) add("breaking", shortProp(path), `убраны значения: ${gone.join(", ")}`);
    if (fresh.length) add("additive", shortProp(path), `новые значения: ${fresh.join(", ")}`);
  }
  for (const [path, t] of x.types) {
    const now = y.types.get(path);
    if (now !== undefined && now !== t) add("breaking", shortProp(path), `тип ${t} → ${now}`);
  }
  // what the rules above do not name: texts for people (descriptions, examples) counted apart; anything else only when
  // nothing else was found, so that a change is never shown as none
  let texts = 0;
  let other = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(k) === b.get(k) || k === "info.version") continue;
    const op = OP.exec(k);
    if (op && !(x.ops.has(opName(op[1]!, op[2]!)) && y.ops.has(opName(op[1]!, op[2]!)))) continue; // inside an operation added or removed
    if (/(^|\.)(description|summary|title|example|examples|externalDocs|x-[^.[]*)(\.|\[|$)/.test(k)) texts++;
    else other++;
  }
  if (texts) add("changed", "спецификация", `правки описаний и примеров: ${texts}`);
  if (other && !out.some((c) => c.kind !== "changed")) add("changed", "спецификация", `прочие правки: ${other}`);
  return out.slice(0, 200);
}

/** The bump the changes need: any breaking → major, any addition → minor, other changes → patch. */
export function bumpKind(changes: ApiChange[]): BumpKind {
  if (changes.some((c) => c.kind === "breaking")) return "breaking";
  if (changes.some((c) => c.kind === "additive")) return "additive";
  return changes.length ? "patch" : "none";
}
