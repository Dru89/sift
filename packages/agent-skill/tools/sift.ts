import { tool } from "@opencode-ai/plugin";
import { execFileSync } from "child_process";

/**
 * Resolve the sift CLI command. Checks in order:
 * 1. SIFT_CLI_PATH env var (absolute path to the built CLI entry point)
 * 2. "sift" on PATH (if globally linked via `npm link`)
 *
 * The install script sets SIFT_CLI_PATH, but if sift is on your PATH
 * it will just work without any env var.
 */
function getSiftCommand(): { command: string; prefixArgs: string[] } {
  if (process.env.SIFT_CLI_PATH) {
    return { command: "node", prefixArgs: [process.env.SIFT_CLI_PATH] };
  }
  return { command: "sift", prefixArgs: [] };
}

function runSift(args: string[]): string {
  const { command, prefixArgs } = getSiftCommand();
  try {
    const result = execFileSync(command, [...prefixArgs, ...args], {
      encoding: "utf-8",
      env: {
        ...process.env,
        // Strip color codes for cleaner output in agent context
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
      timeout: 15000,
    });
    return result.trim();
  } catch (error: any) {
    return `Error running sift: ${error.message}`;
  }
}

export const list = tool({
  description:
    "List open tasks from the Obsidian vault. Returns tasks sorted by priority and urgency.",
  args: {
    search: tool.schema
      .string()
      .optional()
      .describe("Filter tasks by text in description"),
    priority: tool.schema
      .enum(["highest", "high", "low", "lowest"])
      .optional()
      .describe("Minimum priority level to show"),
    dueBefore: tool.schema
      .string()
      .optional()
      .describe("Only show tasks due on or before this date (YYYY-MM-DD)"),
    all: tool.schema
      .boolean()
      .optional()
      .describe("Include completed and cancelled tasks"),
  },
  async execute(args) {
    const cliArgs = ["list", "--show-file"];
    if (args.search) cliArgs.push("--search", args.search);
    if (args.priority) cliArgs.push("--priority", args.priority);
    if (args.dueBefore) cliArgs.push("--due-before", args.dueBefore);
    if (args.all) cliArgs.push("--all");
    return runSift(cliArgs);
  },
});

export const next = tool({
  description:
    "Get the most important tasks to work on right now, sorted by priority and urgency.",
  args: {
    count: tool.schema
      .number()
      .optional()
      .describe("Number of tasks to show (default: 10)"),
  },
  async execute(args) {
    const cliArgs = ["next", "--show-file"];
    if (args.count) cliArgs.push("-n", String(args.count));
    return runSift(cliArgs);
  },
});

export const summary = tool({
  description:
    "Quick overview of task status: open count, overdue, due today, high priority, and what's up next.",
  args: {},
  async execute() {
    return runSift(["summary"]);
  },
});

export const add = tool({
  description:
    "Add a new task to today's daily note or to a specific project in Obsidian.",
  args: {
    description: tool.schema.string().describe("The task description"),
    priority: tool.schema
      .enum(["highest", "high", "low", "lowest"])
      .optional()
      .describe("Task priority level"),
    due: tool.schema
      .string()
      .optional()
      .describe("Due date in YYYY-MM-DD format"),
    scheduled: tool.schema
      .string()
      .optional()
      .describe("Scheduled date in YYYY-MM-DD format"),
    start: tool.schema
      .string()
      .optional()
      .describe("Start date in YYYY-MM-DD format"),
    recurrence: tool.schema
      .string()
      .optional()
      .describe("Recurrence rule, e.g. 'every week', 'every month'"),
    project: tool.schema
      .string()
      .optional()
      .describe(
        "Name of the project to add this task to. If omitted, the task goes to today's daily note.",
      ),
  },
  async execute(args) {
    const cliArgs = ["add"];
    if (args.priority) cliArgs.push("--priority", args.priority);
    if (args.due) cliArgs.push("--due", args.due);
    if (args.scheduled) cliArgs.push("--scheduled", args.scheduled);
    if (args.start) cliArgs.push("--start", args.start);
    if (args.recurrence) cliArgs.push("--recurrence", args.recurrence);
    if (args.project) cliArgs.push("--project", args.project);
    cliArgs.push("--", args.description);
    return runSift(cliArgs);
  },
});

export const find = tool({
  description:
    "Search for open tasks matching a query without modifying them. Returns matching tasks with file paths and line numbers. Use this before sift_done to preview which task will be completed.",
  args: {
    search: tool.schema
      .string()
      .describe("Text to search for in task descriptions"),
  },
  async execute(args) {
    return runSift(["find", "--show-file", "--", args.search]);
  },
});

export const done = tool({
  description:
    "Mark a task as complete. Supports two modes: (1) search mode — pass 'search' to find and complete by description, or (2) precise mode — pass 'file' and 'line' to complete an exact task. Prefer precise mode after using sift_find to identify the task.",
  args: {
    search: tool.schema
      .string()
      .optional()
      .describe(
        "Text to search for in task descriptions. Use this OR file+line, not both.",
      ),
    file: tool.schema
      .string()
      .optional()
      .describe(
        "File path (relative to vault root) for precise completion. Must be used with 'line'.",
      ),
    line: tool.schema
      .number()
      .optional()
      .describe(
        "Line number (1-indexed) for precise completion. Must be used with 'file'.",
      ),
  },
  async execute(args) {
    // Precise mode: file + line
    if (args.file && args.line) {
      return runSift([
        "done",
        "--file",
        args.file,
        "--line",
        String(args.line),
      ]);
    }

    // Search mode
    if (args.search) {
      return runSift(["done", "--", args.search]);
    }

    return "Error: provide either 'search' or both 'file' and 'line'";
  },
});

export const projects = tool({
  description:
    "List all projects in the vault. Returns project names, statuses, and tags.",
  args: {
    tag: tool.schema
      .string()
      .optional()
      .describe("Filter to only show projects with this tag"),
  },
  async execute(args) {
    const cliArgs = ["projects"];
    if (args.tag) cliArgs.push("--tag", args.tag);
    return runSift(cliArgs);
  },
});

export const project_create = tool({
  description: "Create a new project from the vault's project template.",
  args: {
    name: tool.schema
      .string()
      .describe("The project name (becomes the filename)"),
  },
  async execute(args) {
    return runSift(["project", "create", "--", args.name]);
  },
});

export const project_path = tool({
  description:
    "Get the vault-relative file path for a project. Useful when you need to read or edit a project file directly.",
  args: {
    name: tool.schema
      .string()
      .describe("The project name to look up"),
  },
  async execute(args) {
    return runSift(["project", "path", "--", args.name]);
  },
});

export const note = tool({
  description:
    "Add a freeform note to today's daily note or to a project. Use this for non-task content like observations, decisions, meeting notes, or project updates.",
  args: {
    content: tool.schema
      .string()
      .describe("The note content (can be multi-line)"),
    project: tool.schema
      .string()
      .optional()
      .describe(
        "Name of the project to add the note to. If omitted, the note goes to today's daily note.",
      ),
    heading: tool.schema
      .string()
      .optional()
      .describe(
        "The heading to insert the note under. Defaults to '## Notes' for projects, '## Journal' for daily notes. Use this to target any heading in the file (e.g., '## Accomplishments', '## Meeting Notes', '## Goals'). If the heading doesn't exist, it will be created.",
      ),
    changelogSummary: tool.schema
      .string()
      .optional()
      .describe(
        "A short one-liner for the changelog entry (e.g. 'Decided to use ID3v2.4 format'). Always provide this when adding a note to a project — do not rely on the auto-generated default.",
      ),
  },
  async execute(args) {
    const cliArgs = ["note"];
    if (args.project) cliArgs.push("--project", args.project);
    if (args.heading) cliArgs.push("--heading", args.heading);
    if (args.changelogSummary) cliArgs.push("--changelog-summary", args.changelogSummary);
    cliArgs.push("--", args.content);
    return runSift(cliArgs);
  },
});

export const project_set = tool({
  description:
    "Update frontmatter fields on a project (status, timeframe, tags). Use this to change a project's status (active, planning, someday, done), timeframe, or tags.",
  args: {
    name: tool.schema.string().describe("The project name"),
    status: tool.schema
      .enum(["active", "planning", "someday", "done"])
      .optional()
      .describe("New project status"),
    timeframe: tool.schema
      .string()
      .optional()
      .describe("New project timeframe (e.g. 'Q2 2026')"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("New tag list (replaces existing tags)"),
  },
  async execute(args) {
    const cliArgs = ["project", "set"];
    if (args.status) cliArgs.push("--status", args.status);
    if (args.timeframe) cliArgs.push("--timeframe", args.timeframe);
    if (args.tags && args.tags.length > 0) cliArgs.push("--tags", ...args.tags);
    cliArgs.push("--", args.name);
    return runSift(cliArgs);
  },
});

export const mark = tool({
  description:
    "Mark a task with any status (in_progress, on_hold, moved, cancelled, open, done). Supports two modes: (1) search mode — pass 'search' to find and mark by description, or (2) precise mode — pass 'file' and 'line'. Prefer precise mode after using sift_find.",
  args: {
    status: tool.schema
      .enum(["open", "in_progress", "on_hold", "moved", "cancelled", "done"])
      .describe("The new status to set on the task"),
    search: tool.schema
      .string()
      .optional()
      .describe("Text to search for in task descriptions. Use this OR file+line, not both."),
    file: tool.schema
      .string()
      .optional()
      .describe("File path (relative to vault root) for precise targeting. Must be used with 'line'."),
    line: tool.schema
      .number()
      .optional()
      .describe("Line number (1-indexed) for precise targeting. Must be used with 'file'."),
  },
  async execute(args) {
    const cliArgs = ["mark", "--status", args.status];
    if (args.file && args.line) {
      cliArgs.push("--file", args.file, "--line", String(args.line));
    } else if (args.search) {
      cliArgs.push("--", args.search);
    } else {
      return "Error: provide either 'search' or both 'file' and 'line'";
    }
    return runSift(cliArgs);
  },
});

export const review = tool({
  description:
    "Generate a review summary for a time period. Shows tasks completed, tasks created (still open), stale tasks (no dates), project changelog entries, and upcoming tasks. Defaults to since last Friday.",
  args: {
    since: tool.schema
      .string()
      .optional()
      .describe("Start of review period (YYYY-MM-DD). Defaults to last Friday."),
    until: tool.schema
      .string()
      .optional()
      .describe("End of review period (YYYY-MM-DD). Defaults to today."),
    days: tool.schema
      .number()
      .optional()
      .describe("Review the last N days (alternative to --since)"),
  },
  async execute(args) {
    const cliArgs = ["review"];
    if (args.days) cliArgs.push("--days", String(args.days));
    else if (args.since) cliArgs.push("--since", args.since);
    if (args.until) cliArgs.push("--until", args.until);
    return runSift(cliArgs);
  },
});
