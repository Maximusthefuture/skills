import { describe, expect, it } from "vitest";
import { covers, findOverlaps, matches, normalizePath, overlaps, ownersOf } from "../../src/ownership.js";

describe("ownership", () => {
  it("normalizes paths", () => {
    expect(normalizePath("./src//main/A.java")).toBe("src/main/A.java");
    expect(normalizePath("src\\main\\A.java")).toBe("src/main/A.java");
    expect(normalizePath("src/main/")).toBe("src/main/**");
  });

  it("matches exact paths and globs", () => {
    expect(matches("src/A.java", "src/A.java")).toBe(true);
    expect(matches("src/A.java", "src/B.java")).toBe(false);
    expect(matches("src/main/**", "src/main/java/com/A.java")).toBe(true);
    expect(matches("src/main/**", "src/test/A.java")).toBe(false);
    expect(matches("src/*.java", "src/A.java")).toBe(true);
    expect(matches("src/*.java", "src/sub/A.java")).toBe(false);
    expect(matches("src/**/A.java", "src/A.java")).toBe(true);
    expect(matches("src/**/A.java", "src/x/y/A.java")).toBe(true);
    expect(matches("src/A?.java", "src/A1.java")).toBe(true);
    expect(matches("src/main/", "src/main/x/Y.java")).toBe(true);
    expect(matches("a.b", "aXb")).toBe(false); // "." is literal
  });

  it("detects overlapping declarations", () => {
    expect(overlaps("src/A.java", "src/A.java")).toBe(true);
    expect(overlaps("src/A.java", "src/B.java")).toBe(false);
    expect(overlaps("src/main/**", "src/main/A.java")).toBe(true);
    expect(overlaps("src/main/**", "src/test/**")).toBe(false);
    expect(overlaps("src/**", "src/test/**")).toBe(true);
    expect(overlaps("src/main/java/**", "src/main/**")).toBe(true);
    expect(overlaps("src/main/*.java", "src/test/*.java")).toBe(false);
  });

  it("is exact for glob vs glob, not a prefix guess", () => {
    // same directory, different suffixes: disjoint (used to be a false FILE_OVERLAP)
    expect(overlaps("src/*Controller.java", "src/*Service.java")).toBe(false);
    expect(overlaps("src/**/*Test.java", "src/**/*IT.java")).toBe(false);
    expect(overlaps("src/*/a.java", "src/**/b.java")).toBe(false);
    expect(overlaps("src/main/java/a/**", "src/main/java/b/**")).toBe(false);
    expect(overlaps("src/?.java", "src/AB.java")).toBe(false);
    expect(overlaps("src/*.java", "src/a/b.java")).toBe(false); // '*' stays inside one directory
    // real intersections
    expect(overlaps("src/*Controller.java", "src/User*")).toBe(true); // src/UserController.java
    expect(overlaps("src/**/*Test.java", "src/main/**")).toBe(true); // src/main/FooTest.java
    expect(overlaps("src/?.java", "src/A.java")).toBe(true);
    expect(overlaps("**", "pom.xml")).toBe(true);
    expect(overlaps("src/**/A.java", "src/A.java")).toBe(true);
  });

  it("never misses an overlap: any path matching both globs makes them overlap", () => {
    const patterns = ["src/**", "src/*.java", "src/*Test.java", "src/a/**", "src/**/b.java", "src/?.java", "src/a/*", "**/*.java", "src/**/a*", "src/a/b.java", "*"];
    const paths: string[] = [];
    for (const d of ["", "src/", "src/a/", "src/a/b/", "src/x/"]) for (const f of ["a.java", "b.java", "aTest.java", "ab", "x.java", "b"]) paths.push(d + f);
    for (const a of patterns) {
      for (const b of patterns) {
        const witness = paths.find((p) => matches(a, p) && matches(b, p));
        if (witness) expect(overlaps(a, b), `${a} vs ${b} (both match ${witness})`).toBe(true);
      }
    }
  });

  it("finds overlaps between different agents only", () => {
    const a = [
      { agentId: "backend", files: ["src/main/**", "src/main/A.java"] },
      { agentId: "reviewer", files: ["src/test/**", "src/main/A.java"] },
    ];
    expect(findOverlaps(a)).toEqual([{ agents: ["backend", "reviewer"], files: ["src/main/**", "src/main/A.java"] }, { agents: ["backend", "reviewer"], files: ["src/main/A.java", "src/main/A.java"] }]);
    expect(findOverlaps([{ agentId: "a", files: ["x/**"] }, { agentId: "b", files: ["y/**"] }, { agentId: "c" }])).toEqual([]);
  });

  it("finds owners of a file and what a declaration covers", () => {
    const a = [{ agentId: "backend", files: ["src/main/**"] }, { agentId: "reviewer", files: ["src/test/**"] }];
    expect(ownersOf("src/main/A.java", a)).toEqual(["backend"]);
    expect(ownersOf("pom.xml", a)).toEqual([]);
    expect(covers("src/main/**", "src/main/A.java")).toBe(true);
    expect(covers("src/main/**", "src/main/java/**")).toBe(true);
    expect(covers("src/main/**", "src/test/A.java")).toBe(false);
    expect(covers("src/main/A.java", "src/main/**")).toBe(false);
  });
});
