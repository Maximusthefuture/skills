import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, realpath, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppError } from "../errors.js";
import type { ActivityItem } from "../sessionOutput.js";

/**
 * One supervisor session in full, for looking back at what it saw, did and why:
 * <network>/supervisor/sessions/session-NNN.jsonl. The first line is "start" (the prompt and the incidents), then one
 * "event" per tool call, result, text or thought, and "end" (exit, turns, cost, the CLI's session id and transcript).
 * Written as the session runs, so a session that is cut off still leaves what it did.
 */
export type SessionLogLine =
  | { type: "start"; at: string; session: string; cli: string; model?: string; incidents: unknown[]; prompt: string }
  | ({ type: "event"; at: string } & ActivityItem)
  | { type: "end"; at: string; exitCode: number; numTurns?: number; usd?: number; estimated?: boolean; cliSessionId?: string; transcript?: string; text?: string };

const DIR = ["supervisor", "sessions"];
const NAME = /^session-(\d+)\.jsonl$/;

export class SessionLog {
  private chain: Promise<void> = Promise.resolve();

  private constructor(
    private readonly file: FileHandle,
    /** session-NNN */
    readonly id: string,
    /** Its path inside the network folder. */
    readonly path: string,
  ) {}

  /** The next session-NNN.jsonl; two supervisors never get the same number. */
  static async create(networkDir: string): Promise<SessionLog> {
    const dir = join(networkDir, ...DIR);
    await mkdir(dir, { recursive: true });
    let seq = Math.max(0, ...(await sessionNumbers(networkDir))) + 1;
    for (;;) {
      const id = `session-${String(seq).padStart(3, "0")}`;
      try {
        const file = await open(join(dir, `${id}.jsonl`), "wx");
        return new SessionLog(file, id, [...DIR, `${id}.jsonl`].join("/"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        seq += 1;
      }
    }
  }

  /** Appends one line; lines keep their order. A failed write is dropped: the log never stops the session. */
  write(line: SessionLogLine): void {
    this.chain = this.chain.then(() => this.file.appendFile(`${JSON.stringify(line)}\n`)).catch(() => undefined);
  }

  async close(): Promise<void> {
    await this.chain;
    await this.file.close().catch(() => undefined);
  }
}

async function sessionNumbers(networkDir: string): Promise<number[]> {
  const names = await readdir(join(networkDir, ...DIR)).catch(() => [] as string[]);
  return names.map((n) => NAME.exec(n)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
}

/** The supervisor's sessions, oldest first: their number and file. */
export async function listSessionLogs(networkDir: string): Promise<{ n: number; id: string; file: string }[]> {
  return (await sessionNumbers(networkDir))
    .sort((a, b) => a - b)
    .map((n) => {
      const id = `session-${String(n).padStart(3, "0")}`;
      return { n, id, file: join(networkDir, ...DIR, `${id}.jsonl`) };
    });
}

/** One session's lines; `which` is its number, "session-NNN" or "latest". */
export async function readSessionLog(networkDir: string, which: string): Promise<{ id: string; file: string; lines: SessionLogLine[] }> {
  const all = await listSessionLogs(networkDir);
  const wanted = which === "latest" ? all.at(-1) : all.find((s) => s.id === which || String(s.n) === which.replace(/^0+(?=\d)/, ""));
  if (!wanted) throw new AppError("INVALID_INPUT", all.length ? `No supervisor session ${which} (there are ${all[0]!.n}..${all.at(-1)!.n})` : "The supervisor has not run a session yet");
  const text = await readFile(wanted.file, "utf8");
  const lines: SessionLogLine[] = [];
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    try {
      lines.push(JSON.parse(l) as SessionLogLine);
    } catch {
      // a line cut off by a crash
    }
  }
  return { id: wanted.id, file: wanted.file, lines };
}

/** Where Claude Code keeps the transcript of a session it ran in `cwd`, if that file is there. */
export async function claudeTranscript(cwd: string, sessionId: string, home = homedir()): Promise<string | undefined> {
  const dirs = new Set([cwd, await realpath(cwd).catch(() => cwd)]);
  for (const d of dirs) {
    const file = join(home, ".claude", "projects", d.replace(/[^A-Za-z0-9]/g, "-"), `${sessionId}.jsonl`);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/** A session's lines as text for a terminal: one line per event; `full` adds the whole call or result. */
export function formatSessionLog(lines: SessionLogLine[], full = false): string {
  const out: string[] = [];
  const time = (iso: string) => iso.slice(11, 19);
  const indent = (s: string) => s.split("\n").map((l) => `           ${l}`).join("\n");
  for (const l of lines) {
    if (l.type === "start") {
      out.push(`${l.at.slice(0, 10)} ${time(l.at)} start ${l.session} · ${l.cli}${l.model ? ` (${l.model})` : ""} · ${l.incidents.length} incident(s)`);
      for (const i of l.incidents as { kind?: string; summary?: string }[]) out.push(indent(`- ${i.kind ?? "?"}: ${i.summary ?? ""}`));
      if (full) out.push(indent(`prompt:\n${l.prompt}`));
    } else if (l.type === "event") {
      if (l.kind === "result") continue; // the same text comes with "end"
      const mark = l.kind === "tool_result" ? (l.isError ? " ✗" : " ✓") : "";
      const took = l.durationMs !== undefined ? ` ${(l.durationMs / 1000).toFixed(1)}s` : "";
      const text = l.kind === "text" || l.kind === "thinking" ? l.detail ?? l.summary : l.summary;
      out.push(`${time(l.at)}   ${l.kind}${l.tool ? ` ${l.tool}` : ""}${mark}${took}${!text ? "" : text.includes("\n") ? `:\n${indent(text)}` : `: ${text}`}`);
      if (full && l.detail && l.kind !== "text" && l.kind !== "thinking") out.push(indent(l.detail));
    } else {
      const cost = l.usd !== undefined ? ` · $${l.usd.toFixed(2)}${l.estimated ? " (by your prices)" : ""}` : "";
      out.push(`${time(l.at)} end exit ${l.exitCode}${l.numTurns !== undefined ? ` · ${l.numTurns} turns` : ""}${cost}`);
      if (l.text) out.push(indent(l.text));
      if (l.transcript) out.push(indent(`CLI transcript: ${l.transcript}`));
    }
  }
  return out.join("\n");
}
