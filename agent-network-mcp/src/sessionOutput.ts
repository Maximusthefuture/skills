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

export class SessionOutput {
  private partial = "";
  private raw = "";
  private found: SessionResult | undefined;
  private model: string | undefined;

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

  result(): SessionResult | undefined {
    return this.found ? { ...this.found, ...(this.model && !this.found.model ? { model: this.model } : {}) } : undefined;
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
          return `[session] model ${ev.model}\n`;
        }
        return null;
      case "assistant":
        return assistantText(ev.message);
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
        };
        const text = typeof ev.result === "string" ? ev.result.trim() : "";
        const tokens = usage ? ` · tokens ${usage.total} (in ${usage.input}, out ${usage.output})` : "";
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
