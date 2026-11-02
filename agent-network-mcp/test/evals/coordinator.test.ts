import { expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ProjectStore } from "../../src/project/store.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";

const scenarios = [
  { name: "clear request produces a proposal without questions", history: [],
    request: "В форме регистрации при повторном нажатии кнопки отправляются два запроса. Пока первый запрос выполняется, отключать кнопку. При ошибке снова включать её и показывать ошибку. Подготовь задание.",
    proposes: true },
  { name: "short answer uses the earlier decision context", history: [
    "Пользователь: В форме регистрации нужно предотвращать повторную отправку и показывать ошибку запроса. Подготовь задание.",
    "Координатор: Предлагаю отключать кнопку на время запроса, а при ошибке снова включать. Подходит?",
  ], request: "да", proposes: true },
  { name: "unknown repository details are left to the team", history: [],
    request: "Подготовь задание: исправить потерю текста формы обратной связи при ошибке отправки. Текст должен сохраняться, ошибка отображаться рядом с формой, повторная отправка должна быть доступна. Файлов и используемого фреймворка я не знаю.",
    proposes: true },
  { name: "consequential ambiguity triggers clarification", history: [],
    request: "Подготовь задание по очистке клиентских данных. Нужно удалять старые записи, но я ещё не решил, какие данные удалять, какой срок хранения и требуется ли возможность восстановления.",
    proposes: false },
];

// Opt-in: these tests launch a real coordinator CLI and incur model usage.
it.skipIf(process.env.COORDINATOR_EVAL !== "1").each(scenarios)("$name", async scenario => {
  const engine = process.env.COORDINATOR_EVAL_ENGINE ?? "claude";
  if (engine !== "claude" && engine !== "codex" && engine !== "kimi") throw new Error("Unknown eval engine");
  const dir = await tmpDir("coordinator-eval-"), fs = await FileStore.open(dir), store = new ProjectStore(fs);
  for (const [index, text] of scenario.history.entries()) await store.enqueue(`history-${index}`, text);
  // History is supplied as context, not queued work to execute.
  for (const _ of scenario.history) {
    const historical = await store.claim("history");
    await store.finish(historical!.runId, "history", { result: "Historical context" });
  }
  const messageId = "eval-request";
  await store.enqueue(messageId, scenario.request);
  const run = (await store.claim("eval-owner"))!;
  const state = await store.read();
  // Use the built executor so its relative MCP entry point resolves to dist/index.js.
  const { isolatedCoordinatorExecutor } = await import(pathToFileURL(resolve("dist/project/executor.js")).href) as
    typeof import("../../src/project/executor.js");
  const execute = isolatedCoordinatorExecutor({ engine, model: process.env.COORDINATOR_EVAL_MODEL,
    snapshot: () => store.read(),
    project: { networkDir: dir, projectId: state.projectId, agentIds: ["lead", "reviewer"], resolved: {} },
  });
  const answer = await execute({ message: state.messages.find(message => message.messageId === messageId)!,
    run, signal: AbortSignal.timeout(120_000) });
  const saved = await store.read();
  expect(saved.tasks).toHaveLength(0);
  expect(saved.proposals).toHaveLength(scenario.proposes ? 1 : 0);
  if (scenario.proposes) {
    expect(answer).not.toContain("?");
    expect(saved.proposals[0]!.status).toBe("pending");
    expect(saved.proposals[0]!.payload.description).toContain("Acceptance criteria:");
  } else {
    expect(answer).toContain("?");
    expect(answer.split("?").length - 1).toBeLessThanOrEqual(3);
  }
}, 150_000);
