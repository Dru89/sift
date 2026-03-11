# @sift/cli

Command-line interface for sift. Query, add, and manage Obsidian Tasks from your terminal.

## Install

From the sift repo root:

```bash
npm install
npm run build
```

To make `sift` available globally:

```bash
npm link --workspace=packages/cli
```

Then you can run `sift` from anywhere.

## Setup

Before using sift, point it at your Obsidian vault:

```bash
sift init "/path/to/your/vault"
```

This writes `~/.siftrc.json` with your vault path and default settings. You can also set the `SIFT_VAULT_PATH` environment variable instead.

## Commands

### `sift summary`

Quick dashboard showing open/done counts, overdue tasks, high-priority items, and what to work on next.

```
$ sift summary
📋 Sift Summary

7 open  ·  12 done

⏫ High Priority
  ○ ⏫ Write the proposal  scheduled 2026-02-27
  ○ 🔼 Review the architecture doc  scheduled 2026-03-02

👉 Up Next
  ○ ⏫ Write the proposal  scheduled 2026-02-27
  ○ 🔼 Review the architecture doc  scheduled 2026-03-02
  ○   Read the strategy doc
```

### `sift list`

List all open tasks, sorted by priority and urgency.

```bash
sift list                          # all open tasks
sift list --all                    # include done and cancelled
sift list --search "proposal"      # filter by text
sift list --priority high          # minimum priority level
sift list --due-before 2026-03-10  # due on or before date
sift list --show-file              # show file path and line number
```

Alias: `sift ls`

### `sift next`

Show the most important tasks to work on right now.

```bash
sift next        # top 10
sift next -n 5   # top 5
```

### `sift today`

Show tasks due today.

### `sift overdue`

Show overdue tasks (due date is before today).

### `sift add`

Add a new task to today's daily note, or to a project.

```bash
sift add "Write the quarterly report"
sift add "Review PR" --priority high
sift add "Submit expenses" --due 2026-03-15
sift add "Prepare presentation" --priority highest --scheduled 2026-03-08 --due 2026-03-10
sift add "Team standup" --recurrence "every weekday"
sift add "Design the API" --project "My Project"
```

Options:

| Flag | Description |
|------|-------------|
| `-p, --priority <level>` | `highest`, `high`, `low`, or `lowest` |
| `-d, --due <date>` | Due date (`YYYY-MM-DD`) |
| `-s, --scheduled <date>` | Scheduled date (`YYYY-MM-DD`) |
| `--start <date>` | Start date (`YYYY-MM-DD`) |
| `-r, --recurrence <rule>` | Recurrence rule (e.g., `"every week"`) |
| `--project <name>` | Add to a project instead of the daily note |

When `--project` is used, the task is inserted under `## Tasks` in the project file and automatically includes a `➕` created date.

### `sift done`

Mark a task as complete. Supports two modes:

**Search mode** -- find and complete by description:

```bash
sift done "quarterly report"
sift done "PR"
```

If the search matches exactly one actionable task (open or in-progress), it's marked done. If it matches multiple, they're listed so you can be more specific.

**Precise mode** -- complete by exact file and line:

```bash
sift done --file "Daily Notes/2026-03-10.md" --line 13
```

### `sift mark`

Mark a task with any status. Use this to set a task as in-progress, on hold, moved, cancelled, or reopen it.

**Search mode** -- find and mark by description:

```bash
sift mark "auth refactor" --status in_progress
sift mark "waiting for review" --status on_hold
sift mark "outdated idea" --status cancelled
```

**Precise mode** -- mark by exact file and line:

```bash
sift mark --file "Projects/Backend.md" --line 22 --status in_progress
```

| Status | Checkbox | Meaning |
|--------|----------|---------|
| `open` | `- [ ]` | Not yet started (default) |
| `in_progress` | `- [/]` | Actively being worked on |
| `done` | `- [x]` | Completed (also adds `✅` date) |
| `cancelled` | `- [-]` | Won't do |
| `on_hold` | `- [h]` | Paused, waiting on something |
| `moved` | `- [>]` | Moved elsewhere or deferred |

### `sift find`

Search for actionable tasks (open or in-progress) without modifying them. Useful for previewing before completing or marking.

```bash
sift find "quarterly"
sift find "architecture"
```

Shows matching tasks with file paths and line numbers by default.

### `sift note`

Add a freeform note (not a task) to today's daily note or to a project.

```bash
sift note "Had a great meeting about the roadmap"
sift note --project "My Project" "Decided to use the new API design"
sift note --project "My Project" --heading "## Log" "Shipped v1.0"
```

| Flag | Description |
|------|-------------|
| `--project <name>` | Add note to a project instead of the daily note |
| `--heading <heading>` | Target heading (default: `## Journal` for daily, `## Notes` for projects) |

When targeting a project, the note goes under `## Notes` by default. A changelog entry is automatically appended under `## Changelog` in the project file.

### `sift review`

Generate a review summary showing completed tasks, newly created tasks, project changelog entries, stale tasks, and upcoming tasks.

```bash
sift review                     # since last Friday (default)
sift review --days 30           # last 30 days
sift review --since 2026-03-01  # since a specific date
sift review --since 2026-03-01 --until 2026-03-07  # custom range
```

| Flag | Description |
|------|-------------|
| `--since <date>` | Start of review period (`YYYY-MM-DD`, default: last Friday) |
| `--until <date>` | End of review period (`YYYY-MM-DD`, default: today) |
| `--days <number>` | Review the last N days (alternative to `--since`) |

The review shows:
- **Completed** -- tasks with a `✅` date in the review period
- **Created & still open** -- tasks with a `➕` date in the period that are still actionable
- **Project notes** -- changelog entries from project files
- **New notes** -- non-task vault files (meetings, weblinks, etc.) with a `created` or `date` frontmatter field in the period, grouped by type
- **Deferred** -- tasks marked `on_hold` or `moved` that were created during the period
- **Stale** -- actionable tasks with no due or scheduled date
- **Upcoming** -- tasks due in the 7 days after the review period

### `sift projects`

List all projects in the vault.

```bash
sift projects                 # all projects
sift projects --tag vibecode  # filter by tag
```

Active and planning projects are shown at full brightness; someday and done projects are dimmed.

### `sift project create`

Create a new project from the configured template. The `created` date is automatically set to today.

```bash
sift project create "My New Project"
```

### `sift project set`

Update frontmatter fields on a project.

```bash
sift project set "My Project" --status active
sift project set "My Project" --status someday
sift project set "My Project" --tags ai tooling
sift project set "My Project" --status planning --timeframe "Q2 2026" --tags ai
```

| Flag | Description |
|------|-------------|
| `--status <status>` | `active`, `planning`, `someday`, or `done` |
| `--timeframe <timeframe>` | Planning horizon (e.g. `Q2 2026`) |
| `--tags <tags...>` | Tag list, space-separated (replaces existing tags) |

### `sift project path`

Get the vault-relative file path for a project. Useful for scripting or agent integrations.

```bash
sift project path "My Project"              # vault-relative path
sift project path --absolute "My Project"   # absolute path
```

### `sift init`

Set up the sift configuration file.

```bash
sift init "/path/to/vault"
sift init "/path/to/vault" --daily-notes "Journal"
sift init "/path/to/vault" --projects "Projects" --project-template "Templates/Project.md"
sift init "/path/to/vault" --exclude Templates Attachments Archive
```

## Global options

All list-style commands support `--show-file` to display the file path and line number for each task.
