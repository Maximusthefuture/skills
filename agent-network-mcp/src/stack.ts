import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

/**
 * What a project builds with, read from the files in its root when `ui` writes the project's first runners config: the
 * build commands the agents may run in the shell, the tasks' verifyCommand and the role instructions that fit.
 */
export interface ProjectStack {
  name: "maven" | "gradle" | "npm" | "yarn" | "pnpm";
  /** The file in the project's root that gave it away. */
  marker: string;
  /** Command prefixes the agents may run in the shell: Bash(<prefix>:*) for Claude Code, run_shell_command(<prefix>) for Qwen. */
  shell: string[];
  /** The command the lead runs on the merged result; absent when there is nothing to run (a package.json without scripts). */
  verifyCommand?: string;
  /** The folder of role instructions under examples/runner/instructions/ ("" = the Maven ones at its top). */
  instructions: "" | "gradle" | "npm";
}

const exists = (path: string) => access(path).then(() => true, () => false);

/** Scripts of package.json that check the whole project, the best first; "test" is the usual one. */
const NPM_SCRIPTS = ["verify", "check", "test", "build"];
/** What `npm init` puts into "test": it only fails. */
const NO_TEST = /no test specified/;

/** The project's stack, or null when its root has none of pom.xml, build.gradle(.kts), settings.gradle(.kts), package.json. */
export async function detectStack(project: string): Promise<ProjectStack | null> {
  const has = (file: string) => exists(join(project, file));
  // a JVM build wins over a package.json next to it (a frontend folder, tooling): the agents build the JVM part
  if (await has("pom.xml")) {
    const mvn = (await has("mvnw")) ? "./mvnw" : "mvn";
    return { name: "maven", marker: "pom.xml", shell: [mvn], verifyCommand: `${mvn} -q -B verify -Dsurefire.timeout=900`, instructions: "" };
  }
  for (const marker of ["build.gradle.kts", "build.gradle", "settings.gradle.kts", "settings.gradle"]) {
    if (!(await has(marker))) continue;
    const gradle = (await has("gradlew")) ? "./gradlew" : "gradle";
    // not -q: the build tool reads Gradle's summary by its BUILD SUCCESSFUL / > Task lines
    return { name: "gradle", marker, shell: [gradle], verifyCommand: `${gradle} check --console=plain`, instructions: "gradle" };
  }
  if (!(await has("package.json"))) return null;
  const pm = (await has("pnpm-lock.yaml")) ? "pnpm" : (await has("yarn.lock")) ? "yarn" : "npm";
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as { scripts?: unknown };
    if (pkg.scripts && typeof pkg.scripts === "object") scripts = pkg.scripts as Record<string, unknown>;
  } catch {
    // an unreadable package.json still says npm; there is just no script to verify with
  }
  const script = NPM_SCRIPTS.find((s) => typeof scripts[s] === "string" && !NO_TEST.test(scripts[s] as string));
  return {
    name: pm, marker: "package.json", shell: [`${pm} test`, `${pm} run`], instructions: "npm",
    ...(script ? { verifyCommand: script === "test" ? `${pm} test` : `${pm} run ${script}` } : {}),
  };
}

/** The template's Maven build permission, replaced by the stack's in a project's own config. */
const MAVEN_PERMISSIONS: Record<string, (prefix: string) => string> = {
  "Bash(./mvnw:*)": (p) => `Bash(${p}:*)`,
  "run_shell_command(./mvnw)": (p) => `run_shell_command(${p})`,
};

/** A command (CLI argv) with the template's ./mvnw permission replaced by one per shell prefix of the stack. */
export function withBuildPermissions(command: string[], stack: ProjectStack): string[] {
  return command.flatMap((arg) => (Object.hasOwn(MAVEN_PERMISSIONS, arg) ? stack.shell.map(MAVEN_PERMISSIONS[arg]!) : [arg]));
}

/** Whether an executable of this name is on PATH. */
export async function onPath(name: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  for (const dir of (env.PATH ?? "").split(delimiter).filter(Boolean)) {
    if (await access(join(dir, name), constants.X_OK).then(() => true, () => false)) return true;
  }
  return false;
}
