# Agent integration

Sift can be integrated with AI coding agents (Claude Code, Claude Desktop, or OpenCode) so your AI assistant can read and manage your Obsidian tasks.

## Integration types

Sift supports two integration approaches:

1. **MCP Server** (for Claude Code & Claude Desktop) - A Model Context Protocol server that provides sift tools
2. **OpenCode Skill** (for OpenCode) - An agent skill + custom tools

All integrations provide the same five core tools:
- `sift_list` - List and filter tasks
- `sift_next` - Get priority tasks
- `sift_summary` - Quick status overview
- `sift_add` - Add new tasks
- `sift_done` - Complete tasks

## Quick setup

### For Claude Code & Claude Desktop

```bash
# 1. Build everything (CLI + MCP server)
npm install
npm run build

# 2. Configure your vault (if not already done)
node packages/cli/dist/index.js init "/path/to/your/vault"
# Or if globally linked: sift init "/path/to/your/vault"

# 3. Install MCP server configuration
./scripts/install-agent-claude.sh

# 4. Follow the printed instructions to:
#    - Add MCP config to Claude Desktop (if using)
#    - Note the npx command for Claude Code (if using)
```

### For OpenCode

```bash
# 1. Build the CLI (the tools call it under the hood)
npm install
npm run build

# 2. Make sure sift is on your PATH
npm link --workspace=packages/cli

# 3. Configure your vault (if not already done)
sift init "/path/to/your/vault"

# 4. Install the skill and tools
./scripts/install-agent.sh

# 5. Restart OpenCode
```

The OpenCode install script copies files to:
- `~/.config/opencode/skills/sift/SKILL.md`
- `~/.config/opencode/tools/sift.ts`

## Keeping things up to date

The canonical source files are tracked in the repo:

- [`packages/agent-skill/mcp-server.ts`](../packages/agent-skill/mcp-server.ts) -- MCP server for Claude Code/Desktop
- [`packages/agent-skill/SKILL.md`](../packages/agent-skill/SKILL.md) -- OpenCode skill definition
- [`packages/agent-skill/tools/sift.ts`](../packages/agent-skill/tools/sift.ts) -- OpenCode custom tools

When you make changes:

**For MCP server (Claude Code/Desktop):**
```bash
npm run build --workspace=packages/agent-skill
# Then restart Claude Desktop or re-run the npx command
```

**For OpenCode:**
```bash
./scripts/install-agent.sh
# Then restart OpenCode
```

## How it works

### MCP Server (Claude Code & Claude Desktop)

The MCP server (`packages/agent-skill/mcp-server.ts`) implements the Model Context Protocol to expose sift tools to Claude.

When built and configured:
- **Claude Desktop**: Runs as a local stdio server defined in `claude_desktop_config.json`
- **Claude Code**: Can be launched via npx or configured in your MCP settings

The server provides five tools that call the `sift` CLI under the hood. It resolves the CLI in this order:
1. `SIFT_CLI_PATH` environment variable (absolute path to built CLI)
2. `sift` on PATH (if globally linked)

The install script (`./scripts/install-agent-claude.sh`) helps set up the configuration with the correct paths.

### OpenCode Skill

#### The skill

The skill file (`SKILL.md`) is a markdown file with YAML frontmatter that OpenCode discovers on startup. It tells the agent:

- What sift does
- Which custom tools are available (`sift_list`, `sift_next`, `sift_summary`, `sift_add`, `sift_done`)
- The Obsidian Tasks emoji format
- When to activate (e.g., "what should I work on?", "add a task", "remind me to...")
- Guidelines for behavior (how to format output, when to use `due` vs `scheduled`, etc.)

### The custom tools

The tools file (`sift.ts`) defines five OpenCode custom tools that call the `sift` CLI:

| Tool name | Description |
|-----------|-------------|
| `sift_list` | List open tasks, with optional search/priority/date filters |
| `sift_next` | Get the most important tasks sorted by urgency |
| `sift_summary` | Quick overview of task status |
| `sift_add` | Add a new task to today's daily note |
| `sift_done` | Mark a task as complete by searching its description |

The tools resolve the CLI in this order:
1. `SIFT_CLI_PATH` environment variable (absolute path to the built CLI entry point)
2. `sift` on PATH (if globally linked)

If sift is on your PATH (via `npm link`), no env var is needed.

## Usage

Once set up, you can use natural language with your AI assistant:

- "What's on my plate?"
- "What should I work on next?"
- "Add a task to review the PR by Friday"
- "Mark the architecture doc task as done"
- "Show me my overdue tasks"

The agent will use the sift tools to interact with your Obsidian vault.

## Configuration

### Claude Desktop

MCP servers are configured in `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "sift": {
      "command": "node",
      "args": ["/path/to/sift/packages/agent-skill/dist/mcp-server.js"],
      "env": {
        "SIFT_CLI_PATH": "/path/to/sift/packages/cli/dist/index.js"
      }
    }
  }
}
```

The `SIFT_CLI_PATH` env var is optional if `sift` is on your PATH.

### Claude Code

For Claude Code, you can run the MCP server via npx or add it to your MCP configuration. The install script provides the exact command.

### OpenCode

You can control access to the sift skill in your `opencode.json`:

```json
{
  "permission": {
    "skill": {
      "sift": "allow"
    }
  }
}
```

## Manual setup

### For MCP Server (Claude Code/Desktop)

Build the MCP server:
```bash
npm run build --workspace=packages/agent-skill
```

For Claude Desktop, manually add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "sift": {
      "command": "node",
      "args": ["/absolute/path/to/sift/packages/agent-skill/dist/mcp-server.js"]
    }
  }
}
```

### For OpenCode

Copy the files manually:
```bash
mkdir -p ~/.config/opencode/skills/sift
cp packages/agent-skill/SKILL.md ~/.config/opencode/skills/sift/SKILL.md
cp packages/agent-skill/tools/sift.ts ~/.config/opencode/tools/sift.ts
```

### Setting SIFT_CLI_PATH

If sift isn't on your PATH, set `SIFT_CLI_PATH` to the absolute path of the built CLI:

```bash
export SIFT_CLI_PATH="/path/to/sift/packages/cli/dist/index.js"
```

For Claude Desktop, add it to the `env` section of the MCP server config (see Configuration section above).
