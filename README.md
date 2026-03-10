<p align="center">
  <img src="images/sift.png" alt="sift" width="128" height="128">
</p>

<h1 align="center">sift</h1>

<p align="center">
  Surface and manage your <a href="https://publish.obsidian.md/tasks/">Obsidian Tasks</a> from anywhere -- terminal, Raycast, or AI agent -- without opening Obsidian.
</p>

---

Sift reads your Obsidian vault directly, parses tasks in the [emoji format](https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format), and lets you query, prioritize, add, and complete tasks from multiple interfaces.

## Features

- **CLI** -- `sift summary`, `sift next`, `sift add`, `sift done`, and more
- **Raycast extension** -- search tasks, view priorities, add tasks with a form
- **AI agent integration** -- Works with Claude Code, Claude Desktop, and OpenCode for conversational task management
- **Shared core library** -- all interfaces use the same `@sift/core` package, so they always behave consistently

## Quick start

### Prerequisites

- Node.js >= 20
- An Obsidian vault using the [Obsidian Tasks](https://publish.obsidian.md/tasks/) plugin with emoji format

### Install

```bash
git clone https://github.com/dru89/sift.git
cd sift
npm install
npm run build
```

### Configure

Point sift at your vault:

```bash
node packages/cli/dist/index.js init "/path/to/your/vault"
```

This writes a config file to `~/.siftrc.json`. You can also set the `SIFT_VAULT_PATH` environment variable.

### Use the CLI

```bash
# Quick overview
sift summary

# What should I work on?
sift next

# All open tasks
sift list

# Add a task
sift add "Review the architecture doc" --priority high --due 2026-03-10

# Mark something done
sift done "architecture doc"
```

To make `sift` available globally:

```bash
npm link --workspace=packages/cli
```

### Full command reference

See [packages/cli/README.md](packages/cli/README.md).

### Set up the Raycast extension

Requires [Raycast](https://raycast.com) on macOS.

```bash
cd packages/raycast
npm install
npx ray develop
```

Raycast will prompt you to set your vault path in the extension preferences on first use. See [packages/raycast/README.md](packages/raycast/README.md) for details.

### Set up AI agent integration

Sift can be integrated with AI coding agents so your assistant can read and manage tasks conversationally. Choose the setup for your tool:

#### For Claude Code / Claude Desktop

If you use [Claude Code](https://claude.com/claude-code) (CLI) or Claude Desktop, sift runs as an MCP server.

```bash
# 1. Build the MCP server
npm install
npm run build

# 2. Install MCP server configuration
./scripts/install-agent-claude.sh
```

For Claude Desktop, this will show you the configuration to add. For Claude Code, follow the printed instructions.

#### For OpenCode

If you use [OpenCode](https://opencode.ai), sift can be added as an agent skill.

```bash
# Install the skill and custom tools to ~/.config/opencode/
./scripts/install-agent.sh
```

Then restart OpenCode.

See [docs/agent-integration.md](docs/agent-integration.md) for the full setup guide for all platforms.

## Packages

| Package | Description | Docs |
|---------|-------------|------|
| [`@sift/core`](packages/core/) | Shared library: parser, scanner, writer, config | [README](packages/core/README.md) |
| [`@sift/cli`](packages/cli/) | Command-line interface | [README](packages/cli/README.md) |
| [Raycast extension](packages/raycast/) | Raycast commands for task management | [README](packages/raycast/README.md) |
| [Agent skill](packages/agent-skill/) | MCP server for Claude Code/Desktop + OpenCode skill | [Setup guide](docs/agent-integration.md) |

## How it works

### Task format

Sift understands the Obsidian Tasks emoji format:

```markdown
- [ ] Write the proposal ⏫ ⏳ 2026-03-07 📅 2026-03-10
- [x] Review the draft 🔼 ✅ 2026-03-06
- [ ] Weekly standup notes 🔁 every week 📅 2026-03-07
```

| Emoji | Meaning | Example |
|-------|---------|---------|
| `⏫` | Highest priority | |
| `🔼` | High priority | |
| `🔽` | Low priority | |
| `⏬` | Lowest priority | |
| `⏳` | Scheduled date | `⏳ 2026-03-07` |
| `📅` | Due date | `📅 2026-03-10` |
| `🛫` | Start date | `🛫 2026-03-01` |
| `✅` | Done date | `✅ 2026-03-06` |
| `🔁` | Recurrence | `🔁 every week` |

### Configuration

Sift looks for configuration in this order (later sources override earlier ones):

1. `~/.siftrc.json`
2. `./.siftrc.json`
3. `SIFT_VAULT_PATH` environment variable
4. Explicit options passed to functions or CLI flags

Config file format:

```json
{
  "vaultPath": "/Users/you/Documents/My Vault",
  "dailyNotesPath": "Daily Notes",
  "dailyNotesFormat": "YYYY-MM-DD",
  "excludeFolders": ["Templates", "Attachments"]
}
```

### Where tasks are added

New tasks are added to today's daily note under the `## Journal` heading. If the daily note doesn't exist yet, sift creates it using a template that matches the standard Obsidian daily note format (frontmatter, tasks query, journal section, dataview query, navigation links).

## Project structure

```
sift/
├── packages/
│   ├── core/           # @sift/core - shared library
│   │   └── src/
│   │       ├── parser.ts    # Parse/format Obsidian Tasks emoji syntax
│   │       ├── scanner.ts   # Find and filter tasks across the vault
│   │       ├── writer.ts    # Add and complete tasks in markdown files
│   │       ├── config.ts    # Configuration resolution
│   │       ├── dates.ts     # Local timezone date helpers
│   │       ├── types.ts     # TypeScript interfaces
│   │       └── index.ts     # Public API
│   ├── cli/            # @sift/cli - command-line interface
│   │   └── src/
│   │       ├── index.ts     # CLI commands (commander.js)
│   │       └── format.ts    # Terminal formatting (chalk)
│   ├── raycast/        # Raycast extension
│   │   └── src/
│   │       ├── summary.tsx      # Task overview command
│   │       ├── list-tasks.tsx   # Searchable task list
│   │       ├── next-tasks.tsx   # Priority-sorted view
│   │       ├── add-task.tsx     # Add task form
│   │       └── config.ts       # Raycast preferences adapter
│   └── agent-skill/    # OpenCode agent integration
│       ├── SKILL.md         # Skill definition (what the agent knows)
│       └── tools/
│           └── sift.ts      # Custom tools (what the agent can do)
├── scripts/
│   └── install-agent.sh     # Install skill + tools to ~/.config/opencode/
├── docs/
│   └── agent-integration.md
├── AGENTS.md
└── package.json        # npm workspaces root
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Build and watch a specific package
npm run dev --workspace=packages/core
```

## License

MIT
