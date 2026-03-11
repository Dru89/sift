# @sift/core

Shared library for reading and writing Obsidian Tasks. This is the foundation that all sift interfaces (CLI, Raycast, agent tools) are built on.

## Install

This package is part of the sift monorepo. If you're working within the repo:

```bash
npm install   # from repo root
npm run build --workspace=packages/core
```

To use it from another package in the monorepo, add `"@sift/core": "*"` to your `dependencies`.

## API

### Configuration

#### `resolveConfig(overrides?): Promise<SiftConfig>`

Resolves the sift configuration by checking (in order):

1. Explicit `overrides` passed as argument
2. `SIFT_VAULT_PATH` environment variable
3. `~/.siftrc.json`
4. `./.siftrc.json`

Throws if no vault path can be determined.

```typescript
import { resolveConfig } from "@sift/core";

const config = await resolveConfig();
// or with overrides:
const config = await resolveConfig({ vaultPath: "/path/to/vault" });
```

#### `writeConfig(config): Promise<string>`

Writes a config file to `~/.siftrc.json`. Returns the path written.

```typescript
import { writeConfig } from "@sift/core";

const path = await writeConfig({
  vaultPath: "/Users/me/Documents/Vault",
  dailyNotesPath: "Daily Notes",
  dailyNotesFormat: "YYYY-MM-DD",
  excludeFolders: ["Templates", "Attachments"],
});
```

### Parsing

#### `parseLine(line, filePath, lineNumber): Task | null`

Parse a single line of markdown into a `Task` object. Returns `null` if the line isn't a valid task (i.e., doesn't match `- [ ]` or `- [x]` pattern, or is an empty checkbox).

```typescript
import { parseLine } from "@sift/core";

const task = parseLine(
  "- [ ] Write the proposal ⏫ 📅 2026-03-10",
  "Daily Notes/2026-03-06.md",
  13
);

// task = {
//   raw: "Write the proposal ⏫ 📅 2026-03-10",
//   description: "Write the proposal",
//   status: "open",
//   priority: "highest",
//   scheduled: null,
//   due: "2026-03-10",
//   start: null,
//   done: null,
//   recurrence: null,
//   filePath: "Daily Notes/2026-03-06.md",
//   line: 13,
// }
```

#### `parseContent(content, filePath): Task[]`

Parse an entire file's content and extract all tasks.

```typescript
import { parseContent } from "@sift/core";

const content = await fs.readFile("path/to/file.md", "utf-8");
const tasks = parseContent(content, "relative/path.md");
```

#### `formatTask(task): string`

Format a task back into the Obsidian Tasks emoji format. The returned string includes the `- [ ]` prefix and all emoji metadata.

```typescript
import { formatTask } from "@sift/core";

const line = formatTask({
  description: "Write the proposal",
  status: "open",
  priority: "highest",
  scheduled: null,
  due: "2026-03-10",
  start: null,
  done: null,
  recurrence: null,
});
// "- [ ] Write the proposal ⏫ 📅 2026-03-10"
```

### Scanning

#### `scanTasks(config, filter?): Promise<Task[]>`

Scan the entire vault for tasks, optionally filtering them. This walks all `.md` files, skipping excluded folders and root-level ALL_CAPS files.

```typescript
import { resolveConfig, scanTasks } from "@sift/core";

const config = await resolveConfig();

// All tasks
const all = await scanTasks(config);

// Open tasks matching a search
const filtered = await scanTasks(config, {
  status: "open",
  search: "proposal",
});

// High priority tasks due soon
const urgent = await scanTasks(config, {
  status: "open",
  minPriority: "high",
  dueBefore: "2026-03-10",
});
```

#### `scanFile(vaultPath, filePath): Promise<Task[]>`

Scan a single file for tasks.

```typescript
import { scanFile } from "@sift/core";

const tasks = await scanFile("/path/to/vault", "Daily Notes/2026-03-06.md");
```

#### `sortByUrgency(tasks): Task[]`

Sort tasks by urgency. Sort order:
1. Priority (highest first)
2. Due date (soonest first; tasks with due dates before tasks without)
3. Scheduled date (soonest first)
4. Alphabetical by description

Returns a new array (does not mutate the input).

```typescript
import { scanTasks, sortByUrgency } from "@sift/core";

const tasks = await scanTasks(config, { status: "open" });
const sorted = sortByUrgency(tasks);
```

#### `getNextTasks(config, count?): Promise<Task[]>`

Get the most important open tasks, sorted by urgency. Defaults to 10.

```typescript
import { getNextTasks } from "@sift/core";

const next5 = await getNextTasks(config, 5);
```

#### `getOverdueTasks(config): Promise<Task[]>`

Get open tasks whose due date is before today.

#### `getDueToday(config): Promise<Task[]>`

Get open tasks whose due date is today.

#### `applyFilter(tasks, filter?): Task[]`

Apply a `TaskFilter` to an array of tasks. Useful if you've already loaded tasks and want to filter in memory.

#### `getReviewSummary(config, since?, until?): Promise<ReviewSummary>`

Generate a review summary for a given time period. Returns completed tasks, created (still open) tasks, stale tasks, project changelog entries, and upcoming tasks.

Defaults: `since` = last Friday, `until` = today.

```typescript
import { getReviewSummary } from "@sift/core";

const review = await getReviewSummary(config);
// review.completed  -- tasks done during the period
// review.created    -- tasks created during the period, still open
// review.stale      -- open tasks with no due/scheduled date
// review.changelog  -- ChangelogEntry[] from project files
// review.upcoming   -- tasks due in the next 7 days after the period

// Custom period
const review = await getReviewSummary(config, "2026-03-01", "2026-03-07");
```

#### `scanChangelog(config, since?, until?): Promise<ChangelogEntry[]>`

Scan all project files for changelog entries (lines matching `- **YYYY-MM-DD:** summary`), optionally filtered by date range. Returns entries sorted by date (newest first).

```typescript
import { scanChangelog } from "@sift/core";

const entries = await scanChangelog(config, "2026-03-01");
// [{ date: "2026-03-10", summary: "Decided to use ID3v2.4", project: "MP3 Parser", filePath: "Projects/MP3 Parser.md", line: 42 }]
```

### Writing

#### `addTask(config, options): Promise<string>`

Add a new task to today's daily note under the `## Journal` heading, or to a project file under `## Tasks` if `options.project` is provided. Creates the daily note from a template if it doesn't exist. Returns the formatted task string.

When targeting a project, the task automatically includes a `➕ YYYY-MM-DD` created date.

```typescript
import { resolveConfig, addTask } from "@sift/core";

const config = await resolveConfig();

// Add to today's daily note
const taskLine = await addTask(config, {
  description: "Review the architecture doc",
  priority: "high",
  due: "2026-03-10",
  scheduled: "2026-03-07",
});
// "- [ ] Review the architecture doc 🔼 ⏳ 2026-03-07 📅 2026-03-10"

// Add to a project
await addTask(config, {
  description: "Design the API",
  priority: "highest",
  project: "MP3 Parser",
});
// "- [ ] Design the API ⏫ ➕ 2026-03-10"
```

#### `addTaskToFile(config, filePath, options, heading?): Promise<string>`

Add a task to a specific file. If `heading` is provided, inserts under that heading. Otherwise appends to the end of the file.

```typescript
import { addTaskToFile } from "@sift/core";

await addTaskToFile(config, "Projects/Website.md", {
  description: "Fix the login bug",
  priority: "highest",
}, "## Goals");
```

#### `completeTask(config, taskOrFile, line?): Promise<string>`

Mark a task as done by updating the checkbox to `[x]` and appending a `✅ YYYY-MM-DD` done date. Accepts either a `Task` object or an explicit file path and line number. Returns the description of the completed task.

```typescript
import { scanTasks, completeTask } from "@sift/core";

// Using a Task object
const tasks = await scanTasks(config, { status: "open", search: "proposal" });
if (tasks.length === 1) {
  await completeTask(config, tasks[0]);
}

// Using file path + line number (precise mode)
await completeTask(config, "Daily Notes/2026-03-10.md", 13);
```

#### `findTasks(config, search): Promise<Task[]>`

Search for open tasks matching a query string (case-insensitive substring match). Returns matching tasks with full context (file path, line number, description) without modifying anything. Use this to preview before completing.

```typescript
import { findTasks } from "@sift/core";

const matches = await findTasks(config, "architecture");
// Returns open tasks whose description contains "architecture"
```

#### `addNote(config, options): Promise<string>`

Add a freeform note to today's daily note or to a project file. Returns the content that was written.

When targeting a project, the note goes under `## Notes` by default and a changelog entry is automatically appended under `## Changelog`. When targeting a daily note, it goes under `## Journal` by default. Use `options.heading` to specify a different section.

```typescript
import { addNote } from "@sift/core";

// Add to today's daily note
await addNote(config, {
  content: "Had a great meeting about the roadmap",
});

// Add to a project under a custom heading
await addNote(config, {
  content: "Decided to use ID3v2.4 format",
  project: "MP3 Parser",
  heading: "## Log",
});
```

### Projects

#### `listProjects(config): Promise<ProjectInfo[]>`

List all projects in the vault. Projects are markdown files in the configured `projectsPath` folder that have `type: project` in their YAML frontmatter.

```typescript
import { listProjects } from "@sift/core";

const projects = await listProjects(config);
// [{ name: "MP3 Parser", filePath: "Projects/MP3 Parser.md", status: "planning", tags: ["vibecode"] }, ...]
```

#### `findProject(config, name): Promise<ProjectInfo | undefined>`

Look up a project by name (case-insensitive).

```typescript
import { findProject } from "@sift/core";

const project = await findProject(config, "mp3 parser");
// { name: "MP3 Parser", filePath: "Projects/MP3 Parser.md", ... }
```

#### `createProject(config, name): Promise<string>`

Create a new project from the configured template. Returns the vault-relative file path.

```typescript
import { createProject } from "@sift/core";

const filePath = await createProject(config, "New Feature");
// "Projects/New Feature.md"
```

## Types

### `Task`

```typescript
interface Task {
  raw: string;              // Original text including emoji metadata
  description: string;      // Text with metadata stripped
  status: TaskStatus;       // "open" | "done" | "cancelled"
  priority: Priority;       // "highest" | "high" | "medium" | "low" | "lowest" | "none"
  scheduled: string | null; // YYYY-MM-DD or null
  due: string | null;       // YYYY-MM-DD or null
  start: string | null;     // YYYY-MM-DD or null
  done: string | null;      // YYYY-MM-DD or null
  created: string | null;   // YYYY-MM-DD or null (➕ emoji)
  recurrence: string | null;// e.g. "every week"
  filePath: string;         // Relative to vault root
  line: number;             // 1-indexed line number
}
```

### `SiftConfig`

```typescript
interface SiftConfig {
  vaultPath: string;            // Absolute path to vault root
  dailyNotesPath: string;       // Folder for daily notes, relative to vault root
  dailyNotesFormat: string;     // Date format for filenames (default: "YYYY-MM-DD")
  excludeFolders: string[];     // Folders to skip when scanning
  projectsPath: string;         // Folder for projects (default: "Projects")
  projectTemplatePath: string;  // Template file for new projects (default: "Templates/Project.md")
  project?: string;             // CWD project association (from per-repo .siftrc.json)
}
```

### `TaskFilter`

```typescript
interface TaskFilter {
  status?: TaskStatus;      // Filter by status
  minPriority?: Priority;   // Minimum priority level
  dueBefore?: string;       // Due on or before this date
  scheduledBefore?: string; // Scheduled on or before this date
  filePattern?: string;     // Filter by file path substring
  search?: string;          // Free-text search in description
}
```

### `NewTaskOptions`

```typescript
interface NewTaskOptions {
  description: string;
  priority?: Priority;
  due?: string;             // YYYY-MM-DD
  scheduled?: string;       // YYYY-MM-DD
  start?: string;           // YYYY-MM-DD
  recurrence?: string;      // e.g. "every week"
  project?: string;         // Target project name (adds to project file instead of daily note)
}
```

### `AddNoteOptions`

```typescript
interface AddNoteOptions {
  content: string;          // The note content (can be multi-line)
  project?: string;         // Target project name (adds to project file instead of daily note)
  heading?: string;         // Target heading (default: "## Journal" for daily, "## Notes" for projects)
  changelogSummary?: string; // Explicit changelog summary (auto-generated if omitted, only for project notes)
}
```

### `ProjectInfo`

```typescript
interface ProjectInfo {
  name: string;             // Project name (from filename)
  filePath: string;         // Vault-relative path to project file
  status?: string;          // Frontmatter status field
  timeframe?: string;       // Frontmatter timeframe field
  tags?: string[];          // Frontmatter tags
}
```

### `Priority`

```typescript
type Priority = "highest" | "high" | "medium" | "low" | "lowest" | "none";
```

### `TaskStatus`

```typescript
type TaskStatus = "open" | "done" | "cancelled";
```

### `ChangelogEntry`

```typescript
interface ChangelogEntry {
  date: string;         // YYYY-MM-DD
  summary: string;      // The summary text
  project: string;      // Project name
  filePath: string;     // Vault-relative path to the project file
  line: number;         // Line number in the file (1-indexed)
}
```

### `ReviewSummary`

```typescript
interface ReviewSummary {
  since: string;            // Start of the review period (YYYY-MM-DD)
  until: string;            // End of the review period (YYYY-MM-DD)
  completed: Task[];        // Tasks completed during the period
  created: Task[];          // Tasks created during the period, still open
  stale: Task[];            // Open tasks with no due/scheduled date
  changelog: ChangelogEntry[]; // Project changelog entries during the period
  upcoming: Task[];         // Tasks due in the 7 days after the period
}
```
