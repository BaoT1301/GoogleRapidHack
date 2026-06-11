import fs from "node:fs/promises";
import path from "node:path";

import Parser from "tree-sitter";
import Python from "tree-sitter-python";

import {
  emptyParseResult,
  hashContent,
  normalizePath,
  pos,
} from "./common.js";
import type {
  FileParseResult,
  SymbolDefinition,
  SymbolRelation,
} from "../types/schema.js";

const parser = new Parser();
const pythonLanguage = Python as unknown as Parser.Language;
parser.setLanguage(pythonLanguage);

const functionQuery = new Parser.Query(pythonLanguage, "(function_definition name: (identifier) @function.name)");
const classQuery = new Parser.Query(pythonLanguage, "(class_definition name: (identifier) @class.name)");
const classWithBasesQuery = new Parser.Query(
  pythonLanguage,
  `(class_definition
    name: (identifier) @class.name
    superclasses: (argument_list) @class.bases)`,
);
const callQuery = new Parser.Query(
  pythonLanguage,
  `
(call function: (identifier) @call.name)
(call function: (attribute attribute: (identifier) @call.attr))
`,
);
const assignmentQuery = new Parser.Query(
  pythonLanguage,
  `
(assignment left: (identifier) @write.name)
(augmented_assignment left: (identifier) @write.name)
`,
);
const identifierQuery = new Parser.Query(pythonLanguage, "(identifier) @identifier.name");

function toModuleName(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
  return rel.replace(/\.py$/, "").replace(/\//g, ".").replace(/\.__init__$/, "");
}

function findEnclosingFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  let current: Parser.SyntaxNode | null = node;
  while (current) {
    if (current.type === "function_definition") {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function captureImportModules(root: Parser.SyntaxNode): string[] {
  const imports: string[] = [];
  const stack: Parser.SyntaxNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "import_statement") {
      const text = node.text.replace(/^import\s+/, "").trim();
      for (const part of text.split(",")) {
        const base = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (base) {
          imports.push(base);
        }
      }
    } else if (node.type === "import_from_statement") {
      const text = node.text;
      const fromMatch = text.match(/^from\s+([\.\w]+)\s+import\s+/);
      if (fromMatch?.[1]) {
        imports.push(fromMatch[1]);
      }
    }
    for (let i = node.childCount - 1; i >= 0; i -= 1) {
      const child = node.child(i);
      if (child) {
        stack.push(child);
      }
    }
  }
  return imports;
}

export async function parsePythonFile(filePath: string, workspaceRoot: string): Promise<FileParseResult> {
  const source = await fs.readFile(filePath, "utf8");
  const result = emptyParseResult(filePath, "python", source);
  const normalizedPath = normalizePath(filePath);
  const moduleName = toModuleName(normalizedPath, normalizePath(workspaceRoot));
  const fileNodeId = `file:${normalizedPath}`;

  let tree: Parser.Tree;
  try {
    tree = parser.parse(source);
  } catch (error) {
    result.parseErrors.push(String(error));
    return result;
  }

  const localByName = new Map<string, SymbolDefinition>();
  const functionNodeToSymbolId = new Map<number, string>();

  const addSymbol = (name: string, kind: "function" | "class") => (capture: Parser.QueryCapture) => {
    const node = capture.node;
    const symbolId = `symbol:${normalizedPath}:${kind}:${name}:${node.startPosition.row}:${node.startPosition.column}`;
    const symbol: SymbolDefinition = {
      id: symbolId,
      name,
      kind,
      language: "python",
      filePath: normalizedPath,
      qualifiedName: `${moduleName}.${name}`,
      rangeStart: pos(node.startPosition.row, node.startPosition.column),
      rangeEnd: pos(node.endPosition.row, node.endPosition.column),
    };
    result.symbols.push(symbol);
    localByName.set(name, symbol);
    if (kind === "function") {
      const enclosingFunction = findEnclosingFunction(node);
      functionNodeToSymbolId.set((enclosingFunction ?? node).id, symbolId);
    }
    result.relations.push({
      type: "defines",
      sourceSymbolId: fileNodeId,
      targetSymbolId: symbolId,
      filePath: normalizedPath,
      confidence: 1,
    });
  };

  for (const capture of functionQuery.captures(tree.rootNode)) {
    if (capture.name === "function.name") {
      addSymbol(capture.node.text, "function")(capture);
    }
  }

  for (const capture of classQuery.captures(tree.rootNode)) {
    if (capture.name === "class.name") {
      addSymbol(capture.node.text, "class")(capture);
    }
  }

  // Extract class inheritance relationships (inherits edges)
  const classBasesCaptures = classWithBasesQuery.captures(tree.rootNode);
  let currentClassName: string | null = null;
  let currentClassSymbol: SymbolDefinition | undefined;
  for (const capture of classBasesCaptures) {
    if (capture.name === "class.name") {
      currentClassName = capture.node.text;
      currentClassSymbol = localByName.get(currentClassName);
    } else if (capture.name === "class.bases" && currentClassSymbol) {
      // Parse the argument_list node to extract base class names
      const basesNode = capture.node;
      for (let i = 0; i < basesNode.namedChildCount; i++) {
        const child = basesNode.namedChild(i);
        if (!child) continue;

        let baseName: string;
        if (child.type === "identifier") {
          baseName = child.text;
        } else if (child.type === "attribute") {
          // Handle dotted names like bar.Baz
          baseName = child.text;
        } else if (child.type === "call") {
          // Handle cases like class Foo(metaclass=ABCMeta) — skip keyword args
          continue;
        } else if (child.type === "keyword_argument") {
          // Skip keyword arguments like metaclass=ABCMeta
          continue;
        } else {
          baseName = child.text;
        }

        if (baseName) {
          const localBase = localByName.get(baseName);
          const targetQualifiedName = localBase
            ? localBase.qualifiedName
            : `${moduleName}.${baseName}`;
          result.relations.push({
            type: "inherits",
            sourceSymbolId: currentClassSymbol.id,
            targetSymbolId: localBase?.id,
            targetQualifiedName,
            filePath: normalizedPath,
            confidence: 0.9,
          });
        }
      }
    }
  }

  const imports = captureImportModules(tree.rootNode);
  result.parsedImports = imports.map((raw) => ({ raw, isRelative: raw.startsWith(".") }));

  for (const capture of callQuery.captures(tree.rootNode)) {
    if (capture.name !== "call.name" && capture.name !== "call.attr") {
      continue;
    }
    const callName = capture.node.text;
    const enclosing = findEnclosingFunction(capture.node);
    if (!enclosing) {
      continue;
    }
    const sourceId = functionNodeToSymbolId.get(enclosing.id);
    if (!sourceId) {
      continue;
    }
    const localTarget = localByName.get(callName);
    const targetQualifiedName = localTarget ? localTarget.qualifiedName : `${moduleName}.${callName}`;
    result.relations.push({
      type: "calls",
      sourceSymbolId: sourceId,
      targetSymbolId: localTarget?.id,
      targetQualifiedName,
      filePath: normalizedPath,
      confidence: localTarget ? 1 : 0.5,
    });
  }

  for (const capture of assignmentQuery.captures(tree.rootNode)) {
    if (capture.name !== "write.name") {
      continue;
    }
    const variableName = capture.node.text;
    const enclosing = findEnclosingFunction(capture.node);
    if (!enclosing) {
      continue;
    }
    const sourceId = functionNodeToSymbolId.get(enclosing.id);
    if (!sourceId) {
      continue;
    }
    result.relations.push({
      type: "writes",
      sourceSymbolId: sourceId,
      targetQualifiedName: `${moduleName}.${variableName}`,
      filePath: normalizedPath,
      confidence: 0.6,
    });
  }

  for (const capture of identifierQuery.captures(tree.rootNode)) {
    if (capture.name !== "identifier.name") {
      continue;
    }
    const parent = capture.node.parent;
    if (!parent) {
      continue;
    }
    if (parent.type === "function_definition" || parent.type === "class_definition" || parent.type === "assignment") {
      continue;
    }
    const enclosing = findEnclosingFunction(capture.node);
    if (!enclosing) {
      continue;
    }
    const sourceId = functionNodeToSymbolId.get(enclosing.id);
    if (!sourceId) {
      continue;
    }
    result.relations.push({
      type: "reads",
      sourceSymbolId: sourceId,
      targetQualifiedName: `${moduleName}.${capture.node.text}`,
      filePath: normalizedPath,
      confidence: 0.4,
    });
  }

  result.hash = hashContent(source);
  return result;
}
