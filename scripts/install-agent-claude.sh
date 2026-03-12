#!/usr/bin/env bash
set -euo pipefail

# Install sift MCP server and skill for Claude Code and Claude Desktop.
#
# This script automatically configures:
# - MCP server in Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
# - MCP server in Claude Code:    ~/.claude.json (global MCP server config)
# - Skill for Claude Code:        ~/.claude/skills/sift/SKILL.md
#
# Run from the repo root:
#   ./scripts/install-agent-claude.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER_PATH="$REPO_ROOT/packages/agent-skill/dist/mcp-server.js"

echo "Installing sift MCP server and skill for Claude Code and Claude Desktop..."

# Check if MCP server is built
if [ ! -f "$MCP_SERVER_PATH" ]; then
    echo ""
    echo "  ERROR: MCP server not built yet. Run 'npm run build' first."
    exit 1
fi

# Determine if we need SIFT_CLI_PATH
if command -v sift &> /dev/null; then
    echo "  sift is on your PATH -- MCP server will use it directly."
    SIFT_CLI_PATH=""
else
    CLI_PATH="$REPO_ROOT/packages/cli/dist/index.js"
    if [ -f "$CLI_PATH" ]; then
        SIFT_CLI_PATH="$CLI_PATH"
        echo "  sift is NOT on your PATH."
        echo "  MCP server will use: $SIFT_CLI_PATH"
    else
        echo ""
        echo "  ERROR: CLI not built yet. Run 'npm run build' first."
        exit 1
    fi
fi

# Resolve the absolute path to the current node binary.
# This ensures MCP servers use the same Node version that's active at install
# time, regardless of how the host app resolves PATH (e.g., nvm shims may not
# be available to Claude Desktop).
NODE_PATH="$(command -v node)"
if [ -L "$NODE_PATH" ]; then
    # Follow symlinks (e.g., nvm or pnpm shims)
    NODE_PATH="$(readlink -f "$NODE_PATH" 2>/dev/null || python3 -c "import os; print(os.path.realpath('$NODE_PATH'))")"
fi
echo "  Using node: $NODE_PATH ($(node --version))"

# Build the JSON snippet for the sift MCP server entry
if [ -n "$SIFT_CLI_PATH" ]; then
    MCP_SERVER_JSON=$(node -e "
        console.log(JSON.stringify({
            command: '$NODE_PATH',
            args: ['$MCP_SERVER_PATH'],
            env: { SIFT_CLI_PATH: '$SIFT_CLI_PATH' }
        }, null, 2));
    ")
else
    MCP_SERVER_JSON=$(node -e "
        console.log(JSON.stringify({
            command: '$NODE_PATH',
            args: ['$MCP_SERVER_PATH']
        }, null, 2));
    ")
fi

# ── Claude Desktop ─────────────────────────────────────────────────────────────

if [[ "$OSTYPE" == "darwin"* ]]; then
    CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
    mkdir -p "$(dirname "$CLAUDE_DESKTOP_CONFIG")"

    if [ ! -f "$CLAUDE_DESKTOP_CONFIG" ]; then
        echo '{"mcpServers":{}}' > "$CLAUDE_DESKTOP_CONFIG"
    fi

    node -e "
        const fs = require('fs');
        const config = JSON.parse(fs.readFileSync('$CLAUDE_DESKTOP_CONFIG', 'utf8'));
        if (!config.mcpServers) config.mcpServers = {};
        config.mcpServers.sift = $MCP_SERVER_JSON;
        fs.writeFileSync('$CLAUDE_DESKTOP_CONFIG', JSON.stringify(config, null, 2));
    "

    echo "  Claude Desktop: $CLAUDE_DESKTOP_CONFIG"
fi

# ── Claude Code ────────────────────────────────────────────────────────────────

CLAUDE_CODE_CONFIG="$HOME/.claude.json"

if [ ! -f "$CLAUDE_CODE_CONFIG" ]; then
    echo '{}' > "$CLAUDE_CODE_CONFIG"
fi

node -e "
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('$CLAUDE_CODE_CONFIG', 'utf8'));
    if (!config.mcpServers) config.mcpServers = {};
    config.mcpServers.sift = $MCP_SERVER_JSON;
    fs.writeFileSync('$CLAUDE_CODE_CONFIG', JSON.stringify(config, null, 2));
"

echo "  Claude Code:    $CLAUDE_CODE_CONFIG"

# ── Claude Code Skill ──────────────────────────────────────────────────────────

SKILL_SRC="$REPO_ROOT/packages/agent-skill/SKILL.md"
SKILL_DEST="$HOME/.claude/skills/sift/SKILL.md"

mkdir -p "$(dirname "$SKILL_DEST")"
cp "$SKILL_SRC" "$SKILL_DEST"
echo "  Skill:          $SKILL_DEST"

echo ""
echo "Done. Restart Claude Desktop and/or Claude Code to pick up the changes."
