import { AppError } from "../errors.js";
import type { ProjectState } from "./store.js";

export interface HistoryCursor { message: number; offset: number }
/** Cursor offsets count Unicode code points, so every fragment can be joined losslessly. */
export function historyPage(state: ProjectState, cursor: HistoryCursor = { message: 0, offset: 0 }) {
  if (![cursor.message, cursor.offset].every(n => Number.isSafeInteger(n) && n >= 0) || cursor.message > state.messages.length)
    throw new AppError("INVALID_INPUT", "Invalid history cursor");
  const message = state.messages[cursor.message];
  if (!message) {
    if (cursor.offset) throw new AppError("INVALID_INPUT", "Invalid history offset");
    return { item: null, next: null };
  }
  const chars = Array.from(message.content);
  if (cursor.offset > chars.length) throw new AppError("INVALID_INPUT", "Invalid history offset");
  const makePage = (count: number) => {
    const end = cursor.offset + count;
    return {
      item: { messageId: message.messageId, createdAt: message.createdAt,
        content: chars.slice(cursor.offset, end).join(""), offset: cursor.offset,
        continued: end < chars.length },
      next: end < chars.length ? { message: cursor.message, offset: end } :
        cursor.message + 1 < state.messages.length ? { message: cursor.message + 1, offset: 0 } : null,
    };
  };
  let low = 0, high = chars.length - cursor.offset;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(JSON.stringify(makePage(middle))) <= 16384) low = middle;
    else high = middle - 1;
  }
  const result = makePage(low);
  if (Buffer.byteLength(JSON.stringify(result)) > 16384 || (!low && cursor.offset < chars.length))
    throw new AppError("INVALID_INPUT", "History metadata exceeds page limit");
  return result;
}
