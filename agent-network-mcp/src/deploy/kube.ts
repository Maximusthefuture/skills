import { execFile } from "node:child_process";
import type { DeployNotes } from "./notes.js";

/**
 * Did the service roll out? Read-only kubectl: `get deployment / rs / pods / events -o json` and `logs`, with the
 * context and namespace from the settings and nothing else taken from outside (the settings are checked: no leading
 * "-"). The image tag says nothing about the build here, so "our" rollout is the Deployment's current ReplicaSet
 * created after the deploy started; it is done when every replica is updated, ready and available. A pod stuck in
 * CrashLoopBackOff, ImagePullBackOff or a config error fails the check at once, with its log tail matched against
 * «Для раскатки» (a placeholder Spring could not resolve is a setting the environment lacks).
 */

export type Kubectl = (args: string[], timeoutMs?: number) => Promise<{ ok: boolean; out: string; err: string }>;

export const runKubectl = (bin: string): Kubectl => (args, timeoutMs = 30_000) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (e, out, err) => resolve({ ok: !e, out: String(out), err: String(err) || (e ? e.message : "") }));
  });

export interface RolloutTarget {
  context?: string;
  namespace: string;
  deployment: string;
  /** Pod label selector; default: the Deployment's own matchLabels. */
  selector?: string;
}

export interface PodState {
  name: string;
  ready: boolean;
  restarts: number;
  /** Why a container waits or died: CrashLoopBackOff, ImagePullBackOff… */
  reason?: string;
  replicaSet?: string;
}

export interface RolloutResult {
  ok: boolean;
  summary: string;
  output: string;
  pods: PodState[];
  replicaSet?: { name: string; createdAt: string; revision: string };
  /** What the logs say is missing, matched against «Для раскатки». */
  diagnosis?: string[];
}

const FATAL = /^(CrashLoopBackOff|ImagePullBackOff|ErrImagePull|CreateContainerConfigError|CreateContainerError|InvalidImageName|RunContainerError)$/;

interface K8sObj {
  metadata: { name: string; creationTimestamp?: string; generation?: number; annotations?: Record<string, string>; ownerReferences?: { kind: string; name: string }[] };
  spec?: { replicas?: number; selector?: { matchLabels?: Record<string, string> } };
  status?: Record<string, unknown> & { containerStatuses?: { ready?: boolean; restartCount?: number; state?: { waiting?: { reason?: string }; terminated?: { reason?: string } }; lastState?: { terminated?: { reason?: string } } }[] };
}

/** One look at the cluster; null when it cannot be read (no context, no rights, no such deployment). */
export async function lookOnce(kubectl: Kubectl, t: RolloutTarget, since: string): Promise<{ done: boolean; fatal: boolean; text: string; pods: PodState[]; rs?: RolloutResult["replicaSet"]; error?: string }> {
  const base = [...(t.context ? ["--context", t.context] : []), "-n", t.namespace, "--request-timeout=20s"];
  const dep = await kubectl([...base, "get", "deployment", t.deployment, "-o", "json"]);
  if (!dep.ok) return { done: false, fatal: false, text: "", pods: [], error: `kubectl get deployment ${t.deployment} -n ${t.namespace}: ${dep.err.trim().slice(0, 400)}` };
  const d = JSON.parse(dep.out) as K8sObj;
  const revision = d.metadata.annotations?.["deployment.kubernetes.io/revision"] ?? "";
  const labels = d.spec?.selector?.matchLabels ?? {};
  const selector = t.selector ?? Object.entries(labels).map(([k, v]) => `${k}=${v}`).join(",");
  const rsList = await kubectl([...base, "get", "rs", ...(selector ? ["-l", selector] : []), "-o", "json"]);
  const rss = rsList.ok ? ((JSON.parse(rsList.out) as { items: K8sObj[] }).items ?? []) : [];
  const current = rss.find((r) => r.metadata.ownerReferences?.some((o) => o.kind === "Deployment" && o.name === t.deployment) && r.metadata.annotations?.["deployment.kubernetes.io/revision"] === revision);
  const rs = current ? { name: current.metadata.name, createdAt: current.metadata.creationTimestamp ?? "", revision } : undefined;
  const podList = await kubectl([...base, "get", "pods", ...(selector ? ["-l", selector] : []), "-o", "json"]);
  const pods: PodState[] = (podList.ok ? ((JSON.parse(podList.out) as { items: K8sObj[] }).items ?? []) : []).map((p) => {
    const cs = p.status?.containerStatuses ?? [];
    const reason = cs.map((c) => c.state?.waiting?.reason ?? c.state?.terminated?.reason).find(Boolean);
    return {
      name: p.metadata.name,
      ready: cs.length > 0 && cs.every((c) => c.ready),
      restarts: cs.reduce((n, c) => n + (c.restartCount ?? 0), 0),
      ...(reason ? { reason } : {}),
      ...(p.metadata.ownerReferences?.[0]?.name ? { replicaSet: p.metadata.ownerReferences[0].name } : {}),
    };
  });
  const s = d.status ?? {};
  const want = d.spec?.replicas ?? 1;
  const num = (k: string) => Number(s[k] ?? 0);
  const fresh = !!rs && Date.parse(rs.createdAt) >= Date.parse(since) - 5_000; // a few seconds of clock skew
  const settled = Number(s.observedGeneration ?? 0) >= (d.metadata.generation ?? 0) && num("updatedReplicas") === want && num("readyReplicas") === want && num("availableReplicas") === want && num("replicas") === want;
  const ours = pods.filter((p) => !rs || p.replicaSet === rs.name);
  const fatal = fresh && ours.some((p) => p.reason && FATAL.test(p.reason));
  const text =
    `ревизия ${revision || "?"}` + (rs ? `, ReplicaSet ${rs.name} создан ${new Date(rs.createdAt).toLocaleString("ru-RU")}` : "") +
    ` · готово ${num("readyReplicas")}/${want}, обновлено ${num("updatedReplicas")}/${want}` +
    (ours.length ? ` · поды: ${ours.map((p) => `${p.name} ${p.ready ? "ready" : p.reason ?? "не готов"}${p.restarts ? `, перезапусков ${p.restarts}` : ""}`).join("; ")}` : "");
  return { done: fresh && settled, fatal, text, pods: ours, ...(rs ? { rs } : {}) };
}

/** Why the pods do not start, from their log tails and the namespace's warnings, matched against «Для раскатки». */
export async function diagnose(kubectl: Kubectl, t: RolloutTarget, pods: PodState[], notes?: DeployNotes): Promise<{ output: string; diagnosis: string[] }> {
  const base = [...(t.context ? ["--context", t.context] : []), "-n", t.namespace, "--request-timeout=20s"];
  const bad = pods.find((p) => !p.ready) ?? pods[0];
  let output = "";
  const diagnosis: string[] = [];
  if (bad) {
    const logs = await kubectl([...base, "logs", bad.name, "--all-containers", "--tail=80", ...(bad.restarts ? ["--previous"] : [])]);
    const text = logs.ok ? logs.out : (await kubectl([...base, "logs", bad.name, "--all-containers", "--tail=80"])).out;
    output += `лог ${bad.name}:\n${text.trim().slice(-6000)}\n`;
    const keys = new Set<string>();
    for (const m of text.matchAll(/Could not resolve placeholder '([^']+)'/g)) keys.add(m[1]!);
    for (const m of text.matchAll(/(?:Failed to bind properties under|Binding to target \S+ failed:\s*\n?\s*Property:)\s*'?([\w.[\]-]+)'?/g)) keys.add(m[1]!);
    for (const k of keys) {
      const p = notes?.properties.find((x) => x.key === k || x.envVar === k || k.startsWith(`${x.key}.`));
      diagnosis.push(p ? `не задано ${p.envVar} (${p.key}) — оно было в «Для раскатки»` : `не задано свойство ${k}`);
    }
    if (/liquibase/i.test(text) && /(exception|error|lock)/i.test(text)) diagnosis.push("ошибка Liquibase при старте: см. лог (миграция или блокировка changelog)");
    if (/ImagePullBackOff|ErrImagePull/.test(bad.reason ?? "")) diagnosis.push("образ не скачивается: нет такого тега или нет доступа к registry");
    if (/CreateContainerConfigError/.test(bad.reason ?? "")) diagnosis.push("ошибка конфигурации контейнера: нет Secret или ConfigMap, на который он ссылается");
  }
  const ev = await kubectl([...base, "get", "events", "--field-selector", "type=Warning", "-o", "json"]);
  if (ev.ok) {
    const names = new Set([t.deployment, ...pods.map((p) => p.name), ...pods.flatMap((p) => (p.replicaSet ? [p.replicaSet] : []))]);
    const items = ((JSON.parse(ev.out) as { items: { involvedObject?: { name?: string }; reason?: string; message?: string; lastTimestamp?: string }[] }).items ?? []).filter((e) => names.has(e.involvedObject?.name ?? ""));
    if (items.length) output += `\nпредупреждения:\n${items.slice(-10).map((e) => `${e.involvedObject?.name}: ${e.reason} — ${e.message}`).join("\n")}`;
  }
  return { output: output.trim(), diagnosis };
}

/** Waits for our rollout until it is done, fails, or the time runs out; `progress` gets each look for the page. */
export async function checkRollout(
  kubectl: Kubectl,
  t: RolloutTarget,
  opts: { since: string; timeoutSec: number; intervalMs?: number; notes?: DeployNotes; signal?: AbortSignal; progress?: (text: string) => Promise<void> | void },
): Promise<RolloutResult> {
  const deadline = Date.now() + opts.timeoutSec * 1000;
  let last: Awaited<ReturnType<typeof lookOnce>> | null = null;
  for (;;) {
    if (opts.signal?.aborted) return { ok: false, summary: "отменено", output: "", pods: [] };
    last = await lookOnce(kubectl, t, opts.since);
    if (last.error) return { ok: false, summary: last.error.split("\n")[0]!, output: last.error, pods: [] };
    if (last.done) {
      const restarts = last.pods.reduce((n, p) => n + p.restarts, 0);
      return { ok: true, summary: `раскатилось: ${last.text}${restarts ? " · есть перезапуски, проверьте лог" : ""}`, output: last.text, pods: last.pods, ...(last.rs ? { replicaSet: last.rs } : {}) };
    }
    if (last.fatal) break;
    await opts.progress?.(last.rs && Date.parse(last.rs.createdAt) >= Date.parse(opts.since) - 5_000 ? `раскатывается: ${last.text}` : `ждём новую раскатку (после ${new Date(opts.since).toLocaleTimeString("ru-RU")}): ${last.text}`);
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, Math.min(opts.intervalMs ?? 10_000, Math.max(0, deadline - Date.now()))));
  }
  const fresh = !!last?.rs && Date.parse(last.rs.createdAt) >= Date.parse(opts.since) - 5_000;
  const d = await diagnose(kubectl, t, last?.pods ?? [], opts.notes);
  const head = !fresh
    ? `новой раскатки не было за ${opts.timeoutSec} с: job не запускался или раскатывает другой Deployment`
    : last?.fatal
      ? `поды не стартуют: ${[...new Set(last.pods.flatMap((p) => (p.reason ? [p.reason] : [])))].join(", ")}`
      : `rollout не завершился за ${opts.timeoutSec} с`;
  return {
    ok: false,
    summary: head + (d.diagnosis.length ? ` · ${d.diagnosis.join("; ")}` : ""),
    output: [last?.text ?? "", d.output].filter(Boolean).join("\n\n"),
    pods: last?.pods ?? [],
    ...(last?.rs ? { replicaSet: last.rs } : {}),
    diagnosis: d.diagnosis,
  };
}
