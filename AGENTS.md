# AGENTS.md

This is **sift** -- a tool for surfacing and managing Obsidian Tasks from outside Obsidian.

## Project overview

Sift reads and writes tasks from an Obsidian vault that uses the [Obsidian Tasks](https://publish.obsidian.md/tasks/) plugin with **emoji format**. It provides multiple interfaces (CLI, Raycast, AI agent) on top of a shared core library.

## Architecture

This is a TypeScript monorepo using npm workspaces.

```
sift/
├── packages/
│   ├── core/       # Shared library: parser, scanner, writer, config
│   ├── cli/        # Command-line interface (commander.js)
│   └── raycast/    # Raycast extension (React + @raycast/api)
```

All interfaces depend on `@sift/core`. The core package has zero UI concerns -- it reads/writes markdown files and returns structured data.

### Agent integration

The agent integration files are in `packages/agent-skill/`:

**MCP Server (for Claude Code & Claude Desktop):**
- `packages/agent-skill/mcp-server.ts` -- MCP server providing sift tools
- Installed via `./scripts/install-agent-claude.sh`
- Tools: `sift_list`, `sift_next`, `sift_summary`, `sift_add`, `sift_done`

**OpenCode Skill:**
- `packages/agent-skill/SKILL.md` -- Skill definition
- `packages/agent-skill/tools/sift.ts` -- Custom tools
- Installed to `~/.config/opencode/` via `./scripts/install-agent.sh`

Both implementations resolve the CLI dynamically (from PATH or `SIFT_CLI_PATH` env var) rather than hardcoding a path.

## Key concepts

### Obsidian Tasks emoji format

Tasks look like this in markdown:

```markdown
- [ ] Task description ⏫ ⏳ 2026-03-07 📅 2026-03-10
- [x] Completed task 🔼 ✅ 2026-03-06
```

Emoji meanings:
- Priority: `⏫` highest, `🔼` high, `🔽` low, `⏬` lowest
- Dates: `⏳` scheduled, `📅` due, `🛫` start, `✅` done
- Recurrence: `🔁` followed by rule text (e.g., "every week")

### Configuration

Sift resolves its config in this order:
1. Explicit overrides passed to functions
2. `SIFT_VAULT_PATH` environment variable
3. `~/.siftrc.json`
4. `./.siftrc.json`

The config file looks like:
```json
{
  "vaultPath": "/path/to/vault",
  "dailyNotesPath": "Daily Notes",
  "dailyNotesFormat": "YYYY-MM-DD",
  "excludeFolders": ["Templates", "Attachments"]
}
```

### Task scanning

The scanner (`packages/core/src/scanner.ts`) walks all `.md` files in the vault, skipping excluded folders and root-level ALL_CAPS files (setup/reference docs). It parses every line looking for `- [ ]` or `- [x]` patterns and extracts metadata.

### Task writing

New tasks are added under the `## Journal` heading in today's daily note. If the daily note doesn't exist, it's created from a template that matches the user's existing format (frontmatter, tasks query block, journal section, dataview query, navigation links).

## Building

```bash
npm install
npm run build        # builds all packages
```

The CLI is the primary entry point. After building:
```bash
node packages/cli/dist/index.js summary
```

Or if linked globally:
```bash
sift summary
```

## Package details

### @sift/core (`packages/core/`)

Pure library, no CLI or UI. Key exports:

- **Parser**: `parseLine()`, `parseContent()`, `formatTask()`
- **Scanner**: `scanTasks()`, `scanFile()`, `getNextTasks()`, `getOverdueTasks()`, `getDueToday()`, `sortByUrgency()`
- **Writer**: `addTask()`, `addTaskToFile()`, `completeTask()`
- **Config**: `resolveConfig()`, `writeConfig()`
- **Types**: `Task`, `TaskStatus`, `Priority`, `SiftConfig`, `TaskFilter`, `NewTaskOptions`

### @sift/cli (`packages/cli/`)

Commands: `list`, `next`, `today`, `overdue`, `add`, `done`, `summary`, `init`

Uses commander.js for arg parsing and chalk for terminal output.

### Raycast extension (`packages/raycast/`)

Four commands: Task Summary, List Tasks, Up Next, Add Task. Uses `@raycast/api` React components. Vault path is configured via Raycast extension preferences.

## Code style

- TypeScript with strict mode
- ESM (`"type": "module"` in package.json)
- Node16 module resolution
- All imports use `.js` extensions (TypeScript convention for ESM)
- JSDoc comments on all public functions

## Testing

No test framework is set up yet. Tests should be added to each package as `src/__tests__/` directories using vitest or a similar ESM-compatible runner. The parser is the highest priority for unit tests since it handles the most complex logic.
