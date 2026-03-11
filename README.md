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

- **CLI** -- `sift summary`, `sift next`, `sift add`, `sift done`, `sift mark`, `sift note`, `sift review`, and more
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

# Add a task to a project
sift add "Design the API" --project "MP3 Parser" --priority high

# Mark something done
sift done "architecture doc"

# Mark something in progress or on hold
sift mark "architecture doc" --status in_progress
sift mark "waiting on client" --status on_hold

# Add a note to today's daily note
sift note "Had a great meeting about the roadmap"

# Add a note to a project
sift note --project "MP3 Parser" "Decided to use ID3v2.4 format"

# Weekly review
sift review                     # since last Friday
sift review --days 30           # last 30 days
sift review --since 2026-03-01  # since a specific date
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
| `➕` | Created date | `➕ 2026-03-01` |
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
  "excludeFolders": ["Templates", "Attachments"],
  "projectsPath": "Projects",
  "projectTemplatePath": "Templates/Project.md"
}
```

### Where tasks are added

New tasks are added to today's daily note under the `## Journal` heading by default. If the daily note doesn't exist yet, sift creates it using a template that matches the standard Obsidian daily note format (frontmatter, tasks query, journal section, dataview query, navigation links).

Tasks can also be added to project files using `sift add --project <name>`, which inserts them under the `## Tasks` heading. Tasks added to project files automatically include a `➕ YYYY-MM-DD` created date.

### Notes

Freeform notes (not tasks) can be added with `sift note`. By default, notes go under `## Journal` in today's daily note. Use `--project` to target a project file (defaults to `## Notes` heading), and `--heading` to target a custom section. Notes added to projects automatically create a changelog entry.

### Review

`sift review` generates a summary of activity over a time period: tasks completed, tasks created (still open), project changelog entries, new vault notes (meetings, weblinks, etc.), stale tasks, and upcoming tasks. Defaults to since last Friday (designed for weekly reviews). Use `--since <date>`, `--days <N>`, or `--until <date>` for custom periods.

### Projects

Projects are markdown files in the configured `projectsPath` folder (default: `Projects/`) with `type: project` in their YAML frontmatter. Each project tracks a standard set of metadata:

| Field | Description |
|-------|-------------|
| `status` | `active` (default), `planning`, `someday`, or `done` |
| `created` | Date the project was created (set automatically by `sift project create`) |
| `timeframe` | Optional planning horizon (e.g. `Q2 2026`) |
| `tags` | Optional list of tags |

```bash
sift projects                       # list all projects
sift projects --tag vibecode        # filter by tag
sift project create "My Project"    # create from template
sift project set "My Project" --status active --tags ai tooling
sift project path "My Project"      # get vault-relative file path
```

`sift summary` shows a projects section with active/planning projects at full brightness and someday/done projects dimmed.

## Project structure

```
sift/
├── packages/
│   ├── core/           # @sift/core - shared library
│   │   └── src/
│   │       ├── parser.ts    # Parse/format Obsidian Tasks emoji syntax
│   │       ├── scanner.ts   # Find and filter tasks across the vault
│   │       ├── writer.ts    # Add tasks/notes and complete tasks
│   │       ├── projects.ts  # List, find, and create projects
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
│   └── agent-skill/    # AI agent integrations
│       ├── src/
│       │   └── mcp-server.ts  # MCP server for Claude Code/Desktop
│       ├── SKILL.md         # OpenCode skill definition
│       └── tools/
│           └── sift.ts      # OpenCode custom tools
├── scripts/
│   ├── install-agent.sh         # Install OpenCode skill + tools
│   └── install-agent-claude.sh  # Install Claude MCP server config
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
