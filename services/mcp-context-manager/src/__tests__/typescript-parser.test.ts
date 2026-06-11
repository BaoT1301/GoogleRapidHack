import { describe, it, expect } from "vitest";
import { parseTypeScriptFile } from "../parsers/typescript-parser.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Helper: write a temp .ts file, parse it, and clean up.
 */
async function parseSource(source: string, fileName = "test.ts"): Promise<Awaited<ReturnType<typeof parseTypeScriptFile>>> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-parser-test-"));
  const filePath = path.join(tmpDir, fileName);
  await fs.writeFile(filePath, source, "utf8");
  try {
    return await parseTypeScriptFile(filePath, tmpDir);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

describe("TypeScript Parser — Track 1 Upgrade", () => {
  // ─── Test 1: Parse a file with functions and classes → verify symbols extracted ───

  describe("Test 1: Functions and classes extraction", () => {
    it("should extract function declarations", async () => {
      const result = await parseSource(`
function greet(name: string): string {
  return "Hello " + name;
}

async function fetchData(): Promise<void> {
  await fetch("/api");
}
`);
      const funcSymbols = result.symbols.filter((s) => s.kind === "function");
      const names = funcSymbols.map((s) => s.name);
      expect(names).toContain("greet");
      expect(names).toContain("fetchData");
    });

    it("should extract arrow functions assigned to const", async () => {
      const result = await parseSource(`
const add = (a: number, b: number) => a + b;
const multiply = async (a: number, b: number) => a * b;
`);
      const funcSymbols = result.symbols.filter((s) => s.kind === "function");
      const names = funcSymbols.map((s) => s.name);
      expect(names).toContain("add");
      expect(names).toContain("multiply");
    });

    it("should extract function expressions assigned to const", async () => {
      const result = await parseSource(`
const divide = function(a: number, b: number) { return a / b; };
`);
      const funcSymbols = result.symbols.filter((s) => s.kind === "function");
      expect(funcSymbols.map((s) => s.name)).toContain("divide");
    });

    it("should extract class declarations", async () => {
      const result = await parseSource(`
class UserService {
  getUser(id: string) { return id; }
}

abstract class BaseController {
  abstract handle(): void;
}
`);
      const classSymbols = result.symbols.filter((s) => s.kind === "class");
      const classNames = classSymbols.map((s) => s.name);
      expect(classNames).toContain("UserService");
      expect(classNames).toContain("BaseController");
    });

    it("should extract class methods with qualifiedName format", async () => {
      const result = await parseSource(`
class UserService {
  getUser(id: string) { return id; }
  async deleteUser(id: string) { }
}
`);
      const methods = result.symbols.filter(
        (s) => s.kind === "function" && s.qualifiedName.includes("UserService"),
      );
      const qNames = methods.map((s) => s.qualifiedName);
      expect(qNames).toContainEqual(expect.stringContaining("UserService.getUser"));
      expect(qNames).toContainEqual(expect.stringContaining("UserService.deleteUser"));
    });

    it("should extract constructors", async () => {
      const result = await parseSource(`
class App {
  constructor(private name: string) {}
}
`);
      const ctors = result.symbols.filter(
        (s) => s.name === "constructor" && s.qualifiedName.includes("App"),
      );
      expect(ctors.length).toBe(1);
    });

    it("should extract class property arrow functions", async () => {
      const result = await parseSource(`
class Validator {
  validate = (input: string) => input.length > 0;
}
`);
      const methods = result.symbols.filter(
        (s) => s.kind === "function" && s.qualifiedName.includes("Validator.validate"),
      );
      expect(methods.length).toBe(1);
    });

    it("should populate rangeStart and rangeEnd for all symbols", async () => {
      const result = await parseSource(`
function foo() {}
class Bar {}
const baz = () => {};
`);
      const nonModuleSymbols = result.symbols.filter((s) => s.kind !== "module");
      for (const sym of nonModuleSymbols) {
        expect(sym.rangeStart.line).toBeGreaterThan(0);
        expect(sym.rangeStart.column).toBeGreaterThan(0);
        expect(sym.rangeEnd.line).toBeGreaterThanOrEqual(sym.rangeStart.line);
      }
    });

    it("should create defines relations for all symbols", async () => {
      const result = await parseSource(`
function foo() {}
class Bar {}
`);
      const definesRelations = result.relations.filter((r) => r.type === "defines");
      // module + foo + Bar = 3 defines
      expect(definesRelations.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ─── Test 2: Parse a file with function calls → verify calls relations extracted ───

  describe("Test 2: Call relationships extraction", () => {
    it("should extract direct function calls", async () => {
      const result = await parseSource(`
function helper() { return 42; }
function main() {
  helper();
}
`);
      const callRelations = result.relations.filter((r) => r.type === "calls");
      expect(callRelations.length).toBeGreaterThanOrEqual(1);
      const helperCall = callRelations.find((r) =>
        r.targetQualifiedName?.includes("helper"),
      );
      expect(helperCall).toBeDefined();
      expect(helperCall!.confidence).toBe(1); // local target found
    });

    it("should extract method calls (this.method and obj.method)", async () => {
      const result = await parseSource(`
class Service {
  private log(msg: string) { console.log(msg); }
  run() {
    this.log("running");
  }
}
`);
      const callRelations = result.relations.filter((r) => r.type === "calls");
      const logCall = callRelations.find((r) =>
        r.targetQualifiedName?.includes("log"),
      );
      expect(logCall).toBeDefined();
    });

    it("should extract calls to unknown/external functions with lower confidence", async () => {
      const result = await parseSource(`
function main() {
  unknownFunction();
}
`);
      const callRelations = result.relations.filter((r) => r.type === "calls");
      const unknownCall = callRelations.find((r) =>
        r.targetQualifiedName?.includes("unknownFunction"),
      );
      expect(unknownCall).toBeDefined();
      expect(unknownCall!.confidence).toBe(0.5); // not locally defined
    });

    it("should extract variable writes", async () => {
      const result = await parseSource(`
function process() {
  const x = 10;
  let y = 20;
  y = 30;
}
`);
      const writeRelations = result.relations.filter((r) => r.type === "writes");
      const writeNames = writeRelations.map((r) => r.targetQualifiedName);
      expect(writeNames).toContainEqual(expect.stringContaining("x"));
      expect(writeNames).toContainEqual(expect.stringContaining("y"));
    });

    it("should extract variable reads", async () => {
      const result = await parseSource(`
const config = { port: 3000 };
function getPort() {
  return config;
}
`);
      const readRelations = result.relations.filter((r) => r.type === "reads");
      const readNames = readRelations.map((r) => r.targetQualifiedName);
      expect(readNames).toContainEqual(expect.stringContaining("config"));
    });
  });

  // ─── Test 3: Parse a file with imports and exports → verify import resolution still works ───

  describe("Test 3: Imports and exports", () => {
    it("should extract import declarations", async () => {
      const result = await parseSource(`
import { useState } from "react";
import path from "node:path";
import { helper } from "./utils";
`);
      expect(result.parsedImports.length).toBe(3);
      const reactImport = result.parsedImports.find((i) => i.raw === "react");
      expect(reactImport).toBeDefined();
      expect(reactImport!.isRelative).toBe(false);

      const utilsImport = result.parsedImports.find((i) => i.raw === "./utils");
      expect(utilsImport).toBeDefined();
      expect(utilsImport!.isRelative).toBe(true);
    });

    it("should extract re-exports", async () => {
      const result = await parseSource(`
export { foo } from "./foo";
export * from "./bar";
`);
      // Re-exports should also appear as imports
      const fooImport = result.parsedImports.find((i) => i.raw === "./foo");
      expect(fooImport).toBeDefined();
      expect(fooImport!.isRelative).toBe(true);

      const barImport = result.parsedImports.find((i) => i.raw === "./bar");
      expect(barImport).toBeDefined();

      // Should have export relations
      const exportRelations = result.relations.filter((r) => r.type === "exports");
      expect(exportRelations.length).toBeGreaterThanOrEqual(2);
    });

    it("should extract export keyword on declarations", async () => {
      const result = await parseSource(`
export function publicFn() {}
export class PublicClass {}
export const value = 42;
`);
      const exportRelations = result.relations.filter((r) => r.type === "exports");
      expect(exportRelations.length).toBeGreaterThanOrEqual(3);
    });

    it("should preserve the module symbol", async () => {
      const result = await parseSource(`
const x = 1;
`);
      const moduleSymbol = result.symbols.find((s) => s.kind === "module");
      expect(moduleSymbol).toBeDefined();
      expect(moduleSymbol!.language).toBe("typescript");
    });

    it("should handle default exports", async () => {
      const result = await parseSource(`
export default function main() {}
`);
      const exportRelations = result.relations.filter((r) => r.type === "exports");
      expect(exportRelations.length).toBeGreaterThanOrEqual(1);

      const mainSymbol = result.symbols.find((s) => s.name === "main");
      expect(mainSymbol).toBeDefined();
    });
  });

  // ─── Test 4: Inheritance relationships (inherits edges) — Track 3 Sprint 2 ───

  describe("Test 4: Inheritance relationships (inherits edges)", () => {
    it("should extract inherits relation from extends keyword", async () => {
      const result = await parseSource(`
class Animal {
  name: string = "";
}

class Dog extends Animal {
  bark() { return "woof"; }
}
`);
      const inheritsRelations = result.relations.filter((r) => r.type === "inherits");
      expect(inheritsRelations.length).toBeGreaterThanOrEqual(1);
      const dogInherits = inheritsRelations.find((r) =>
        r.targetQualifiedName?.includes("Animal"),
      );
      expect(dogInherits).toBeDefined();
      expect(dogInherits!.confidence).toBe(0.9);
      // Source should be the Dog class symbol
      expect(dogInherits!.sourceSymbolId).toContain("Dog");
    });

    it("should extract inherits relation from implements keyword", async () => {
      const result = await parseSource(`
class Serializable {
  serialize() { return ""; }
}

class UserService implements Serializable {
  serialize() { return "user"; }
}
`);
      const inheritsRelations = result.relations.filter((r) => r.type === "inherits");
      expect(inheritsRelations.length).toBeGreaterThanOrEqual(1);
      const implRelation = inheritsRelations.find((r) =>
        r.targetQualifiedName?.includes("Serializable"),
      );
      expect(implRelation).toBeDefined();
      expect(implRelation!.confidence).toBe(0.9);
      expect(implRelation!.sourceSymbolId).toContain("UserService");
    });
  });

  // ─── Edge cases ───

  describe("Edge cases", () => {
    it("should handle empty files", async () => {
      const result = await parseSource("");
      expect(result.symbols.length).toBe(1); // just the module symbol
      expect(result.parseErrors.length).toBe(0);
    });

    it("should handle destructured assignments without crashing", async () => {
      const result = await parseSource(`
function process() {
  const { a, b } = { a: 1, b: 2 };
  const [x, y] = [1, 2];
}
`);
      expect(result.parseErrors.length).toBe(0);
      const processSymbol = result.symbols.find((s) => s.name === "process");
      expect(processSymbol).toBeDefined();
    });

    it("should handle get/set accessors", async () => {
      const result = await parseSource(`
class Config {
  private _value = 0;
  get value() { return this._value; }
  set value(v: number) { this._value = v; }
}
`);
      const accessors = result.symbols.filter(
        (s) => s.name === "value" && s.kind === "function",
      );
      // get and set are separate symbols
      expect(accessors.length).toBe(2);
    });
  });
});
