# MCP Context Manager — Tool Authoring Cheat Sheet

Quick reference for agents and developers calling MCP tools.

---

## Glob Syntax (`file_pattern` / `file_path` parameters)

| Pattern | Meaning |
|---------|---------|
| `**/*.ts` | All `.ts` files, any depth |
| `src/**/*.ts` | All `.ts` files under `src/` |
| `*.{ts,tsx}` | `.ts` or `.tsx` in current dir |
| `src/**/*.{ts,tsx,js}` | Multiple extensions, recursive |
| `!node_modules/**` | Exclusion (prefix with `!`) |

**Common mistakes:**

- ❌ `*.ts,*.tsx` — comma-separated without braces → rejected with `INVALID_PARAMS`
- ✅ `*.{ts,tsx}` — use brace-expansion
- ❌ `/workspace/src/**/*.ts` — absolute path → rejected
- ✅ `src/**/*.ts` — always relative to workspace root

---

## Regex Syntax (`query` with `use_regex: true`)

| Goal | Pattern |
|------|---------|
| Match function keyword | `function\s+\w+` |
| Match either quote | `['"]` |
| Match literal bracket | `\[` (escape it) |
| Word boundary | `\bTODO\b` |
| Alternation | `foo\|bar` |

**Common mistakes:**

- ❌ `[a-z` — unclosed character class → hint: escape `[` as `\[` if literal
- ❌ `(foo` — unterminated group → hint: count parentheses
- ❌ `from ['\"@/bridge` — mixed quoting → use `['"]` for either-quote

---

## Path Conventions

- All `file_pattern` / `file_path` values are **relative to the workspace root**.
- The workspace root is the directory mounted as `WORKSPACE_PATH` in `.env.mcp`.
- Do not use absolute paths — they will be rejected.

---

## Zero-Result Responses

When a tool returns zero results and a pattern was provided, the response includes a `reason` field:

```json
{
  "deadSymbols": [],
  "totalScanned": 0,
  "reason": "no files matched the `file_pattern` glob \"*.ts,*.tsx\" — ..."
}
```

If `reason` is present, the glob matched no indexed files. Check:
1. The pattern is relative (not absolute).
2. Brace-expansion is used for multiple extensions.
3. The files exist in the indexed workspace.

---

## Error Response Shape

All validation errors return HTTP 400:

```json
{
  "error": "Comma in glob without brace-expansion: \"*.ts,*.tsx\". Use \"{ext1,ext2}\" instead.",
  "code": "INVALID_PARAMS",
  "retryable": false
}
```
