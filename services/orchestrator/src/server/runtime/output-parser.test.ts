import { describe, expect, it } from "vitest";
import { parseOrchOutput } from "./output-parser";

describe("parseOrchOutput", () => {
  it("parses valid orch output JSON after the marker", () => {
    const result = parseOrchOutput(`
noise before
<!-- orch:output -->
{
  "summary": "done",
  "filesChanged": ["README.md"],
  "status": "ready_for_review"
}
trailing text
`);

    expect(result).toEqual({
      ok: true,
      output: {
        summary: "done",
        filesChanged: ["README.md"],
        status: "ready_for_review"
      }
    });
  });

  it("returns ok:false when the marker is missing", () => {
    const result = parseOrchOutput('{"status":"ready_for_review"}');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Missing orch output marker");
    }
  });

  it("returns ok:false for malformed JSON", () => {
    const result = parseOrchOutput("<!-- orch:output --> {bad json}");

    expect(result.ok).toBe(false);
  });
});
