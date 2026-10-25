import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DeployEnvironment } from "./settings.js";

/**
 * «Для раскатки»: what the environment must have for the merged work of a task to start, read from its diff. New
 * settings — fields of @ConfigurationProperties classes (java-conventions keeps them there), new @Value("${…}"), new
 * keys of application*.yml / .properties — with the environment variable Spring binds each to, its default, whether
 * the service starts without it, whether it looks like a secret, and whether each environment already sets it (its
 * values file or the keys the operator listed). Also new Liquibase changesets, Kafka topics and outbound addresses.
 * Values of secrets are never read out: only the keys.
 */

const run = promisify(execFile);

export interface PropertyNote {
  key: string;
  envVar: string;
  /** Where it comes from: the file (and for a class, its name). */
  source: string;
  /** Its default in application.yml or in the code; undefined — none. */
  defaultValue?: string;
  /** The service does not start without it (no default anywhere). */
  required: boolean;
  secret: boolean;
  change: "added" | "changed";
  /** Per environment: set there (true), not set (false), unknown — nothing to check against (null). */
  inEnv: Record<string, boolean | null>;
}

export interface DeployNotes {
  base: string;
  head: string;
  filesChanged: number;
  properties: PropertyNote[];
  migrations: string[];
  topics: { key: string; value: string }[];
  endpoints: { key: string; value: string }[];
  /** Required keys an environment does not set: the short list for the page and the confirm dialog. */
  missing: { env: string; key: string; envVar: string }[];
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await run("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 })).stdout;
  } catch {
    return null;
  }
}

/** Spring's relaxed binding: orders.gift-wrap.price → ORDERS_GIFTWRAP_PRICE. */
export const envVarOf = (key: string): string => key.replace(/-/g, "").replace(/[.[\]]+/g, "_").replace(/_+$/, "").toUpperCase();
export const isSecret = (key: string): boolean => /(password|passwd|secret|token|api[-_.]?key|private[-_.]?key|credential)/i.test(key);
const kebab = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Flattens Spring YAML (maps, scalars, lists as key[i], several documents) into key → value; enough for config files. */
export function flattenYaml(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const doc of text.split(/^---\s*$/m)) {
    const stack: { indent: number; key: string }[] = [];
    const lists = new Map<string, number>();
    let block: number | null = null; // the indent of a block scalar's key: deeper lines belong to it
    for (const raw of doc.split("\n")) {
      if (!raw.trim() || raw.trim().startsWith("#")) continue;
      const indent = raw.length - raw.trimStart().length;
      if (block !== null) {
        if (indent > block) continue;
        block = null;
      }
      let line = raw.trim();
      while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
      // every stack entry holds its full dotted path
      const parent = stack.at(-1)?.key ?? "";
      if (line.startsWith("- ") || line === "-") {
        const n = lists.get(parent) ?? 0;
        lists.set(parent, n + 1);
        const item = `${parent}[${n}]`;
        line = line.slice(1).trim();
        stack.push({ indent, key: item });
        if (!line) continue;
        const kv = /^([\w.-]+):(?:\s+(.*))?$/.exec(line);
        if (!kv) {
          out.set(item, scalar(line));
          continue;
        }
        const k = `${item}.${kv[1]}`;
        if (kv[2] !== undefined && kv[2].trim() !== "") out.set(k, scalar(kv[2]));
        else stack.push({ indent: indent + 1, key: k });
        continue;
      }
      const kv = /^((?:"[^"]*"|'[^']*'|[^:#])+?):(?:\s+(.*))?$/.exec(line);
      if (!kv) continue;
      const key = kv[1]!.trim().replace(/^["']|["']$/g, "");
      const full = parent ? `${parent}.${key}` : key;
      const value = kv[2]?.replace(/\s+#.*$/, "").trim();
      if (value === undefined || value === "") stack.push({ indent, key: full });
      else if (value === "|" || value === ">" || /^[|>][-+]?$/.test(value)) {
        out.set(full, "…");
        block = indent;
      } else out.set(full, scalar(value));
    }
  }
  return out;
}

const scalar = (v: string): string => v.replace(/\s+#.*$/, "").trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");

export function flattenProperties(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const m = /^([^=:\s]+)\s*[=:]\s*(.*)$/.exec(line);
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

export interface ClassProperty {
  key: string;
  className: string;
  defaultValue?: string;
}

/** The settings a Java file declares: @ConfigurationProperties records and classes (their fields) and @Value placeholders. */
export function javaProperties(text: string): ClassProperty[] {
  const out: ClassProperty[] = [];
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const m of code.matchAll(/@ConfigurationProperties\s*\(\s*(?:(?:prefix|value)\s*=\s*)?"([^"]+)"[^)]*\)/g)) {
    const prefix = m[1]!;
    const rest = code.slice(m.index! + m[0].length);
    const rec = /^[\s\S]*?\brecord\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:implements[^{]*)?\{/.exec(rest);
    const cls = /^[\s\S]*?\bclass\s+(\w+)[^{]*\{/.exec(rest);
    if (rec && (!cls || rec.index <= cls.index)) {
      for (const param of splitTop(rec[2]!)) {
        const name = /(\w+)\s*$/.exec(param.trim())?.[1];
        if (!name) continue;
        const dflt = /@DefaultValue\s*\(\s*"([^"]*)"/.exec(param)?.[1];
        out.push({ key: `${prefix}.${kebab(name)}`, className: rec[1]!, ...(dflt !== undefined ? { defaultValue: dflt } : {}) });
      }
    } else if (cls) {
      const body = classBody(rest.slice(cls.index + cls[0].length));
      for (const f of body.matchAll(/^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:private|protected|public)?\s*(?!static\b)(?:final\s+)?[\w<>[\],.?\s]+?\s+(\w+)\s*(?:=\s*([^;]+))?;/gm)) {
        if (/\bstatic\b/.test(f[0])) continue; // a constant, not a setting
        out.push({ key: `${prefix}.${kebab(f[1]!)}`, className: cls[1]!, ...(f[2] ? { defaultValue: f[2].trim().replace(/^"(.*)"$/, "$1") } : {}) });
      }
    }
  }
  for (const m of code.matchAll(/@Value\s*\(\s*"\$\{([^}:]+)(?::([^}]*))?\}"\s*\)/g)) {
    out.push({ key: m[1]!.trim(), className: "@Value", ...(m[2] !== undefined ? { defaultValue: m[2] } : {}) });
  }
  return out;
}

/** The text between a class's braces, nested classes cut out (their fields are not this prefix's). */
function classBody(after: string): string {
  let depth = 1;
  let out = "";
  for (const ch of after) {
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) break;
      out += ";"; // a method or nested class ends here: its signature is not a field
      continue;
    }
    if (depth === 1) out += ch;
  }
  return out;
}

function splitTop(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "<" || ch === "(") depth++;
    if (ch === ">" || ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const CONFIG = /(^|\/)src\/main\/resources\/(application|bootstrap)[\w-]*\.(ya?ml|properties)$/;
const MIGRATION = /(^|\/)src\/main\/resources\/db\/|(^|\/)(liquibase|flyway)\//;

async function fileAt(cwd: string, rev: string, path: string): Promise<string | null> {
  return git(cwd, ["show", `${rev}:${path}`]);
}
const flatten = (path: string, text: string | null) => (text === null ? new Map<string, string>() : path.endsWith(".properties") ? flattenProperties(text) : flattenYaml(text));

/** Reads «Для раскатки» for the diff base..head of the project; environments are checked against their values. */
export async function deployNotes(projectDir: string, base: string, head: string, environments: DeployEnvironment[]): Promise<DeployNotes> {
  const status = (await git(projectDir, ["diff", "--name-status", "--no-renames", base, head])) ?? "";
  const changed = status.split("\n").filter(Boolean).map((l) => ({ status: l[0]!, path: l.slice(l.indexOf("\t") + 1) }));
  const byKey = new Map<string, PropertyNote>();
  const note = (key: string, source: string, change: PropertyNote["change"], defaultValue: string | undefined) => {
    const was = byKey.get(key);
    if (was) {
      if (was.defaultValue === undefined && defaultValue !== undefined) was.defaultValue = defaultValue;
      return;
    }
    byKey.set(key, { key, envVar: envVarOf(key), source, ...(defaultValue !== undefined ? { defaultValue } : {}), required: false, secret: isSecret(key), change, inEnv: {} });
  };
  // the base configuration as of head: a key with a value there has a default
  const headDefaults = new Map<string, string>();
  for (const f of ["src/main/resources/application.yml", "src/main/resources/application.yaml", "src/main/resources/application.properties"]) {
    for (const [k, v] of flatten(f, await fileAt(projectDir, head, f))) headDefaults.set(k, v);
  }
  const topics: DeployNotes["topics"] = [];
  const endpoints: DeployNotes["endpoints"] = [];
  const migrations: string[] = [];
  for (const c of changed) {
    if (c.status === "D") continue;
    if (MIGRATION.test(c.path) && c.status === "A" && !/master|changelog-master/.test(c.path)) migrations.push(c.path);
    if (CONFIG.test(c.path)) {
      const before = flatten(c.path, await fileAt(projectDir, base, c.path));
      const after = flatten(c.path, await fileAt(projectDir, head, c.path));
      for (const [k, v] of after) {
        if (before.get(k) === v) continue;
        const placeholder = /\$\{([^}:]+)(?::([^}]*))?\}/.exec(v);
        if (placeholder) {
          // key: ${ENV_VAR} — the variable is what the environment must give
          note(placeholder[1]!, c.path, before.has(k) ? "changed" : "added", placeholder[2]);
          byKey.get(placeholder[1]!)!.envVar = /^[A-Z0-9_]+$/.test(placeholder[1]!) ? placeholder[1]! : envVarOf(placeholder[1]!);
        } else note(k, c.path, before.has(k) ? "changed" : "added", isSecret(k) ? "•••" : v);
        if (/topic/i.test(k) && !placeholder) topics.push({ key: k, value: v });
        if (/(url|uri|host|endpoint|base-url)$/i.test(k) && !placeholder) endpoints.push({ key: k, value: v });
      }
    }
    if (c.path.endsWith(".java") && /(^|\/)src\/main\//.test(c.path)) {
      const before = new Set(javaProperties((await fileAt(projectDir, base, c.path)) ?? "").map((p) => p.key));
      for (const p of javaProperties((await fileAt(projectDir, head, c.path)) ?? "")) {
        if (before.has(p.key)) continue;
        note(p.key, `${c.path} (${p.className})`, "added", p.defaultValue ?? headDefaults.get(p.key));
      }
    }
  }
  const values = new Map<string, string | null>();
  for (const e of environments) {
    if (e.valuesFile && !values.has(e.valuesFile)) values.set(e.valuesFile, await readFile(join(projectDir, e.valuesFile), "utf8").catch(() => null));
  }
  const missing: DeployNotes["missing"] = [];
  for (const p of byKey.values()) {
    p.required = p.defaultValue === undefined && !headDefaults.has(p.key);
    for (const e of environments) {
      const text = e.valuesFile ? values.get(e.valuesFile) : undefined;
      const listed = (e.provided ?? []).some((x) => x === p.key || x === p.envVar);
      const inFile = typeof text === "string" && (text.includes(p.envVar) || text.includes(p.key) || keyInYaml(text, p.key));
      p.inEnv[e.name] = listed || inFile ? true : typeof text === "string" || (e.provided ?? []).length ? false : null;
      if (p.required && p.inEnv[e.name] === false) missing.push({ env: e.name, key: p.key, envVar: p.envVar });
    }
  }
  const properties = [...byKey.values()].sort((a, b) => Number(b.required) - Number(a.required) || a.key.localeCompare(b.key));
  return { base, head, filesChanged: changed.length, properties, migrations, topics, endpoints, missing };
}

/** A dotted key written as nested YAML in a values file (orders: gift-wrap: price: …), wherever the tree starts. */
function keyInYaml(text: string, key: string): boolean {
  const flat = flattenYaml(text);
  for (const k of flat.keys()) if (k === key || k.endsWith(`.${key}`)) return true;
  return false;
}
