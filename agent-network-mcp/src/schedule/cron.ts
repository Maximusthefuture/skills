import { AppError } from "../errors.js";

/**
 * Standard 5-field cron in local time: minute hour day-of-month month day-of-week. Each field takes *, a number, a list
 * (1,15), a range (1-5) and a step (*\/15, 8-18/2); day-of-week 0-7 (0 and 7 are Sunday) or sun..sat; month 1-12 or
 * jan..dec. Shorthands: @hourly, @daily (@midnight), @weekly, @monthly, @yearly (@annually), @weekdays (Mon-Fri 9:00).
 * As in cron, when both day-of-month and day-of-week are restricted, either one matching is enough.
 */
export interface Cron {
  source: string;
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Both day fields restricted: OR instead of AND. */
  dayOr: boolean;
}

const SHORTHANDS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@weekdays": "0 9 * * 1-5",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function field(text: string, min: number, max: number, what: string, names: string[] = [], base = 0): Set<number> {
  const bad = (why: string): never => {
    throw new AppError("INVALID_INPUT", `cron ${what} "${text}": ${why}`);
  };
  const value = (v: string): number => {
    const i = names.indexOf(v.toLowerCase());
    if (i >= 0) return i + base;
    if (!/^\d+$/.test(v)) bad(`"${v}" is not a number${names.length ? ` or ${names[0]}..${names.at(-1)}` : ""}`);
    const n = Number(v);
    if (n < min || n > max) bad(`${n} is outside ${min}-${max}`);
    return n;
  };
  const out = new Set<number>();
  for (const part of text.split(",")) {
    if (!part) bad("empty list item");
    const [range, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) bad(`step "${stepText}" must be a whole number >= 1`);
    let from: number;
    let to: number;
    if (range === "*") [from, to] = [min, max];
    else if (range!.includes("-")) {
      const [a, b] = range!.split("-");
      [from, to] = [value(a!), value(b!)];
      if (from > to) bad(`range ${a}-${b} goes backwards`);
    } else {
      from = value(range!);
      to = stepText === undefined ? from : max;
    }
    for (let n = from; n <= to; n += step) out.add(n);
  }
  return out;
}

export function parseCron(source: string): Cron {
  const text = (SHORTHANDS[source.trim().toLowerCase()] ?? source).trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5) throw new AppError("INVALID_INPUT", `cron "${source}": 5 fields expected (minute hour day month weekday), e.g. "0 3 * * 1-5", or @daily/@hourly/@weekly`);
  const [mi, h, d, mo, wd] = parts as [string, string, string, string, string];
  const weekdays = field(wd, 0, 7, "weekday", DAYS);
  if (weekdays.has(7)) weekdays.add(0);
  weekdays.delete(7);
  return {
    source,
    minutes: field(mi, 0, 59, "minute"),
    hours: field(h, 0, 23, "hour"),
    days: field(d, 1, 31, "day"),
    months: field(mo, 1, 12, "month", MONTHS, 1),
    weekdays,
    dayOr: d !== "*" && wd !== "*",
  };
}

const matchesDay = (c: Cron, t: Date): boolean => {
  const dom = c.days.has(t.getDate());
  const dow = c.weekdays.has(t.getDay());
  return c.dayOr ? dom || dow : dom && dow;
};

/** The first moment strictly after `after` (whole minutes, local time) the cron fires; null if it never does within 5 years. */
export function nextRun(c: Cron, after: Date): Date | null {
  const t = new Date(after.getTime());
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  const limit = after.getTime() + 5 * 366 * 24 * 3600_000;
  while (t.getTime() <= limit) {
    if (!c.months.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!matchesDay(c, t)) {
      t.setDate(t.getDate() + 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!c.hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!c.minutes.has(t.getMinutes())) {
      t.setMinutes(t.getMinutes() + 1, 0, 0);
      continue;
    }
    return t;
  }
  return null;
}
