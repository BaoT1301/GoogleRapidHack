#!/usr/bin/env bash
# mcp-sh-validate-workspace.sh
# Fixture: exercises the validate_workspace() function from mcp.sh.
#
# Usage:
#   bash mcp-sh-validate-workspace.sh <case>
#
# Cases:
#   existing   — WORKSPACE_PATH points at a real dir  → exit 0, prints "exit:0"
#   missing    — WORKSPACE_PATH points at a non-existent dir → exit 1, prints "exit:1"
#   default    — no .env.mcp present, default "." resolves to COMPOSE_DIR → exit 0

set -euo pipefail

CASE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# mcp.sh lives 5 levels up from this fixtures dir:
#   fixtures → __tests__ → src → mcp-context-manager → services → repo root
MCP_SH="$(cd "$SCRIPT_DIR/../../../../.." && pwd)/mcp.sh"

if [[ ! -f "$MCP_SH" ]]; then
  echo "ERROR: cannot find mcp.sh at $MCP_SH" >&2
  exit 99
fi

# ── Extract helper function definitions from mcp.sh ──────────────────────────
source_helpers() {
  awk '
    /^env_file_flag\(\)/{p=1}
    /^validate_workspace\(\)/{p=1}
    p{print}
    p && /^\}$/{p=0}
  ' "$MCP_SH"
}

# Set COMPOSE_DIR to the repo root (same value mcp.sh sets at startup).
COMPOSE_DIR="$(cd "$SCRIPT_DIR/../../../../.." && pwd)"

# Eval the extracted function definitions into the current shell.
eval "$(source_helpers)"

# ── Run the requested test case ───────────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

case "$CASE" in
  existing)
    # .env.mcp points at a real directory → validate_workspace must exit 0.
    ENV_FILE="$TMP_DIR/.env.mcp"
    echo "WORKSPACE_PATH=$TMP_DIR" > "$ENV_FILE"
    validate_workspace
    echo "exit:0"
    ;;
  missing)
    # .env.mcp points at a non-existent path → validate_workspace must exit 1.
    MISSING="$TMP_DIR/does-not-exist"
    ENV_FILE="$TMP_DIR/.env.mcp"
    echo "WORKSPACE_PATH=$MISSING" > "$ENV_FILE"
    if validate_workspace 2>/dev/null; then
      echo "ERROR: expected exit 1 but got 0" >&2
      exit 2
    fi
    echo "exit:1"
    ;;
  default)
    # No .env.mcp → default "." resolves relative to COMPOSE_DIR (repo root).
    ENV_FILE="$TMP_DIR/nonexistent.env"   # file that does not exist
    validate_workspace
    echo "exit:0"
    ;;
  *)
    echo "Unknown case: $CASE" >&2
    echo "Usage: $0 <existing|missing|default>" >&2
    exit 98
    ;;
esac
