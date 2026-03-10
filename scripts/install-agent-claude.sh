#!/usr/bin/env bash
set -euo pipefail

# Install sift MCP server for Claude Code and Claude Desktop.
#
# This script adds the sift MCP server configuration to:
# - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
# - Claude Code: Uses npx to run the MCP server
#
# Run from the repo root:
#   ./scripts/install-agent-claude.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MCP_SERVER_PATH="$REPO_ROOT/packages/agent-skill/dist/mcp-server.js"

echo "Installing sift MCP server for Claude Code and Claude Desktop..."

# Check if MCP server is built
if [ ! -f "$MCP_SERVER_PATH" ]; then
    echo ""
    echo "  ERROR: MCP server not built yet. Run 'npm run build' first."
    exit 1
fi

# Determine SIFT_CLI_PATH
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

# Install for Claude Desktop (macOS)
if [[ "$OSTYPE" == "darwin"* ]]; then
    CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
    CLAUDE_CONFIG_FILE="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"

    mkdir -p "$CLAUDE_CONFIG_DIR"

    # Create or update config file
    if [ -f "$CLAUDE_CONFIG_FILE" ]; then
        echo ""
        echo "  Found existing Claude Desktop config: $CLAUDE_CONFIG_FILE"
        echo ""
        echo "  Add this to your mcpServers section:"
    else
        echo ""
        echo "  Creating new Claude Desktop config: $CLAUDE_CONFIG_FILE"
        echo '{
  "mcpServers": {}
}' > "$CLAUDE_CONFIG_FILE"
    fi

    # Build the MCP server config
    if [ -n "$SIFT_CLI_PATH" ]; then
        cat <<EOF

    "sift": {
      "command": "node",
      "args": ["$MCP_SERVER_PATH"],
      "env": {
        "SIFT_CLI_PATH": "$SIFT_CLI_PATH"
      }
    }
EOF
    else
        cat <<EOF

    "sift": {
      "command": "node",
      "args": ["$MCP_SERVER_PATH"]
    }
EOF
    fi

    echo ""
    echo "  After adding this configuration, restart Claude Desktop."
fi

# Instructions for Claude Code
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "For Claude Code (CLI):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Claude Code can run the MCP server directly. Use this command:"
echo ""
if [ -n "$SIFT_CLI_PATH" ]; then
    echo "  SIFT_CLI_PATH=\"$SIFT_CLI_PATH\" node \"$MCP_SERVER_PATH\""
else
    echo "  node \"$MCP_SERVER_PATH\""
fi
echo ""
echo "Or configure it in your MCP server settings."
echo ""
echo "Done!"
