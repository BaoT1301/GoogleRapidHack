import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

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

/**
 * Convert a file path to a dot-separated module name.
 * e.g. "frontend/src/utils/helpers.ts" → "frontend.src.utils.helpers"
 */
function toModuleName(filePath: string, workspaceRoot: string): string {
  const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, "/");
  return rel.replace(/\.(tsx?|jsx?)$/, "").replace(/\//g, ".");
}

/**
 * Get 1-based line and column from a position in the source file.
 * Uses ts.getLineAndCharacterOfPosition for accuracy.
 */
function getRange(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { rangeStart: { line: number; column: number }; rangeEnd: { line: number; column: number } } {
  const start = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile));
  const end = ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd());
  return {
    rangeStart: pos(start.line, start.character),
    rangeEnd: pos(end.line, end.character),
  };
}

/**
 * Walk up the AST to find the nearest enclosing function-like declaration.
 * Returns the node if found, null otherwise.
 */
function findEnclosingFunction(node: ts.Node): ts.Node | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isArrowFunction(current) ||
      ts.isFunctionExpression(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Walk up the AST to find the nearest enclosing class declaration.
 */
function findEnclosingClass(node: ts.Node): ts.ClassDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isClassDeclaration(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Get the name of a function-like node for symbol tracking.
 * Returns null if the function is anonymous and not assigned to a variable.
 */
function getFunctionName(node: ts.Node): string | null {
  // function foo() {}
  if (ts.isFunctionDeclaration(node)) {
    return node.name?.text ?? null;
  }

  // class method: methodName() {}
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  // constructor
  if (ts.isConstructorDeclaration(node)) {
    return "constructor";
  }

  // get/set accessor
  if (
    (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) &&
    ts.isIdentifier(node.name)
  ) {
    return node.name.text;
  }

  // const foo = () => {} or const foo = function() {}
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.parent &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }

  // class property: foo = () => {}
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.parent &&
    ts.isPropertyDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }

  return null;
}

export async function parseTypeScriptFile(
  filePath: string,
  workspaceRoot: string,
): Promise<FileParseResult> {
  const source = await fs.readFile(filePath, "utf8");
  const normalizedPath = normalizePath(filePath);
  const result = emptyParseResult(filePath, "typescript", source);

  const rel = normalizePath(path.relative(workspaceRoot, normalizedPath));
  const moduleName = rel.replace(/\.(tsx?|jsx?)$/, "").replace(/\//g, ".");

  const fileNodeId = `file:${normalizedPath}`;

  // Create the module symbol (preserving existing behavior)
  const moduleSymbolId = `symbol:${normalizedPath}:module:0:0`;
  result.symbols.push({
    id: moduleSymbolId,
    name: path.basename(filePath),
    qualifiedName: moduleName,
    kind: "module",
    language: "typescript",
    filePath: normalizedPath,
    rangeStart: { line: 1, column: 1 },
    rangeEnd: { line: 1, column: 1 },
  });
  result.relations.push({
    type: "defines",
    sourceSymbolId: fileNodeId,
    targetSymbolId: moduleSymbolId,
    filePath: normalizedPath,
    confidence: 1,
  });

  // Parse the source file using the TypeScript compiler API
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TSX,
  );

  // Track local symbols for cross-referencing
  const localByName = new Map<string, SymbolDefinition>();
  // Map AST node positions to symbol IDs for enclosing-function lookups
  const functionNodeToSymbolId = new Map<number, string>();
  // Track which identifiers are definitions (to exclude from reads)
  const definitionPositions = new Set<number>();
  // Track which identifiers are call targets (to exclude from reads)
  const callPositions = new Set<number>();

  /**
   * Register a symbol (function or class) and its "defines" relation.
   */
  function addSymbol(
    name: string,
    kind: "function" | "class",
    node: ts.Node,
    qualifiedNameOverride?: string,
  ): SymbolDefinition {
    const range = getRange(sourceFile, node);
    const startLine = range.rangeStart.line;
    const startCol = range.rangeStart.column;
    const symbolId = `symbol:${normalizedPath}:${kind}:${name}:${startLine}:${startCol}`;
    const qName = qualifiedNameOverride ?? `${moduleName}.${name}`;

    const symbol: SymbolDefinition = {
      id: symbolId,
      name,
      kind,
      language: "typescript",
      filePath: normalizedPath,
      qualifiedName: qName,
      rangeStart: range.rangeStart,
      rangeEnd: range.rangeEnd,
    };

    result.symbols.push(symbol);
    localByName.set(name, symbol);

    if (kind === "function") {
      functionNodeToSymbolId.set(node.pos, symbolId);
    }

    result.relations.push({
      type: "defines",
      sourceSymbolId: fileNodeId,
      targetSymbolId: symbolId,
      filePath: normalizedPath,
      confidence: 1,
    });

    return symbol;
  }

  /**
   * Get the symbol ID for the enclosing function of a given node.
   */
  function getEnclosingSymbolId(node: ts.Node): string | undefined {
    const enclosing = findEnclosingFunction(node);
    if (!enclosing) return undefined;
    return functionNodeToSymbolId.get(enclosing.pos);
  }

  // ── Pass 1: Extract symbols (functions, classes, methods) ──

  function extractSymbols(node: ts.Node): void {
    // ── Function declarations: function foo() {} / async function foo() {} ──
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      definitionPositions.add(node.name.getStart(sourceFile));
      addSymbol(name, "function", node);
    }

    // ── Class declarations: class Foo {} / abstract class Foo {} ──
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      definitionPositions.add(node.name.getStart(sourceFile));
      const classSymbol = addSymbol(className, "class", node);

      // Extract inheritance relationships (extends / implements)
      if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
          if (
            clause.token === ts.SyntaxKind.ExtendsKeyword ||
            clause.token === ts.SyntaxKind.ImplementsKeyword
          ) {
            for (const typeExpr of clause.types) {
              let baseName: string | null = null;
              if (ts.isIdentifier(typeExpr.expression)) {
                baseName = typeExpr.expression.text;
              } else if (ts.isPropertyAccessExpression(typeExpr.expression)) {
                // Handle dotted names like ns.BaseClass
                baseName = typeExpr.expression.getText(sourceFile);
              }
              if (baseName) {
                const localBase = localByName.get(baseName);
                const targetQualifiedName = localBase
                  ? localBase.qualifiedName
                  : `${moduleName}.${baseName}`;
                result.relations.push({
                  type: "inherits",
                  sourceSymbolId: classSymbol.id,
                  targetSymbolId: localBase?.id,
                  targetQualifiedName,
                  filePath: normalizedPath,
                  confidence: 0.9,
                });
              }
            }
          }
        }
      }

      // Extract methods within the class
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          const methodName = member.name.text;
          definitionPositions.add(member.name.getStart(sourceFile));
          const qualifiedName = `${moduleName}.${className}.${methodName}`;
          const sym = addSymbol(methodName, "function", member, qualifiedName);
          functionNodeToSymbolId.set(member.pos, sym.id);
        }

        if (ts.isConstructorDeclaration(member)) {
          const qualifiedName = `${moduleName}.${className}.constructor`;
          const sym = addSymbol("constructor", "function", member, qualifiedName);
          functionNodeToSymbolId.set(member.pos, sym.id);
        }

        if (
          (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) &&
          ts.isIdentifier(member.name)
        ) {
          const accessorName = member.name.text;
          definitionPositions.add(member.name.getStart(sourceFile));
          const qualifiedName = `${moduleName}.${className}.${accessorName}`;
          const sym = addSymbol(accessorName, "function", member, qualifiedName);
          functionNodeToSymbolId.set(member.pos, sym.id);
        }

        // Class property with arrow function: filter = (x) => x
        if (
          ts.isPropertyDeclaration(member) &&
          ts.isIdentifier(member.name) &&
          member.initializer &&
          (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
        ) {
          const propName = member.name.text;
          definitionPositions.add(member.name.getStart(sourceFile));
          const qualifiedName = `${moduleName}.${className}.${propName}`;
          const sym = addSymbol(propName, "function", member.initializer, qualifiedName);
          functionNodeToSymbolId.set(member.initializer.pos, sym.id);
        }
      }
    }

    // ── Variable declarations with arrow/function expressions ──
    // const foo = () => {} / const foo = function() {} / const foo = async () => {}
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const name = node.name.text;
      definitionPositions.add(node.name.getStart(sourceFile));
      const sym = addSymbol(name, "function", node.initializer);
      functionNodeToSymbolId.set(node.initializer.pos, sym.id);
    }

    ts.forEachChild(node, extractSymbols);
  }

  extractSymbols(sourceFile);

  // ── Pass 2: Extract imports, exports, calls, reads, writes ──

  function extractRelations(node: ts.Node): void {
    // ── Imports ──
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const rawImport = node.moduleSpecifier.text;
      result.parsedImports.push({ raw: rawImport, isRelative: rawImport.startsWith(".") });
    }

    // ── Re-exports: export { foo } from './bar' ──
    if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        result.parsedImports.push({
          raw: node.moduleSpecifier.text,
          isRelative: node.moduleSpecifier.text.startsWith("."),
        });
      }
      result.relations.push({
        type: "exports",
        sourceSymbolId: moduleSymbolId,
        targetSymbolId: moduleSymbolId,
        filePath: normalizedPath,
        confidence: 1,
      });
    }

    // ── Export keyword on declarations ──
    if (
      !ts.isExportDeclaration(node) &&
      ts.canHaveModifiers(node) &&
      ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      result.relations.push({
        type: "exports",
        sourceSymbolId: moduleSymbolId,
        targetSymbolId: moduleSymbolId,
        filePath: normalizedPath,
        confidence: 1,
      });
    }

    // ── Call expressions: foo(), this.bar(), obj.method() ──
    if (ts.isCallExpression(node)) {
      let callName: string | null = null;

      if (ts.isIdentifier(node.expression)) {
        // foo()
        callName = node.expression.text;
        callPositions.add(node.expression.getStart(sourceFile));
      } else if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
        // obj.method() or this.method()
        callName = node.expression.name.text;
        callPositions.add(node.expression.name.getStart(sourceFile));
      }

      if (callName) {
        const sourceId = getEnclosingSymbolId(node);
        if (sourceId) {
          const localTarget = localByName.get(callName);
          const targetQualifiedName = localTarget
            ? localTarget.qualifiedName
            : `${moduleName}.${callName}`;

          result.relations.push({
            type: "calls",
            sourceSymbolId: sourceId,
            targetSymbolId: localTarget?.id,
            targetQualifiedName,
            filePath: normalizedPath,
            confidence: localTarget ? 1 : 0.5,
          });
        }
      }
    }

    // ── new Foo() — instantiation ──
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
      const className = node.expression.text;
      callPositions.add(node.expression.getStart(sourceFile));
      const sourceId = getEnclosingSymbolId(node);
      if (sourceId) {
        const localTarget = localByName.get(className);
        result.relations.push({
          type: "calls",
          sourceSymbolId: sourceId,
          targetSymbolId: localTarget?.id,
          targetQualifiedName: localTarget
            ? localTarget.qualifiedName
            : `${moduleName}.${className}`,
          filePath: normalizedPath,
          confidence: localTarget ? 1 : 0.5,
        });
      }
    }

    // ── Variable writes: const x = ..., let x = ..., x = ... ──
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      // Skip if this is a function/arrow assignment (already handled as function symbol)
      if (
        !node.initializer ||
        (!ts.isArrowFunction(node.initializer) && !ts.isFunctionExpression(node.initializer))
      ) {
        const varName = node.name.text;
        definitionPositions.add(node.name.getStart(sourceFile));
        const sourceId = getEnclosingSymbolId(node);
        if (sourceId) {
          result.relations.push({
            type: "writes",
            sourceSymbolId: sourceId,
            targetQualifiedName: `${moduleName}.${varName}`,
            filePath: normalizedPath,
            confidence: 0.6,
          });
        }
      }
    }

    // Assignment expressions: x = ...
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.EqualsToken &&
      node.operatorToken.kind <= ts.SyntaxKind.CaretEqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const varName = node.left.text;
      definitionPositions.add(node.left.getStart(sourceFile));
      const sourceId = getEnclosingSymbolId(node);
      if (sourceId) {
        result.relations.push({
          type: "writes",
          sourceSymbolId: sourceId,
          targetQualifiedName: `${moduleName}.${varName}`,
          filePath: normalizedPath,
          confidence: 0.6,
        });
      }
    }

    ts.forEachChild(node, extractRelations);
  }

  extractRelations(sourceFile);

  // ── Pass 3: Extract reads (identifiers that are not definitions, calls, or imports) ──

  function extractReads(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      const startPos = node.getStart(sourceFile);

      // Skip if this is a definition, call target, or part of import/export/type declarations
      if (definitionPositions.has(startPos) || callPositions.has(startPos)) {
        return;
      }

      const parent = node.parent;
      if (!parent) return;

      // Skip identifiers that are part of declarations, imports, exports, types
      if (
        ts.isImportDeclaration(parent) ||
        ts.isImportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isExportSpecifier(parent) ||
        ts.isExportDeclaration(parent) ||
        ts.isFunctionDeclaration(parent) ||
        ts.isClassDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isParameter(parent) ||
        ts.isTypeReferenceNode(parent) ||
        ts.isInterfaceDeclaration(parent) ||
        ts.isTypeAliasDeclaration(parent) ||
        ts.isEnumDeclaration(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isMethodSignature(parent) ||
        ts.isNamespaceImport(parent)
      ) {
        return;
      }

      // Skip property access names (the `.bar` in `foo.bar`)
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        return;
      }

      const sourceId = getEnclosingSymbolId(node);
      if (!sourceId) return;

      result.relations.push({
        type: "reads",
        sourceSymbolId: sourceId,
        targetQualifiedName: `${moduleName}.${node.text}`,
        filePath: normalizedPath,
        confidence: 0.4,
      });
    }

    ts.forEachChild(node, extractReads);
  }

  extractReads(sourceFile);

  result.hash = hashContent(source);
  return result;
}
