export type ParseOrchOutputResult =
  | { ok: true; output: unknown }
  | { ok: false; error: string };

const ORCH_OUTPUT_MARKER = "<!-- orch:output -->";

export function parseOrchOutput(text: string): ParseOrchOutputResult {
  const markerIndex = text.lastIndexOf(ORCH_OUTPUT_MARKER);

  if (markerIndex === -1) {
    return { ok: false, error: "Missing orch output marker" };
  }

  const afterMarker = text.slice(markerIndex + ORCH_OUTPUT_MARKER.length);
  const jsonText = extractFirstJsonObject(afterMarker);

  if (jsonText === null) {
    return { ok: false, error: "Missing JSON object after orch output marker" };
  }

  try {
    return { ok: true, output: JSON.parse(jsonText) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Malformed JSON output"
    };
  }
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");

  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

/*
Examples:

parseOrchOutput('noise <!-- orch:output --> {"status":"ready"} trailing')
// -> { ok: true, output: { status: "ready" } }

parseOrchOutput('<!-- orch:output --> {bad json}')
// -> { ok: false, error: string }

parseOrchOutput('no marker')
// -> { ok: false, error: "Missing orch output marker" }
*/
