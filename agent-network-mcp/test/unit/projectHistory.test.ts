import { expect, it } from "vitest";
import { historyPage, type HistoryCursor } from "../../src/project/history.js";
import { ProjectStore } from "../../src/project/store.js";
import { FileStore } from "../../src/storage/fileStore.js";
import { tmpDir } from "../helpers/tmp.js";
it("returns bounded pages that reconstruct long escaped Unicode messages exactly", async () => {
  const store = new ProjectStore(await FileStore.open(await tmpDir()));
  const content = "😀\n\"\\".repeat(10000);
  await store.enqueue("m1", content);
  await store.enqueue("m2", "last");
  const state = await store.read();
  let cursor: HistoryCursor | null = { message: 0, offset: 0 };
  const reconstructed: Record<string, string> = {};
  while (cursor) {
    const page = historyPage(state, cursor);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(16384);
    if (page.item) reconstructed[page.item.messageId] = (reconstructed[page.item.messageId] ?? "") + page.item.content;
    cursor = page.next;
  }
  expect(reconstructed).toEqual({ m1: content, m2: "last" });
  expect(() => historyPage(state, { message: -1, offset: 0 })).toThrow("cursor");
});
