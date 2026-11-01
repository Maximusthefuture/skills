import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE_HTML } from "../../src/ui/page.js";

describe("the page's script", () => {
  it("keeps every statically referenced control in the document", () => {
    const ids = new Set([...PAGE_HTML.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    const script = PAGE_HTML.match(/<script>([\s\S]*?)<\/script>/)![1]!;
    const missing = [...new Set([...script.matchAll(/\$\("([^"]+)"\)/g)].map(m => m[1]))].filter(id => !ids.has(id));
    expect(missing).toEqual([]);
  });
  // the page is plain JavaScript in a string, out of reach of tsc: a typo would break the whole page at load
  it("parses", () => {
    const scripts = [...PAGE_HTML.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => new vm.Script(s)).not.toThrow();
  });
});
