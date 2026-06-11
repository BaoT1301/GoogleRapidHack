// Feature: 3d-codebase-globe-visualizer, Property 6: Symbol Extraction Completeness
import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parsePythonFile } from "../../parsers/python-parser.js";
import { parseTypeScriptFile } from "../../parsers/typescript-parser.js";

// Python and TypeScript reserved keywords to avoid generating as identifiers
const PYTHON_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await",
  "break", "class", "continue", "def", "del", "elif", "else", "except",
  "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try",
  "while", "with", "yield",
]);

const TS_KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "function", "if", "import", "in",
  "instanceof", "new", "null", "return", "super", "switch", "this",
  "throw", "true", "try", "typeof", "var", "void", "while", "with",
  "yield", "let", "static", "implements", "interface", "package",
  "private", "protected", "public", "abstract", "as", "async", "await",
  "constructor", "declare", "get", "module", "require", "set", "type",
  "from", "of",
]);

// Arbitrary for valid Python identifiers (not keywords, min 2 chars to avoid edge cases)
const arbPythonIdent = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{1,15}$/)
  .filter((s) => !PYTHON_KEYWORDS.has(s));

// Arbitrary for valid TypeScript identifiers (not keywords, min 2 chars)
const arbTsIdent = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9_]{1,15}$/)
  .filter((s) => !TS_KEYWORDS.has(s));

// Arbitrary for valid Python module names (dotted)
const arbPythonModule = fc
  .array(arbPythonIdent, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("."));

// Arbitrary for valid TypeScript module paths
const arbTsModulePath = fc
  .array(arbTsIdent, { minLength: 1, maxLength: 3 })
  .map((parts) => "./" + parts.join("/"));

describe("Property 6: Symbol Extraction Completeness", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "symbol-extract-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it("should extract all Python function definitions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbPythonIdent, { minLength: 1, maxLength: 5, comparator: (a, b) => a === b }),
        async (funcNames) => {
          const tmpDir = makeTmpDir();
          const source = funcNames.map((name) => `def ${name}():\n    pass\n`).join("\n");
          const filePath = path.join(tmpDir, "test_funcs.py");
          fs.writeFileSync(filePath, source);

          const result = await parsePythonFile(filePath, tmpDir);
          const extractedFuncNames = result.symbols
            .filter((s) => s.kind === "function")
            .map((s) => s.name);

          for (const name of funcNames) {
            expect(extractedFuncNames).toContain(name);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("should extract all Python class definitions", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbPythonIdent, { minLength: 1, maxLength: 5, comparator: (a, b) => a === b }),
        async (classNames) => {
          const tmpDir = makeTmpDir();
          const source = classNames.map((name) => `class ${name}:\n    pass\n`).join("\n");
          const filePath = path.join(tmpDir, "test_classes.py");
          fs.writeFileSync(filePath, source);

          const result = await parsePythonFile(filePath, tmpDir);
          const extractedClassNames = result.symbols
            .filter((s) => s.kind === "class")
            .map((s) => s.name);

          for (const name of classNames) {
            expect(extractedClassNames).toContain(name);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("should extract all Python import statements", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(arbPythonModule, { minLength: 1, maxLength: 4, comparator: (a, b) => a === b }),
        async (moduleNames) => {
          const tmpDir = makeTmpDir();
          const source = moduleNames.map((mod) => `import ${mod}`).join("\n") + "\n";
          const filePath = path.join(tmpDir, "test_imports.py");
          fs.writeFileSync(filePath, source);

          const result = await parsePythonFile(filePath, tmpDir);
          const extractedImports = result.parsedImports.map((i) => i.raw);

          for (const mod of moduleNames) {
            expect(extractedImports).toContain(mod);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("should extract all TypeScript import statements", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(
          fc.uniqueArray(arbTsIdent, { minLength: 1, maxLength: 4, comparator: (a, b) => a === b }),
          fc.uniqueArray(arbTsModulePath, { minLength: 1, maxLength: 4, comparator: (a, b) => a === b }),
        ).filter(([names, modules]) => names.length === modules.length),
        async ([names, modules]) => {
          const tmpDir = makeTmpDir();
          const imports = names.map(
            (name, i) => `import { ${name} } from '${modules[i]}';`,
          );
          const source = imports.join("\n") + "\n";
          const filePath = path.join(tmpDir, "test_imports.ts");
          fs.writeFileSync(filePath, source);

          const result = await parseTypeScriptFile(filePath, tmpDir);
          const extractedImports = result.parsedImports.map((i) => i.raw);

          for (const mod of modules) {
            expect(extractedImports).toContain(mod);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("should extract mixed Python functions, classes, and imports together", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          funcNames: fc.uniqueArray(arbPythonIdent, { minLength: 1, maxLength: 3, comparator: (a, b) => a === b }),
          classNames: fc.uniqueArray(arbPythonIdent, { minLength: 1, maxLength: 3, comparator: (a, b) => a === b }),
          moduleNames: fc.uniqueArray(arbPythonModule, { minLength: 1, maxLength: 3, comparator: (a, b) => a === b }),
        }).filter(({ funcNames, classNames }) => {
          // Ensure no overlap between function and class names
          const classSet = new Set(classNames);
          return funcNames.every((f) => !classSet.has(f));
        }),
        async ({ funcNames, classNames, moduleNames }) => {
          const tmpDir = makeTmpDir();
          const importLines = moduleNames.map((mod) => `import ${mod}`);
          const classLines = classNames.map((name) => `class ${name}:\n    pass`);
          const funcLines = funcNames.map((name) => `def ${name}():\n    pass`);
          const source = [...importLines, "", ...classLines, "", ...funcLines, ""].join("\n");
          const filePath = path.join(tmpDir, "test_mixed.py");
          fs.writeFileSync(filePath, source);

          const result = await parsePythonFile(filePath, tmpDir);
          const extractedFuncs = result.symbols.filter((s) => s.kind === "function").map((s) => s.name);
          const extractedClasses = result.symbols.filter((s) => s.kind === "class").map((s) => s.name);
          const extractedImports = result.parsedImports.map((i) => i.raw);

          for (const name of funcNames) {
            expect(extractedFuncs).toContain(name);
          }
          for (const name of classNames) {
            expect(extractedClasses).toContain(name);
          }
          for (const mod of moduleNames) {
            expect(extractedImports).toContain(mod);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
