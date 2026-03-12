---
name: sift
description: Read, query, prioritize, and add tasks from the user's Obsidian vault using the sift CLI tool. Use this when the user asks about their tasks, wants to know what to work on next, or wants to add a new task.
---

## What I do

I help you interact with the user's Obsidian Tasks via the `sift` CLI tool and custom tools. The user manages their tasks in an Obsidian vault using the Obsidian Tasks plugin with emoji format.

## Available custom tools

The following custom tools are available for interacting with the user's tasks:

- **`sift_list`** - List open tasks, optionally filtered by search text, priority, or due date
- **`sift_next`** - Get the most important tasks to work on right now (sorted by priority + urgency)
- **`sift_summary`** - Quick overview: open count, overdue, due today, high priority, and up next
- **`sift_add`** - Add a new task to today's daily note, or to a specific project
- **`sift_find`** - Search for actionable tasks without modifying them (use before `sift_done` or `sift_mark`)
- **`sift_done`** - Mark a task as complete (requires file+line from `sift_find`; confirm with user first)
- **`sift_mark`** - Mark a task with any status: `in_progress`, `on_hold`, `moved`, `cancelled`, `open`, or `done` (use `sift_find` first)
- **`sift_projects`** - List all projects in the vault (with status, tags, created date)
- **`sift_project_create`** - Create a new project from template
- **`sift_project_path`** - Get the vault-relative file path for a project (for reading/editing)
- **`sift_project_set`** - Update project frontmatter: `--status` and/or `--timeframe`
- **`sift_note`** - Add a freeform note to a daily note or project file
- **`sift_review`** - Generate a review summary (completed, created, stale, changelog, upcoming)

## Task statuses

Tasks use Obsidian checkbox characters for status:

| Checkbox | Status | Meaning |
|----------|--------|---------|
| `- [ ]` | `open` | Not yet started |
| `- [/]` | `in_progress` | Actively being worked on |
| `- [x]` | `done` | Completed (gets a `✅` date) |
| `- [-]` | `cancelled` | Cancelled / won't do |
| `- [h]` | `on_hold` | Paused, waiting on something |
| `- [>]` | `moved` | Moved elsewhere or deferred |

The **actionable** statuses are `open` and `in_progress` — these appear in `sift list`, `sift next`, `sift find`, and `sift summary`.

Use `sift_mark` to change a task's status. Use `sift_done` as a shortcut for marking complete.

## Task format

Tasks use the Obsidian Tasks emoji format:
- See status table above for checkbox formats
- `⏫` highest priority, `🔼` high, `🔽` low
- `⏳ YYYY-MM-DD` scheduled date
- `📅 YYYY-MM-DD` due date
- `🛫 YYYY-MM-DD` start date
- `✅ YYYY-MM-DD` completion date
- `🔁 every week` recurrence

## When to use me

- User asks "what should I work on?" or "what's on my plate?"
- User asks about overdue or upcoming tasks
- User says "add a task" or "remind me to..." or "I need to..."
- User asks about their priorities or task status
- User wants to mark something as done, in progress, or deferred
- User mentions a project or wants to create one

## Guidelines

- When showing tasks, present them in a clean, readable format
- Highlight overdue tasks and high-priority items
- When adding tasks, confirm what was added (description, priority, dates, and which file it was added to)
- If the user mentions wanting to do something, offer to add it as a task
- Use `sift_next` when the user wants to know what to focus on
- Use `sift_summary` for a quick overview
- When the user says something like "I need to remember to X" or "add a task to Y", use `sift_add`

## Writing task descriptions

Task descriptions are written into Obsidian markdown files, so use **Obsidian syntax** when appropriate:

- **Use wiki links for vault references.** When a task references a file, note, or page in the vault, use Obsidian's `[[wiki link]]` syntax instead of backticks or markdown links. For example:
  - "Review the [[Health Tracker/_shortcut-log]] blueprint" -- not `` `Health Tracker/_shortcut-log.md` ``
  - "Update [[Meeting Notes/2026-03-10]]" -- not `Meeting Notes/2026-03-10.md`
  - You can drop the `.md` extension in wiki links; Obsidian resolves them automatically.
- **Use wiki links for people too**, if the user appears to reference people as notes (e.g., `[[John Smith]]`).
- **Don't overuse wiki links.** Only use them when referencing something that is (or could be) a note in the vault. Generic text, code snippets, and external references should stay as-is.

## Project-aware task placement

When the user asks you to add a task, consider whether it belongs to an existing project:

1. **Check for project context.** If the current working directory has a `.siftrc.json` with a `project` field, the user is likely working in that project. Mention this context.
2. **Evaluate the task.** If the task description sounds like it belongs to a specific project (e.g., it references a project name, relates to a known project's goals, or is clearly scoped to a project), suggest adding it to that project.
3. **Always ask the user.** Never silently route a task to a project. Present your suggestion and let the user confirm or choose a different destination:
   - "This sounds like it might belong to the **MP3 Parser** project. Should I add it there, or to today's daily note?"
   - If you're not sure, just add it to the daily note without asking.
4. **Use `sift_projects`** to list available projects if you need to find the right one.
5. **Use the `project` parameter** on `sift_add` to add to a project.

If the task doesn't feel like it belongs to any project, add it to the daily note as usual. Don't over-suggest projects -- only suggest when there's a clear connection.

## Changing task status

When the user wants to mark a task as done, in progress, on hold, etc.:

1. **Always use `sift_find` first** to search for the task and preview the matches.
2. **Show the user the exact task** you're about to update (description, file, line number) and **wait for explicit confirmation before proceeding**. Do NOT call `sift_done` or `sift_mark` in the same response as `sift_find` -- you must wait for the user to reply.
3. **Use precise mode.** After confirming with the user, pass `file` and `line` to `sift_done` or `sift_mark` (these are the only parameters they accept).
4. **If multiple tasks match**, show all matches and ask the user to clarify which one they mean.
5. **Use `sift_done` as a shortcut** when marking complete; use `sift_mark` for any other status change.

Example flow (marking done):
- User: "mark the MP3 parser task as done"
- You: call `sift_find` with search "MP3 parser"
- You: "I found this task: **Research MP3 header format** in `Projects/MP3 Parser.md` line 15. Mark it as done?"
- User: "yes"
- You: call `sift_done` with file="Projects/MP3 Parser.md" and line=15

Example flow (marking in progress):
- User: "I'm starting work on the auth refactor"
- You: call `sift_find` with search "auth refactor"
- You: "Found: **Refactor auth middleware** in `Projects/Backend.md` line 22. Mark it as in progress?"
- User: "yes"
- You: call `sift_mark` with file="Projects/Backend.md", line=22, status="in_progress"

## Creating projects

When the user wants to create a new project, use `sift_project_create` with the project name. This creates a new file from the vault's project template in the Projects folder, with `created` set to today's date automatically.

## Project statuses

Projects use a standard status vocabulary. Use `sift_project_set` to change a project's status:

| Status | Meaning |
|--------|---------|
| `active` | Currently being worked on (this is the default when no status is set) |
| `planning` | Upcoming — scoping or design phase, not yet in execution |
| `someday` | Low priority, no timeline — maybe later (GTD "someday/maybe") |
| `done` | Completed |

**When to update status:**
- Mark a project `done` when the work is finished
- Move to `someday` when the user explicitly deprioritizes something with no near-term timeline
- Use `planning` for projects that are defined but not yet started
- `active` is the right state for anything currently in flight

In `sift summary` and `sift projects`, `active` and `planning` projects appear at full brightness; `someday` and `done` are dimmed.

## Adding notes to projects and daily notes

Use `sift_note` to add freeform content (not tasks) to a project or daily note. This is useful for:
- Recording decisions, observations, or meeting notes
- Updating a project's notes or overview section
- Logging journal entries in the daily note
- Adding research findings or context to a project

**Default headings:**
- For daily notes: notes go under `## Journal`
- For projects: notes go under `## Notes`
- Use the `heading` parameter to target a different section (e.g., `"## Overview"`, `"## Goals"`)

**Section targeting:** When the user refers to a specific section by name — for example, "add that to my accomplishments," "put this in the goals section," or "log this under meeting notes" — map their request to the `heading` parameter. Use `## ` prefix with the section name (e.g., `heading: "## Accomplishments"`). If the heading doesn't exist in the file, sift will create it — so if you're not confident the heading already exists, confirm with the user before adding the note (e.g., "I don't see a '## Meeting Notes' section in today's note. Should I create it?").

**When to use `sift_note` vs editing directly:**
- Use `sift_note` for quick additions: a paragraph, a few bullet points, a brief update
- For larger edits (rewriting a section, restructuring content), use `sift_project_path` to get the file path, then read and edit the file directly

## Reading and editing project files

When the user asks you to "check out" a project, look at project notes, or references a specific project by name, use the sift tools to find and read it:

1. Use `sift_projects` to list all projects (to confirm the project name if needed)
2. Use `sift_project_path` to get the vault-relative file path for the project
3. Use `sift_summary` to get the vault path, then prepend it to the project path to read the file

This lets you:
- Read the project file to understand its current state, goals, and notes
- Make direct edits to any section of the project
- Check what tasks, notes, or goals already exist

The path returned by `sift_project_path` is relative to the vault root. To get the absolute path for file operations, prepend the vault path from the sift configuration (visible in `sift_summary` output).

## Date handling for new tasks

Tasks should **always be added to today's daily note** using `sift_add` (unless they belong to a project). When the user refers to a future date (e.g. "add a task for tomorrow", "add a task for Friday", "I need to do this next week"), do NOT try to add it to that day's note. Instead:

1. **Always add to today's note** (this is what `sift_add` does by default).
2. **Set the `scheduled` parameter** to the date the user mentioned. For example:
   - "add a task for tomorrow" -> `scheduled: <tomorrow's date>`
   - "add a task for Friday" -> `scheduled: <next Friday's date>`
   - "add a task for next week" -> `scheduled: <next Monday's date>`
3. **Use `due` instead of `scheduled`** if the task sounds high-priority or has a hard deadline (e.g. "I need to do X by Friday", "this is due next Tuesday"). Use your judgment -- `due` implies a deadline, `scheduled` implies "plan to work on this that day."

## Review

Use `sift_review` to generate a review summary for any time period. It defaults to since last Friday through today, but the period is fully flexible.

**What the review shows:**
- **Completed tasks** -- tasks with a `✅` date in the review period
- **Created & still open** -- tasks with a `➕` date in the period that are still actionable
- **Project notes** -- changelog entries from project files during the period
- **New notes** -- non-task vault files (meetings, weblinks, etc.) dated within the period
- **Deferred** -- tasks marked `on_hold` or `moved` that were created during the period
- **Stale tasks** -- actionable tasks with no due or scheduled date (may need triage)
- **Upcoming** -- tasks due in the 7 days after the review period

**Parameters:**
- `since` -- start date (YYYY-MM-DD), defaults to last Friday
- `until` -- end date (YYYY-MM-DD), defaults to today
- `days` -- review the last N days (alternative to `since`)

**When to use:**
- User asks "what did I do this week?" or "weekly review" -- use defaults
- User asks "what's happened the last 3 days?" -- use `days: 3`
- User asks "what's happened since Monday?" -- use `since` with Monday's date
- User asks "review March" -- use `since` and `until` for the month range
- User wants to reflect on recent progress across projects

### Changelog tracking

When you add a note to a project using `sift_note`, a changelog entry is automatically appended under a `## Changelog` heading in the project file. The changelog entry is a dated one-liner summarizing the note:

```
## Changelog
- **2026-03-10:** Decided to use ID3v2.4 format
- **2026-03-08:** Added initial research notes
```

This happens automatically -- you don't need to do anything special. The changelog provides a lightweight activity log that the review command can aggregate across all projects.

**Notes about changelog:**
- Only notes create changelog entries, not tasks (tasks already have `➕` created dates)
- Always pass a `changelogSummary` when calling `sift_note` — write a short, meaningful one-liner that captures the essence of the note (e.g. "Decided to use ID3v2.4 format", "Switched auth strategy to JWT"). Don't rely on the default, which just truncates the raw note content.

## CWD project context

If the user's working directory contains a `.siftrc.json` with a `project` field, sift is aware of the associated project. The `sift_summary` output will mention this. Use this context to:
- Default suggestions toward the associated project when adding tasks
- Filter task lists to show the project's tasks when relevant
- Mention the project context when it's helpful (e.g., "You're in the MP3 Parser project")
