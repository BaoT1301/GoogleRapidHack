# cluster-config.json — Schema Reference

This file tells the MCP Context Manager how to group your project's files into
named clusters. The UI and graph tools use clusters to colour-code nodes and
report cross-cluster dependencies.

## Schema

```json
{
  "clusters": [
    {
      "id":    "<string>  — unique identifier, used in API responses",
      "path":  "<string>  — relative path prefix (must end with /)",
      "label": "<string>  — human-readable display name",
      "color": "<string>  — hex colour for the UI (e.g. #4A90D9)"
    }
  ]
}
```

### Required fields

| Field   | Type   | Constraints                                      |
|---------|--------|--------------------------------------------------|
| `id`    | string | Non-empty, unique within the array               |
| `path`  | string | Relative (must NOT start with `/`), ends with `/`|
| `label` | string | Non-empty                                        |
| `color` | string | Valid CSS hex colour (`#RRGGBB`)                 |

### Rules

- At least one cluster is required.
- Paths must be relative to the workspace root (`WORKSPACE_PATH`).
- When a file matches multiple cluster prefixes, the **longest prefix wins**.
- Files that match no cluster are assigned to the first cluster (default).

## Minimal starter (2 clusters)

```json
{
  "clusters": [
    { "id": "src",   "path": "src/",   "label": "Source Code", "color": "#4A90D9" },
    { "id": "tests", "path": "tests/", "label": "Tests",       "color": "#E28A4A" }
  ]
}
```

## Example — monorepo with 3 clusters

```json
{
  "clusters": [
    { "id": "frontend",  "path": "frontend/src/",  "label": "Frontend",  "color": "#4A90D9" },
    { "id": "backend",   "path": "backend/",        "label": "Backend",   "color": "#E24A4A" },
    { "id": "services",  "path": "services/",       "label": "Services",  "color": "#4AE290" }
  ]
}
```

## Further reading

See `docs/CLUSTER-CONFIG.md` for the full configuration guide, including
hot-reload behaviour and troubleshooting tips.
