import { describe, it, expect } from "vitest";
import { parsePythonFile } from "../parsers/python-parser.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Helper: write a temp .py file, parse it, and clean up.
 */
async function parseSource(source: string, fileName = "test_module.py"): Promise<Awaited<ReturnType<typeof parsePythonFile>>> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "py-parser-test-"));
  const filePath = path.join(tmpDir, fileName);
  await fs.writeFile(filePath, source, "utf8");
  try {
    return await parsePythonFile(filePath, tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("Python Parser — inherits edge extraction (Track 3 Sprint 2)", () => {
  it("should extract inherits relation for single base class", async () => {
    const result = await parseSource(`
class Animal:
    def speak(self):
        pass

class Dog(Animal):
    def speak(self):
        return "woof"
`);
    const inheritsRelations = result.relations.filter((r) => r.type === "inherits");
    expect(inheritsRelations.length).toBeGreaterThanOrEqual(1);
    const dogInherits = inheritsRelations.find((r) =>
      r.targetQualifiedName?.includes("Animal"),
    );
    expect(dogInherits).toBeDefined();
    expect(dogInherits!.confidence).toBe(0.9);
    expect(dogInherits!.sourceSymbolId).toContain("Dog");
  });

  it("should extract multiple inherits relations for multiple base classes", async () => {
    const result = await parseSource(`
class Flyable:
    def fly(self):
        pass

class Swimmable:
    def swim(self):
        pass

class Duck(Flyable, Swimmable):
    def quack(self):
        return "quack"
`);
    const inheritsRelations = result.relations.filter((r) => r.type === "inherits");
    // Duck should have 2 inherits edges
    const duckInherits = inheritsRelations.filter((r) =>
      r.sourceSymbolId?.includes("Duck"),
    );
    expect(duckInherits).toHaveLength(2);
    const targetNames = duckInherits.map((r) => r.targetQualifiedName);
    expect(targetNames).toContainEqual(expect.stringContaining("Flyable"));
    expect(targetNames).toContainEqual(expect.stringContaining("Swimmable"));
  });
});
