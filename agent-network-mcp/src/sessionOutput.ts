/**
 * Reads what an agent CLI prints in a headless session. With `--output-format stream-json` (Claude Code) or
 * `-o stream-json` / `-o json` (Qwen Code) the output is JSON events; this turns them into a readable log (the agent's
 * text and tool calls) and keeps the final `result` event: tokens, cost, turns. Plain text passes through unchanged.
 */

export interface TokenUsage {
  /** All input tokens, cached ones included. */
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

export interface SessionResult {
  usage?: TokenUsage;
  costUsd?: number;
  numTurns?: number;
  /** The CLI's own measure of time spent waiting for the model. */
  apiMs?: number;
  isError?: boolean;
  model?: string;
  /** The CLI stopped the session at its turn limit (Claude Code: result subtype error_max_turns). */
  stopReason?: "max_turns";
  /** The session's final text (the result event), shortened. */
  text?: string;
  /** No result event (the session was stopped, e.g. at the context limit): usage is the sum of its messages so far. */
  partial?: true;
}

/**
 * Claude counts cache reads/creation apart from input_tokens; Qwen includes them and reports total_tokens.
 * Both come out as: input = everything the model read, total = input + output.
 */
export function normalizeUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const n = (k: string): number => (typeof u[k] === "number" ? (u[k] as number) : 0);
  if (!["input_tokens", "output_tokens", "total_tokens"].some((k) => typeof u[k] === "number")) return undefined;
  const cacheRead = n("cache_read_input_tokens");
  const cacheCreation = n("cache_creation_input_tokens");
  const hasTotal = typeof u.total_tokens === "number";
  const input = hasTotal ? n("input_tokens") : n("input_tokens") + cacheRead + cacheCreation;
  const output = n("output_tokens");
  return { input, output, cacheRead, cacheCreation, total: hasTotal ? n("total_tokens") : input + output };
}

const MAX_RAW = 4 * 1024 * 1024;
const MAX_DETAIL = 20_000;

/**
 * One thing an agent session did, for the activity feed on the page: what it thought and said, which tool it called
 * with which arguments, what came back (and whether it was an error), how the session ended.
 */
export type ActivityKind = "session" | "thinking" | "text" | "tool_use" | "tool_result" | "result" | "runner" | "stderr";

export interface ActivityItem {
  kind: ActivityKind;
  /** It happened inside a subagent the session started (Claude Code: parent_tool_use_id), not in the session itself. */
  sub?: true;
  /** tool_use / tool_result: the tool's name. */
  tool?: string;
  /** tool_use: the skill the call loads (the Skill tool, or a read of a skill's SKILL.md). */
  skill?: string;
  /** tool_result: the tool reported an error (a refused command, a failing call). */
  isError?: boolean;
  /** tool_result: time since its tool_use. */
  durationMs?: number;
  /** One line for the feed. */
  summary: string;
  /** The whole thing (arguments as JSON, the full result text), shortened. */
  detail?: string;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const firstLine = (s: string) => s.trim().split("\n").find((l) => l.trim())?.trim() ?? "";
/** A JSON result (MCP tools) on one line instead of its first line, which would be just "{". */
const resultSummary = (s: string): string => {
  const t = s.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.stringify(JSON.parse(t));
    } catch {
      // not JSON after all
    }
  }
  return firstLine(t);
};

/** A long absolute path shown by its last segments. */
function shortPath(p: unknown): string {
  const s = String(p ?? "");
  const parts = s.split("/");
  return s.length > 70 && parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : s;
}

/**
 * The skill a tool call loads, if any: Claude Code's Skill tool ({skill: "java-tdd"} or "plugin:skill"), or reading a
 * skill's SKILL.md (CLIs without a Skill tool, e.g. Qwen, read the file): the folder's name.
 */
export function skillOf(name: string, input: unknown): string | undefined {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const n = name.toLowerCase();
  if (n === "skill" && typeof (i.skill ?? i.command ?? i.name) === "string") return String(i.skill ?? i.command ?? i.name).trim().replace(/^\//, "") || undefined;
  if (n === "read" || n === "read_file" || n === "read_many_files") {
    const path = String(i.file_path ?? i.absolute_path ?? i.path ?? "");
    const m = /([^/\\]+)[/\\]SKILL\.md$/i.exec(path);
    return m?.[1];
  }
  return undefined;
}

/** The one line that says what a tool call does: the command, the file, the pattern; MCP tools by their arguments. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const n = name.toLowerCase();
  if (n === "bash" || n === "run_shell_command") return cut(String(i.command ?? ""), 300);
  if (["read", "write", "edit", "multiedit", "read_file", "write_file", "replace", "edit_file", "notebookedit"].includes(n)) return shortPath(i.file_path ?? i.absolute_path ?? i.path ?? i.notebook_path);
  if (n === "glob") return String(i.pattern ?? "");
  if (n === "agent" || n === "task") return cut(`${String(i.subagent_type ?? "general-purpose")}: ${String(i.description ?? i.prompt ?? "")}`, 300); // a subagent: which one, what for
  if (n === "grep" || n === "search_file_content") return `${String(i.pattern ?? "")}${i.path ? ` in ${shortPath(i.path)}` : ""}`;
  const json = JSON.stringify(i);
  return cut(json === "{}" ? "" : json, 300);
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : "")).join("\n");
  return content === undefined ? "" : JSON.stringify(content);
}

export class SessionOutput {
  private partial = "";
  private raw = "";
  private found: SessionResult | undefined;
  private readonly usageByMessage = new Map<string, TokenUsage>();
  private model: string | undefined;
  private session: string | undefined;
  /** tool_use id -> its tool and when it was called, to name and time the result. */
  private calls = new Map<string, { tool: string; at: number }>();

  /** onEvent receives the session's activity (see ActivityItem) as it comes. */
  constructor(
    private readonly onEvent?: (e: ActivityItem) => void,
    private readonly now: () => number = Date.now,
    /** The size of the context the model just read (input + cache read + cache write of a main-session turn). */
    private readonly onContext?: (tokens: number) => void,
  ) {}

  private emit(e: ActivityItem): void {
    try {
      this.onEvent?.(e);
    } catch {
      // a broken listener must not break the session's log
    }
  }

  /** Feed a stdout chunk; returns the readable text to show for it (possibly empty). */
  feed(chunk: string): string {
    if (this.raw.length < MAX_RAW) this.raw += chunk;
    const lines = (this.partial + chunk).split("\n");
    this.partial = lines.pop() ?? "";
    return lines.map((l) => this.line(l)).filter((t) => t !== null).join("");
  }

  /** The rest of the output; also tries the whole output as one JSON document (pretty-printed `-o json`). */
  end(): string {
    const rest = this.partial ? this.line(this.partial) ?? "" : "";
    this.partial = "";
    if (!this.found) {
      try {
        this.event(JSON.parse(this.raw));
      } catch {
        // not one JSON document: plain text output, nothing to count
      }
    }
    return rest;
  }

  /** The CLI's own id of the session (stream-json init): Claude Code keeps its transcript under that name. */
  sessionId(): string | undefined {
    return this.session;
  }

  result(): SessionResult | undefined {
    if (this.found) return { ...this.found, ...(this.model && !this.found.model ? { model: this.model } : {}) };
    // stopped before its result event (the runner ends a session at the context limit): what its messages used so far
    const usage = this.partialUsage();
    return usage ? { usage, partial: true, ...(this.model ? { model: this.model } : {}) } : undefined;
  }

  /** Tokens of every model call so far (the session's and its subagents'), each message once. */
  partialUsage(): TokenUsage | undefined {
    if (!this.usageByMessage.size) return undefined;
    const sum: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
    for (const u of this.usageByMessage.values()) for (const k of Object.keys(sum) as (keyof TokenUsage)[]) sum[k] += u[k];
    return sum;
  }

  private line(line: string): string | null {
    const t = line.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try {
        return this.event(JSON.parse(t));
      } catch {
        // not JSON after all
      }
    }
    return `${line}\n`;
  }

  private assistantActivity(message: unknown, sub = false): void {
    const emit = (e: ActivityItem) => this.emit(sub ? { ...e, sub: true } : e);
    const content = (message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      const b = block as { type?: string; text?: string; thinking?: string; name?: string; id?: string; input?: unknown };
      if (b.type === "text" && b.text?.trim()) emit({ kind: "text", summary: cut(firstLine(b.text), 300), ...(b.text.trim().length > 300 || b.text.includes("\n") ? { detail: cut(b.text.trim(), MAX_DETAIL) } : {}) });
      else if (b.type === "thinking" && b.thinking?.trim()) emit({ kind: "thinking", summary: cut(firstLine(b.thinking), 300), detail: cut(b.thinking.trim(), MAX_DETAIL) });
      else if (b.type === "tool_use" && b.name) {
        if (b.id) this.calls.set(b.id, { tool: b.name, at: this.now() });
        const skill = skillOf(b.name, b.input);
        emit({ kind: "tool_use", tool: b.name, ...(skill ? { skill } : {}), summary: toolSummary(b.name, b.input), detail: cut(JSON.stringify(b.input ?? {}, null, 2), MAX_DETAIL) });
      }
    }
  }

  /** What came back from the tools: a "user" event with tool_result blocks. */
  private toolResults(message: unknown, sub = false): void {
    const content = (message as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      const b = block as { type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown };
      if (b.type !== "tool_result") continue;
      const call = b.tool_use_id ? this.calls.get(b.tool_use_id) : undefined;
      if (b.tool_use_id) this.calls.delete(b.tool_use_id);
      const text = resultText(b.content);
      this.emit({
        ...(sub ? { sub: true as const } : {}),
        kind: "tool_result",
        ...(call ? { tool: call.tool, durationMs: this.now() - call.at } : {}),
        ...(b.is_error ? { isError: true } : {}),
        summary: cut(resultSummary(text) || (b.is_error ? "error" : "(empty)"), 300),
        ...(text.trim() ? { detail: cut(text, MAX_DETAIL) } : {}),
      });
    }
  }

  /** Returns the text to show, or null to hide the event. */
  private event(e: unknown): string | null {
    if (Array.isArray(e)) {
      const shown = e.map((x) => this.event(x)).filter((x) => x !== null);
      return shown.length ? shown.join("") : null;
    }
    if (!e || typeof e !== "object") return null;
    const ev = e as Record<string, unknown>;
    switch (ev.type) {
      case "system":
        if (ev.subtype === "init" && typeof ev.model === "string") {
          this.model = ev.model;
          if (typeof ev.session_id === "string") this.session = ev.session_id;
          const tools = Array.isArray(ev.tools) ? ev.tools.length : undefined;
          this.emit({ kind: "session", summary: `model ${ev.model}${tools !== undefined ? ` · ${tools} tools` : ""}`, detail: cut(JSON.stringify(ev, null, 2), MAX_DETAIL) });
          return `[session] model ${ev.model}\n`;
        }
        return null;
      case "assistant": {
        this.assistantActivity(ev.message, typeof ev.parent_tool_use_id === "string");
        // every content block comes as its own event with the message's usage: count each message once
        const m = ev.message as { id?: string; usage?: unknown } | undefined;
        const mu = normalizeUsage(m?.usage);
        if (mu) this.usageByMessage.set(m?.id ?? `n${this.usageByMessage.size}`, mu);
        // the session's own turns (not a subagent's): how big its context has grown
        const u = (ev.message as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined)?.usage;
        if (u && typeof ev.parent_tool_use_id !== "string") {
          try {
            this.onContext?.((u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
          } catch {
            /* a listener's failure is not the session's */
          }
        }
        return typeof ev.parent_tool_use_id === "string" ? null : assistantText(ev.message); // the log shows the session itself; the feed shows both
      }
      case "user":
        this.toolResults(ev.message, typeof ev.parent_tool_use_id === "string");
        return null;
      case "result": {
        const usage = normalizeUsage(ev.usage);
        const models = ev.modelUsage && typeof ev.modelUsage === "object" ? Object.keys(ev.modelUsage) : [];
        this.found = {
          ...(usage ? { usage } : {}),
          ...(typeof ev.total_cost_usd === "number" ? { costUsd: ev.total_cost_usd } : {}),
          ...(typeof ev.num_turns === "number" ? { numTurns: ev.num_turns } : {}),
          ...(typeof ev.duration_api_ms === "number" ? { apiMs: ev.duration_api_ms } : {}),
          ...(typeof ev.is_error === "boolean" ? { isError: ev.is_error } : {}),
          ...(models.length ? { model: models.join(", ") } : {}),
          ...(ev.subtype === "error_max_turns" ? { stopReason: "max_turns" as const } : {}),
          // up to 20 KB: the plan critic answers with a JSON list of risks several KB long
          ...(typeof ev.result === "string" && ev.result.trim() ? { text: ev.result.trim().slice(0, 20_000) } : {}),
        };
        const text = typeof ev.result === "string" ? ev.result.trim() : "";
        const tokens = usage ? ` · tokens ${usage.total} (in ${usage.input}, out ${usage.output})` : "";
        const parts = [
          typeof ev.num_turns === "number" ? `${ev.num_turns} turns` : "",
          usage ? `${usage.total} tokens` : "",
          typeof ev.total_cost_usd === "number" ? `$${ev.total_cost_usd.toFixed(2)}` : "",
          ev.subtype === "error_max_turns" ? "turn limit" : ev.is_error === true ? "error" : "",
        ].filter(Boolean);
        this.emit({ kind: "result", ...(ev.is_error === true ? { isError: true } : {}), summary: `${parts.join(" · ")}${text ? ` — ${cut(firstLine(text), 200)}` : ""}`, ...(text ? { detail: cut(text, MAX_DETAIL) } : {}) });
        return `[result] ${text.length > 600 ? `${text.slice(0, 600)}…` : text}${tokens}\n`;
      }
      default:
        return null; // user/tool results, partial stream events, rate limits: noise in a log
    }
  }
}

function assistantText(message: unknown): string | null {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  const out: string[] = [];
  for (const block of content) {
    const b = block as { type?: string; text?: string; name?: string; input?: unknown };
    if (b.type === "text" && b.text?.trim()) out.push(b.text.trim());
    else if (b.type === "tool_use" && b.name) {
      const args = JSON.stringify(b.input ?? {});
      out.push(`→ ${b.name}(${args.length > 160 ? `${args.slice(0, 160)}…` : args})`);
    }
  }
  return out.length ? `${out.join("\n")}\n` : null;
}
