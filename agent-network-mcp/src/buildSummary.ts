/**
 * The short answer of the build tool: the outcome, the test totals and what failed, instead of the whole build output
 * (Maven test runs print thousands of lines that would stay in the agent's context for the rest of the session).
 * Maven and Gradle are read by their markers; anything else (npm, vitest, jest, make) by lines that mention a failure.
 */

export interface TestTotals {
  total: number;
  failed: number;
}

export interface BuildSummary {
  ok: boolean;
  /** The text for the agent: at most MAX_LINES lines, MAX_CHARS characters. */
  text: string;
  tests?: TestTotals;
}

const MAX_LINES = 60;
const MAX_CHARS = 4000;
const MAX_LINE = 300;
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

const clip = (line: string): string => (line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line);

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** Totals of a test run, from the summary line of Maven, Gradle, vitest or jest; null when there is none. */
export function testTotals(lines: string[]): TestTotals | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!;
    // Maven: the aggregate "Tests run: 180, Failures: 1, Errors: 2, Skipped: 0" (per-class lines also carry "Time elapsed")
    let m = /Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: \d+\s*$/.exec(l);
    if (m) return { total: +m[1]!, failed: +m[2]! + +m[3]! };
    m = /(\d+) tests completed, (\d+) failed/.exec(l); // Gradle
    if (m) return { total: +m[1]!, failed: +m[2]! };
    m = /^\s*Tests\s{2,}(.*)\((\d+)\)\s*$/.exec(l); // vitest: "Tests  1 failed | 388 passed (389)"
    if (m) return { total: +m[2]!, failed: +(/(\d+) failed/.exec(m[1]!)?.[1] ?? 0) };
    m = /^\s*Tests:\s+(.*?)(\d+) total/.exec(l); // jest: "Tests:  1 failed, 5 passed, 6 total"
    if (m) return { total: +m[2]!, failed: +(/(\d+) failed/.exec(m[1]!)?.[1] ?? 0) };
  }
  // node --test (TAP): "# tests 5" ... "# fail 1"
  const tap = (k: string) => lines.map((l) => new RegExp(`^# ${k} (\\d+)\\s*$`).exec(l)?.[1]).filter(Boolean).at(-1);
  if (tap("tests") !== undefined) return { total: +tap("tests")!, failed: +(tap("fail") ?? 0) };
  // Maven without the aggregate line (-q prints only failing classes): nothing reliable to sum
  return null;
}

function mavenLines(lines: string[]): string[] {
  const out: string[] = [];
  let block = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\[ERROR\] (Failures|Errors|Tests in error|Failed tests):\s*$/.test(l)) {
      block = true;
      out.push(l);
      continue;
    }
    if (block) {
      if (/^\[ERROR\] {2,}\S/.test(l) || /^\[ERROR\] {3,}Run \d+:/.test(l)) {
        out.push(l);
        continue;
      }
      block = false;
    }
    if (/^\[ERROR\] .*\.(java|kt|groovy|scala):\[\d+,\d+\]/.test(l)) {
      out.push(l);
      for (const next of lines.slice(i + 1, i + 3)) if (/^\[ERROR\]\s+(symbol|location|required|found|reason):/.test(next)) out.push(next);
      continue;
    }
    if (/^\[ERROR\] Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+.*<<< (FAILURE|ERROR)!/.test(l)) out.push(l);
    else if (/Tests run: \d+, Failures: \d+, Errors: \d+, Skipped: \d+\s*$/.test(l)) out.push(l);
    else if (/^\[(INFO|ERROR)\] BUILD (SUCCESS|FAILURE)/.test(l)) out.push(l);
    else if (/^\[ERROR\] Failed to execute goal/.test(l)) out.push(l);
    else if (/There (was|were) (a )?timeout|The forked VM terminated|ExecutionException The forked VM/.test(l)) out.push(l);
    else if (/^\[ERROR\] COMPILATION ERROR/.test(l)) out.push(l);
  }
  return out;
}

function gradleLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/ > .* FAILED\s*$/.test(l)) {
      out.push(l);
      const cause = lines[i + 1];
      if (cause && /^\s{4,}\S/.test(cause)) out.push(cause);
    } else if (/^(e|w): .*\.(kt|kts)(:\d+)?/.test(l) && l.startsWith("e:")) out.push(l);
    else if (/\.java:\d+: error:/.test(l)) out.push(l);
    else if (/\d+ tests completed, \d+ failed/.test(l)) out.push(l);
    else if (/^BUILD (SUCCESSFUL|FAILED)/.test(l)) out.push(l);
    else if (/^\* What went wrong:/.test(l)) {
      out.push(l);
      if (lines[i + 1]) out.push(lines[i + 1]!);
    }
  }
  return out;
}

const FAILURE = /\b(fail|failed|failing|failure|failures|error|errors|exception)\b|[a-z](Error|Exception)\b|✗|×|✖/i;
const ZERO = /\b0 (failed|failures|errors)\b|Failures: 0, Errors: 0/i;
/** A failing test's header: the next lines carry the reason (assertion, location). */
const FAILED_TEST = /^\s*(FAIL|✗|×|✖)\s|\bFAILED\b/;

function genericLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!FAILURE.test(l) || ZERO.test(l)) continue;
    out.push(l);
    if (FAILED_TEST.test(l)) out.push(...lines.slice(i + 1, i + 6).filter((n) => n.trim()).slice(0, 2));
  }
  return out;
}

/** A line with the totals of a run (vitest, jest, node --test, pytest, go test...). */
const TOTALS = /\b(tests?|pass(ed|es)?|fail(ed|ures?)?|ok|total|success(ful)?|suites?|duration|built|done|errors?)\b|✓|✔/i;
/** An application's own log line (a test's logging), e.g. "2026-10-11 20:15:05 DEBUG [main] o.s.Foo - ...". */
const APP_LOG = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR)\b.*\s-\s|^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/;

/** Maven's advice lines after a failure: the same every time, never the cause. */
const MAVEN_BOILERPLATE = /^\[ERROR\]\s*(-> \[Help \d+\]|\[Help \d+\] http|To see the full stack trace|Re-run Maven|For more information about the errors|See dump files|$)/;

function uniqueCapped(lines: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const t = l.trimEnd();
    if (!t.trim() || seen.has(t)) continue;
    seen.add(t);
    out.push(clip(t));
    if (out.length >= max) break;
  }
  return out;
}

/** The answer of the build tool for one finished run. */
export function summarizeBuild(output: string, exitCode: number | null, durationMs: number, opts: { logPath?: string; timedOut?: boolean } = {}): BuildSummary {
  const lines = output.replace(ANSI, "").split(/\r?\n/);
  const ok = exitCode === 0 && !opts.timedOut;
  const tests = testTotals(lines) ?? undefined;
  const status = opts.timedOut ? `TIMEOUT (stopped after ${formatDuration(durationMs)})` : ok ? "PASS" : `FAIL (exit ${exitCode ?? "signal"})`;
  const head = [
    `${status} in ${formatDuration(durationMs)}${tests ? ` · tests: ${tests.total}, failed: ${tests.failed}` : ""}`,
    ...(opts.logPath ? [`full log: ${opts.logPath} (grep it or read a part for details)`] : []),
  ];
  const maven = lines.some((l) => /^\[(INFO|ERROR|WARNING)\] /.test(l));
  const gradle = !maven && lines.some((l) => /^BUILD (SUCCESSFUL|FAILED)|^> Task :/.test(l));
  const marked = maven ? mavenLines(lines) : gradle ? gradleLines(lines) : [];
  let body: string[];
  if (ok) {
    // a green run: the markers say enough; for other tools the last lines carry the totals
    // (mvn -q prints no totals: its last lines are the tests' own logging, which says nothing about the outcome)
    body = marked.length ? uniqueCapped(marked.filter((l) => !/^\[ERROR\]/.test(l)), 10) : uniqueCapped(lines.slice(-8).filter((l) => TOTALS.test(l) && !APP_LOG.test(l)), 6);
  } else {
    const found = uniqueCapped(marked.length ? marked : genericLines(lines), 40);
    // the markers of Maven/Gradle say what failed; their last lines are advice or test output. Elsewhere the tail helps.
    const tail = marked.length
      ? uniqueCapped(lines.filter((l) => /surefire-reports|failsafe-reports|reports\/tests/.test(l)), 1)
      : uniqueCapped(lines.filter((l) => l.trim() && !MAVEN_BOILERPLATE.test(l)).slice(-15), 15).filter((l) => !found.includes(l));
    body = [...found, ...(tail.length ? ["--- last lines:", ...tail] : [])];
  }
  const all = [...head, ...body].slice(0, MAX_LINES);
  let text = all.join("\n");
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS)}\n… (cut; the rest is in the log)`;
  return { ok, text, ...(tests ? { tests } : {}) };
}
