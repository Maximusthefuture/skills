import { isAbsolute, relative, resolve } from "node:path";

/**
 * A change-writing task (task create --propose) changes nothing but its change folder: a haiku lead that "implemented"
 * the change wrote code and deleted failing tests with rm. The PreToolUse hooks refuse such writes as they happen:
 * pre-write for the file tools (Write, Edit, write_file, replace…), pre-bash / pre-shell for shell commands that write.
 * Paths outside the agent's folder (a scratch file in /tmp) are not the project's and stay allowed.
 */

export interface ChangeScope {
  change: string;
  /** Relative to the agent's folder: openspec/changes/<change>. */
  dir: string;
}

/** The project files among the paths that are outside the change folder (empty: the write is fine). */
export function outsideChange(paths: string[], cwd: string, scope: ChangeScope): string[] {
  const root = resolve(cwd);
  const allowed = resolve(root, scope.dir);
  return paths.filter((p) => {
    if (!p || p === "/dev/null") return false;
    const abs = resolve(root, p);
    const inProject = abs === root || !relative(root, abs).startsWith("..") && !isAbsolute(relative(root, abs));
    if (!inProject) return false;
    const inChange = abs === allowed || (!relative(allowed, abs).startsWith("..") && !isAbsolute(relative(allowed, abs)));
    return !inChange;
  });
}

const unquote = (s: string): string => s.replace(/^(['"])(.*)\1$/, "$2");

/** The files a shell command would write, as far as a plain reading can tell (no variables, no subshells). */
export function shellWrites(command: string): { paths: string[]; whole?: string } {
  const paths: string[] = [];
  // redirections write their target
  const bare = command.replace(/'[^']*'|"[^"]*"/g, "''"); // a ">" inside quotes (a commit message) redirects nothing
  for (const m of bare.matchAll(/(?:^|[^0-9&<>])>{1,2}\s*([^\s;&|<>]+)/g)) paths.push(unquote(m[1]!));
  for (const part of command.split(/&&|\|\||;|\|/)) {
    const words = (part.trim().match(/'[^']*'|"[^"]*"|\S+/g) ?? []).map(unquote).filter((w) => !/^>{1,2}/.test(w));
    while (words.length && /^[A-Z_]+=/.test(words[0]!)) words.shift(); // VAR=value cmd
    const [cmd, ...rest] = words;
    if (!cmd) continue;
    const args = rest.filter((a) => a && !a.startsWith("-")); // "" is sed -i's backup suffix on macOS
    const name = cmd.split("/").pop()!;
    if (["rm", "rmdir", "touch", "mkdir", "truncate", "chmod", "unlink", "tee"].includes(name)) paths.push(...args);
    else if (["mv", "cp", "ln", "install", "rsync"].includes(name)) {
      if (name === "mv") paths.push(...args); // a move changes its source too
      else if (args.length) paths.push(args.at(-1)!);
    } else if ((name === "sed" || name === "perl") && rest.some((a) => /^-i/.test(a) || a === "--in-place")) paths.push(...args.slice(1));
    else if (name === "git") {
      const sub = args[0];
      if (["checkout", "restore", "rm", "mv", "clean", "stash", "apply", "am", "cherry-pick", "revert"].includes(sub ?? "")) {
        const files = rest.slice(rest.indexOf(sub!) + 1).filter((a) => !a.startsWith("-"));
        if (sub === "checkout" && !rest.includes("--") && files.length <= 1) return { paths, whole: `git ${sub} ${files.join(" ")}`.trim() }; // a branch switch
        if (!files.length || ["clean", "stash", "am", "cherry-pick", "revert", "apply"].includes(sub!)) return { paths, whole: `git ${sub}` };
        paths.push(...files);
      } else if (sub === "reset" && rest.includes("--hard")) return { paths, whole: "git reset --hard" };
    }
  }
  return { paths };
}

export function changeOnlyReason(scope: ChangeScope, what: string): string {
  return (
    `This task writes the OpenSpec change ${scope.dir}/ and nothing else: ${what}. Change no code, tests, build files or other files ` +
    `(no rm, no git checkout/restore, no edits outside ${scope.dir}/): describe the code in design.md and tasks.md instead — the task that implements the change writes it. ` +
    `If something outside the change really must change, tell the operator with send_message({to: "operator"}).`
  );
}
