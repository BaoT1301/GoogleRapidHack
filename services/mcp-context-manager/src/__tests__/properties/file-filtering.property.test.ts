// Feature: 3d-codebase-globe-visualizer, Property 5: File Extension Filtering
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { detectLanguage } from "../../parsers/common.js";

describe("Property 5: File Extension Filtering", () => {
  const allowedExtensions = [".py", ".ts", ".tsx", ".js", ".jsx"] as const;
  const disallowedExtensions = [
    ".css",
    ".html",
    ".sql",
    ".sh",
    ".md",
    ".json",
    ".yaml",
    ".txt",
    ".svg",
    ".png",
  ] as const;

  // Arbitrary for a valid directory prefix (e.g., "src/utils/", "backend/app/models/")
  const arbDirPrefix = fc
    .array(
      fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_-]{0,15}$/),
      { minLength: 0, maxLength: 4 },
    )
    .map((parts) => (parts.length > 0 ? parts.join("/") + "/" : ""));

  // Arbitrary for a valid filename stem (no extension)
  const arbFilenameStem = fc.stringMatching(/^[a-zA-Z_][a-zA-Z0-9_]{0,20}$/);

  it("should return 'python' or 'typescript' for allowed extensions", () => {
    const arbAllowedExt = fc.constantFrom(...allowedExtensions);
    const arbAllowedPath = fc.tuple(arbDirPrefix, arbFilenameStem, arbAllowedExt).map(
      ([dir, stem, ext]) => `${dir}${stem}${ext}`,
    );

    fc.assert(
      fc.property(arbAllowedPath, (filePath) => {
        const language = detectLanguage(filePath);
        expect(language).not.toBeNull();
        if (filePath.endsWith(".py")) {
          expect(language).toBe("python");
        } else {
          expect(language).toBe("typescript");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("should return null for disallowed extensions", () => {
    const arbDisallowedExt = fc.constantFrom(...disallowedExtensions);
    const arbDisallowedPath = fc.tuple(arbDirPrefix, arbFilenameStem, arbDisallowedExt).map(
      ([dir, stem, ext]) => `${dir}${stem}${ext}`,
    );

    fc.assert(
      fc.property(arbDisallowedPath, (filePath) => {
        const language = detectLanguage(filePath);
        expect(language).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("should correctly partition all generated paths by extension type", () => {
    const arbAnyExt = fc.constantFrom(...allowedExtensions, ...disallowedExtensions);
    const arbAnyPath = fc.tuple(arbDirPrefix, arbFilenameStem, arbAnyExt).map(
      ([dir, stem, ext]) => `${dir}${stem}${ext}`,
    );

    fc.assert(
      fc.property(arbAnyPath, (filePath) => {
        const language = detectLanguage(filePath);
        const isAllowed = allowedExtensions.some((ext) => filePath.endsWith(ext));
        if (isAllowed) {
          expect(language).not.toBeNull();
        } else {
          expect(language).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
