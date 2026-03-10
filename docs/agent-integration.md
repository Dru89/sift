# Agent integration

Sift can be integrated with AI coding agents (Claude Code, Claude Desktop, or OpenCode) so your AI assistant can read and manage your Obsidian tasks.

## Integration types

Sift supports two integration approaches:

1. **MCP Server** (for Claude Code & Claude Desktop) - A Model Context Protocol server that provides sift tools
2. **OpenCode Skill** (for OpenCode) - An agent skill + custom tools

All integrations provide these core tools:
- `sift_list` - List and filter tasks
- `sift_next` - Get priority tasks
- `sift_summary` - Quick status overview
- `sift_add` - Add new tasks (to daily note or project)
- `sift_find` - Search tasks without modifying them
- `sift_done` - Complete tasks (by search or precise file:line)
- `sift_projects` - List vault projects
- `sift_project_create` / `sift_projectCreate` - Create a new project
- `sift_project_path` / `sift_projectPath` - Get a project's file path
- `sift_note` / `sift_addNote` - Add freeform notes

Note: Tool names use underscores in MCP (e.g., `sift_project_create`) and camelCase in OpenCode (e.g., `sift_projectCreate`).

## Quick setup

### For Claude Code & Claude Desktop

```bash
# 1. Build everything (CLI + MCP server)
npm install
npm run build

# 2. Link sift globally so the MCP server can find it
npm link --workspace=packages/cli

# 3. Configure your vault (if not already done)
sift init "/path/to/your/vault"

# 4. Run the install script -- it writes config for both Claude Desktop and Claude Code
./scripts/install-agent-claude.sh

# 5. Restart Claude Desktop and/or Claude Code
```

The install script automatically updates:
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Claude Code: `~/.claude.json`

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
# Then restart Claude Desktop and/or Claude Code
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
- **Claude Desktop**: Runs as a local stdio server defined in `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Code**: Runs as a local stdio server defined in `~/.claude.json`

The server provides tools that call the `sift` CLI under the hood. It resolves the CLI in this order:
1. `SIFT_CLI_PATH` environment variable (absolute path to built CLI)
2. `sift` on PATH (if globally linked)

The install script (`./scripts/install-agent-claude.sh`) helps set up the configuration with the correct paths.

### OpenCode Skill

#### The skill

The skill file (`SKILL.md`) is a markdown file with YAML frontmatter that OpenCode discovers on startup. It tells the agent:

- What sift does
- Which custom tools are available
- The Obsidian Tasks emoji format
- When to activate (e.g., "what should I work on?", "add a task", "remind me to...")
- Guidelines for behavior (how to format output, project-aware task placement, safe task completion, etc.)

### The custom tools

The tools file (`sift.ts`) defines OpenCode custom tools that call the `sift` CLI:

| Tool name | Description |
|-----------|-------------|
| `sift_list` | List open tasks, with optional search/priority/date filters |
| `sift_next` | Get the most important tasks sorted by urgency |
| `sift_summary` | Quick overview of task status |
| `sift_add` | Add a new task to today's daily note or a project |
| `sift_find` | Search tasks without modifying them |
| `sift_done` | Mark a task as complete (by search or by file:line) |
| `sift_projects` | List all projects in the vault |
| `sift_projectCreate` | Create a new project from template |
| `sift_projectPath` | Get the file path for a project |
| `sift_addNote` | Add a freeform note to daily note or project |

The tools resolve the CLI in this order:
1. `SIFT_CLI_PATH` environment variable (absolute path to the built CLI entry point)
2. `sift` on PATH (if globally linked)

If sift is on your PATH (via `npm link`), no env var is needed.

## Usage

Once set up, you can use natural language with your AI assistant:

- "What's on my plate?"
- "What should I work on next?"
- "Add a task to review the PR by Friday"
- "Add a task to the MP3 Parser project to design the API"
- "Mark the architecture doc task as done"
- "Show me my overdue tasks"
- "What projects do I have?"
- "Add a note to MP3 Parser that we decided to use ID3v2.4"

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

MCP servers are configured globally in `~/.claude.json`:

```json
{
  "mcpServers": {
    "sift": {
      "command": "node",
      "args": ["/path/to/sift/packages/agent-skill/dist/mcp-server.js"]
    }
  }
}
```

The `install-agent-claude.sh` script writes this automatically.

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

For Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
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

For Claude Code, add to `~/.claude.json`:
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
