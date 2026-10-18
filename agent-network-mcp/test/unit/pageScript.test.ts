import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { PAGE_HTML } from "../../src/ui/page.js";

describe("the page's script", () => {
  // the page is plain JavaScript in a string, out of reach of tsc: a typo would break the whole page at load
  it("parses", () => {
    const scripts = [...PAGE_HTML.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const s of scripts) expect(() => new vm.Script(s)).not.toThrow();
  });
});
