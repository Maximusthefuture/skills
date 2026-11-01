import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AppError } from "../errors.js";
import { copyInput, type InputFile } from "../specInput.js";
import type { FileStore } from "../storage/fileStore.js";
import { assertTaskId } from "../validation.js";

export interface InputManifest {
  files: { path: string; hash: string }[];
  inputSnapshotHash: string;
}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function segments(path: string): string[] {
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[\\:]/.test(part))) throw new AppError("INVALID_INPUT", "Invalid input manifest path");
  return parts;
}

export async function finalizeProjectInput(fs: FileStore, taskId: string, expected: string[], sources: () => Promise<InputFile[]>): Promise<InputManifest> {
  const dir = ["tasks", assertTaskId(taskId)];
  const names = [...expected].sort();
  if (!names.length || new Set(names).size !== names.length) throw new AppError("INVALID_INPUT", "Input manifest requires unique expected paths");
  for (const name of names) segments(name);
  return fs.withLock([...dir, ".input-finalize-lock"], async () => {
    const path = [...dir, "input-manifest.json"];
    const saved = await fs.readJson<InputManifest>(path);
    if (saved) {
      if (JSON.stringify(saved.files.map(f => f.path)) !== JSON.stringify(names) || digest(JSON.stringify(saved.files)) !== saved.inputSnapshotHash) throw new AppError("INVALID_INPUT", "Input manifest mismatch; manual recovery required");
      for (const file of saved.files) {
        const bytes = await readFile(fs.resolve([...dir, "input", ...segments(file.path)]));
        if (digest(bytes) !== file.hash) throw new AppError("INVALID_INPUT", "Input snapshot changed; manual recovery required");
      }
      return saved;
    }
    const files = await sources();
    if (JSON.stringify(files.map(f => f.rel).sort()) !== JSON.stringify(names)) throw new AppError("INVALID_INPUT", "Input source set changed before finalization");
    await copyInput(files, fs.resolve([...dir, "input"]));
    const entries: InputManifest["files"] = [];
    for (const name of names) {
      const source = files.find(f => f.rel === name)!;
      const bytes = await readFile(fs.resolve([...dir, "input", ...segments(name)]));
      if (digest(bytes) !== digest(await readFile(source.abs))) throw new AppError("INVALID_INPUT", "Input source changed while copying");
      entries.push({ path: name, hash: digest(bytes) });
    }
    const manifest = { files: entries, inputSnapshotHash: digest(JSON.stringify(entries)) };
    await fs.writeJson(path, manifest);
    return manifest;
  });
}
