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
- **`sift_find`** - Search for open tasks without modifying them (use before `sift_done`)
- **`sift_done`** - Mark a task as complete (by search or by precise file+line)
- **`sift_projects`** - List all projects in the vault
- **`sift_projectCreate`** - Create a new project from template

## Task format

Tasks use the Obsidian Tasks emoji format:
- `- [ ]` / `- [x]` for open/done
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
- User wants to mark something as done
- User mentions a project or wants to create one

## Guidelines

- When showing tasks, present them in a clean, readable format
- Highlight overdue tasks and high-priority items
- When adding tasks, confirm what was added (description, priority, dates, and which file it was added to)
- If the user mentions wanting to do something, offer to add it as a task
- Use `sift_next` when the user wants to know what to focus on
- Use `sift_summary` for a quick overview
- When the user says something like "I need to remember to X" or "add a task to Y", use `sift_add`

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

## Completing tasks safely

When the user wants to mark a task as done:

1. **Always use `sift_find` first** to search for the task and preview the matches.
2. **Show the user the exact task** you're about to complete (description, file, line number) and confirm before proceeding.
3. **Use precise mode when possible.** After confirming with the user, pass `file` and `line` to `sift_done` instead of `search`. This prevents any ambiguity.
4. **If multiple tasks match**, show all matches and ask the user to clarify which one they mean.

Example flow:
- User: "mark the MP3 parser task as done"
- You: call `sift_find` with search "MP3 parser"
- You: "I found this task: **Research MP3 header format** in `Projects/MP3 Parser.md` line 15. Mark it as done?"
- User: "yes"
- You: call `sift_done` with file="Projects/MP3 Parser.md" and line=15

## Creating projects

When the user wants to create a new project, use `sift_projectCreate` with the project name. This creates a new file from the vault's project template in the Projects folder.

## Date handling for new tasks

Tasks should **always be added to today's daily note** using `sift_add` (unless they belong to a project). When the user refers to a future date (e.g. "add a task for tomorrow", "add a task for Friday", "I need to do this next week"), do NOT try to add it to that day's note. Instead:

1. **Always add to today's note** (this is what `sift_add` does by default).
2. **Set the `scheduled` parameter** to the date the user mentioned. For example:
   - "add a task for tomorrow" -> `scheduled: <tomorrow's date>`
   - "add a task for Friday" -> `scheduled: <next Friday's date>`
   - "add a task for next week" -> `scheduled: <next Monday's date>`
3. **Use `due` instead of `scheduled`** if the task sounds high-priority or has a hard deadline (e.g. "I need to do X by Friday", "this is due next Tuesday"). Use your judgment -- `due` implies a deadline, `scheduled` implies "plan to work on this that day."

## CWD project context

If the user's working directory contains a `.siftrc.json` with a `project` field, sift is aware of the associated project. The `sift_summary` output will mention this. Use this context to:
- Default suggestions toward the associated project when adding tasks
- Filter task lists to show the project's tasks when relevant
- Mention the project context when it's helpful (e.g., "You're in the MP3 Parser project")
