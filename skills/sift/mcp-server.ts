#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "child_process";
import {
  toolList,
  toolNext,
  toolThreadCreate,
  toolThreadEntry,
  toolThreadState,
  toolThreadList,
  toolSummary,
  toolAgenda,
  toolAdd,
  toolFind,
  toolDone,
  toolMark,
  toolUpdate,
  toolMove,
  toolProjects,
  toolProjectCreate,
  toolProjectPath,
  toolProjectSet,
  toolProjectReview,
  toolAreaCreate,
  toolAreaPath,
  toolNote,
  toolSubnote,
  toolTriage,
  toolReview,
  toolPromote,
} from "./tool-impls.js";

/**
 * Run an Obsidian CLI command. Requires Obsidian to be running.
 */
function runObsidian(args: string[]): string {
  try {
    const result = execFileSync("obsidian", args, {
      encoding: "utf-8",
      timeout: 15000,
    });
    return result.trim();
  } catch (error: any) {
    if (error.message?.includes("ENOENT")) {
      return "Error: Obsidian CLI is not installed. Install it in Obsidian Settings → General → Command line interface.";
    }
    if (error.message?.includes("ETIMEDOUT")) {
      return "Error: Obsidian CLI timed out. Make sure Obsidian is running.";
    }
    // The CLI returns errors on stderr; try to extract a useful message
    const stderr = error.stderr?.toString()?.trim();
    if (stderr) return `Error: ${stderr}`;
    return `Error running obsidian: ${error.message}`;
  }
}

// Define the tools
const tools: Tool[] = [
  {
    name: "list",
    description:
      "List open tasks from the Obsidian vault. Returns tasks sorted by priority and urgency.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Filter tasks by text in description",
        },
        priority: {
          type: "string",
          enum: ["highest", "high", "low", "lowest"],
          description: "Minimum priority level to show",
        },
        dueBefore: {
          type: "string",
          description: "Only show tasks due on or before this date (YYYY-MM-DD)",
        },
        scheduledBefore: {
          type: "string",
          description: "Only show tasks scheduled on or before this date (YYYY-MM-DD)",
        },
        all: {
          type: "boolean",
          description: "Include completed and cancelled tasks",
        },
        project: {
          type: "string",
          description: "Only show tasks from this project's file (case-insensitive project name). When the name resolves to an area, automatically includes tasks from all projects linked to that area.",
        },
        groupByProject: {
          type: "boolean",
          description: "Group results by project/area. Only applies when 'project' resolves to an area with linked projects.",
        },
      },
    },
  },
  {
    name: "next",
    description:
      "Get the most important tasks to work on right now, sorted by priority and urgency.",
    inputSchema: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Number of tasks to show (default: 10)",
        },
      },
    },
  },
  {
    name: "summary",
    description:
      "Quick overview of task status: today's agenda, counts, and what's up next.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "agenda",
    description:
      "Show tasks relevant to today: due today, overdue, scheduled for today or past, in-progress, and newly available. Use this when the user asks 'what's on my plate today?' or 'what should I focus on today?'",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "add",
    description:
      "Add a new task to today's daily note or to a specific project in Obsidian. Use the 'project' parameter to add directly to a project file instead of the daily note.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "The task description",
        },
        priority: {
          type: "string",
          enum: ["highest", "high", "low", "lowest"],
          description: "Task priority level",
        },
        due: {
          type: "string",
          description: "Due date in YYYY-MM-DD format",
        },
        scheduled: {
          type: "string",
          description: "Scheduled date in YYYY-MM-DD format",
        },
        start: {
          type: "string",
          description: "Start date in YYYY-MM-DD format",
        },
        recurrence: {
          type: "string",
          description: "Recurrence rule, e.g. 'every week', 'every month'",
        },
        project: {
          type: "string",
          description:
            "Name of the project to add this task to. If omitted, the task goes to today's daily note.",
        },
        date: {
          type: "string",
          description:
            "Target daily note date in YYYY-MM-DD format. Defaults to today. Ignored when project is set.",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "find",
    description:
      "Search for open tasks matching a query without modifying them. Returns matching tasks with file paths and line numbers. Use this before sift_done to preview which task will be completed.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Text to search for in task descriptions (tokenized: each word matched independently, markdown syntax stripped)",
        },
        all: {
          type: "boolean",
          description: "Include all tasks regardless of status (default: only open/in_progress)",
        },
        status: {
          type: "string",
          enum: ["open", "in_progress", "done", "cancelled", "on_hold", "moved"],
          description: "Filter to a specific status. Overrides the default open/in_progress filter. Use 'done' to find recently completed tasks.",
        },
      },
      required: ["search"],
    },
  },
  {
    name: "done",
    description:
      "Mark a task as complete. Supports two modes: (1) search mode — pass 'search' to find and complete by description, or (2) precise mode — pass 'file' and 'line' to complete an exact task. Prefer precise mode after using sift_find to identify the task. IMPORTANT: You MUST call sift_find first, show the user the exact task you found, and get their explicit confirmation BEFORE calling this tool. Never call sift_done in the same turn as sift_find.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description:
            "Text to search for in task descriptions. Use this OR file+line, not both.",
        },
        file: {
          type: "string",
          description:
            "Absolute file path from sift_find output (also accepts vault-relative paths). Must be used with 'line'.",
        },
        line: {
          type: "number",
          description:
            "Line number (1-indexed) from sift_find output. Must be used with 'file'.",
        },
        description: {
          type: "string",
          description:
            "Partial task text for safety verification. Pass a few words from the task description to confirm the right task is at this line.",
        },
      },
    },
  },
  {
    name: "projects",
    description:
      "List all projects in the vault. Returns project names, statuses, and tags.",
    inputSchema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          description: "Filter to only show projects with this tag",
        },
        kind: {
          type: "string",
          enum: ["project", "area"],
          description: "Filter by kind: 'project' or 'area'. If omitted, returns both.",
        },
      },
    },
  },
  {
    name: "project_create",
    description:
      "Create a new project from the vault's project template.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The project name (becomes the filename)",
        },
        status: {
          type: "string",
          description: "Initial project status (e.g. active, planning, someday)",
        },
        area: {
          type: "string",
          description: "Parent area name to associate the project with",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags without # prefix (e.g. 'work,personal')",
        },
        content: {
          type: "string",
          description: "Initial overview content inserted under ## Overview. Do not include '## Overview' in the content itself.",
        },
        frontmatter: {
          type: "string",
          description: "Additional frontmatter fields as a JSON string",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "project_path",
    description:
      "Get the absolute file path for a project. Useful when you need to read or edit a project file directly.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The project name to look up",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "note",
    description:
      "Add a freeform note to today's daily note or to a project.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The note content (can be multi-line).",
        },
        project: {
          type: "string",
          description:
            "Name of the project to add this note to. If omitted, the note goes to today's daily note.",
        },
        heading: {
          type: "string",
          description:
            "The heading to insert the note under. Defaults to '## Notes' for projects, '## Journal' for daily notes. Use this to target any heading in the file (e.g., '## Work Log', '## Meeting Notes', '## Goals'). If the heading doesn't exist, it will be created.",
        },
        date: {
          type: "string",
          description:
            "Target daily note date (YYYY-MM-DD). Defaults to today. Ignored when project is set.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "subnote",
    description:
      "Create a new note file linked to a project. Use this instead of sift_note when the content is long (>20 lines), self-contained (design spec, meeting notes, API reference), or has a different lifecycle than the project file itself. Creates the file and inserts a wiki link in the project. To also create a trackable task, call sift_add separately with a wiki link to the subnote in the description.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Name of the project to link this note to.",
        },
        title: {
          type: "string",
          description:
            "Title for the subnote. Used in the filename (YYYY-MM-DD - <title>.md) and as a heading.",
        },
        content: {
          type: "string",
          description: "The content of the subnote (can be multi-line markdown).",
        },
        folder: {
          type: "string",
          description:
            "Folder to create the note in, relative to vault root. Defaults to 'Notes'. Use 'Meetings' for meeting notes.",
        },
        type: {
          type: "string",
          description:
            "Frontmatter type field. Defaults to 'note'. Use 'meeting' for meeting notes.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to add to the subnote frontmatter.",
        },
        heading: {
          type: "string",
          description:
            "Heading in the project file to insert the backlink under. Defaults to '## Notes'.",
        },
      },
      required: ["project", "title"],
    },
  },
  {
    name: "area_create",
    description:
      "Create a new area from the vault's area template.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The area name (becomes the filename)",
        },
        tags: {
          type: "string",
          description: "Comma-separated tags without # prefix (e.g. 'work,personal')",
        },
        content: {
          type: "string",
          description: "Initial overview content inserted under ## Overview. Do not include '## Overview' in the content itself.",
        },
        frontmatter: {
          type: "string",
          description: "Additional frontmatter fields as a JSON string",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "area_path",
    description:
      "Get the absolute file path for an area. Useful when you need to read or edit an area file directly.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The area name to look up",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "project_set",
    description:
      "Update frontmatter fields on a project or area (status, timeframe, tags, reviewInterval). Use this to change a project's or area's status (active, planning, someday, done), timeframe, tags, or review cadence.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The project name",
        },
        status: {
          type: "string",
          enum: ["active", "planning", "someday", "done"],
          description: "New project status",
        },
        timeframe: {
          type: "string",
          description: "New project timeframe (e.g. 'Q2 2026')",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tag list (replaces existing tags)",
        },
        reviewInterval: {
          type: "number",
          description: "Review interval in days. Overrides the per-status default (active: 7, planning: 14, areas: 14, someday: 30).",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "mark",
    description:
      "Mark a task with any status (in_progress, on_hold, moved, cancelled, open, done). Supports two modes: (1) search mode — pass 'search' to find and mark by description, or (2) precise mode — pass 'file' and 'line'. Prefer precise mode after using sift_find. IMPORTANT: You MUST call sift_find first, show the user the exact task you found, and get their explicit confirmation BEFORE calling this tool. Never call sift_mark in the same turn as sift_find.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "in_progress", "on_hold", "moved", "cancelled", "done"],
          description: "The new status to set on the task",
        },
        search: {
          type: "string",
          description:
            "Text to search for in task descriptions. Use this OR file+line, not both.",
        },
        file: {
          type: "string",
          description:
            "Absolute file path from sift_find output (also accepts vault-relative paths). Must be used with 'line'.",
        },
        line: {
          type: "number",
          description:
            "Line number (1-indexed) for precise targeting. Must be used with 'file'.",
        },
        description: {
          type: "string",
          description:
            "Partial task text for safety verification. Pass a few words from the task description to confirm the right task is at this line.",
        },
      },
      required: ["status"],
    },
  },
  {
    name: "update",
    description:
      "Modify a task's metadata in place (dates, priority). Operates by file + line like sift_done and sift_mark. Use sift_find first to locate the task. IMPORTANT: You MUST call sift_find first, show the user the exact task you found, and get their explicit confirmation BEFORE calling this tool.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Absolute file path from sift_find output (also accepts vault-relative paths). Required.",
        },
        line: {
          type: "number",
          description: "Line number (1-indexed) from sift_find output. Required.",
        },
        description: {
          type: "string",
          description: "Partial task text for safety verification.",
        },
        priority: {
          type: "string",
          enum: ["highest", "high", "low", "lowest", "none"],
          description: "New priority level, or 'none' to remove priority.",
        },
        due: {
          type: "string",
          description: "New due date (YYYY-MM-DD), or 'none' to remove.",
        },
        scheduled: {
          type: "string",
          description: "New scheduled date (YYYY-MM-DD), or 'none' to remove.",
        },
        start: {
          type: "string",
          description: "New start date (YYYY-MM-DD), or 'none' to remove.",
        },
      },
      required: ["file", "line"],
    },
  },
  {
    name: "move",
    description:
      "Move a task from one file to another. Removes the task from the source file and inserts it in the destination. Use sift_find first to locate the task. IMPORTANT: This is a destructive operation. You MUST call sift_find first, show the user the exact task and intended destination, and get their explicit confirmation BEFORE calling this tool.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Source file path (absolute or vault-relative). Required.",
        },
        line: {
          type: "number",
          description: "Source line number (1-indexed). Required.",
        },
        description: {
          type: "string",
          description: "Partial task text for safety verification.",
        },
        project: {
          type: "string",
          description: "Destination project or area name (inserts under ## Tasks). Use this OR 'date', not both.",
        },
        date: {
          type: "string",
          description: "Destination daily note date YYYY-MM-DD (inserts under ## Journal). Use this OR 'project', not both.",
        },
      },
      required: ["file", "line"],
    },
  },
  {
    name: "project_review",
    description:
      "Stamp lastReviewed: today on a project or area's frontmatter. Call this after reviewing a project's tasks and status during a review session.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The project or area name to mark as reviewed.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "triage",
    description:
      "Return a tiered project review summary. Tier 1: projects needing attention (stale tasks, inactive, overdue reviews, orphan mentions). Tier 2: due for review but look healthy (name, task count, top tasks). Tier 3: not due (names only). Plus loose tasks from recent daily notes. Use this to run a project review session.",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional: get full detail on a single project instead of the full triage.",
        },
      },
    },
  },
  {
    name: "review",
    description:
      "Generate a review summary for a time period. Shows tasks completed, tasks created (still open), tasks needing triage (no dates or stale high-priority), project changelog entries, and upcoming tasks. Defaults to since last Friday.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "string",
          description: "Start of review period (YYYY-MM-DD). Defaults to last Friday.",
        },
        until: {
          type: "string",
          description: "End of review period (YYYY-MM-DD). Defaults to today.",
        },
        days: {
          type: "number",
          description: "Review the last N days (alternative to --since)",
        },
      },
    },
  },
  // ─── Graph / context tools ─────────────────────────────────
  {
    name: "graph",
    description:
      "Return the structural context for an area or project using Obsidian backlinks. Buckets all files that link to the target into: projects (child projects), notes (subnotes and reference material), and other (emails, weblinks, etc.). Daily notes and weekly notes are excluded. Use this to orient before doing work on an area — one call reveals what projects and reference material are connected without requiring the user to enumerate them. Requires Obsidian to be running.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Area or project name (wikilink-style resolution, e.g. 'Sift', 'Homelab').",
        },
      },
      required: ["name"],
    },
  },
  // ─── Obsidian CLI tools ────────────────────────────────────
  {
    name: "vault_open",
    description:
      "Open a file in Obsidian. Use this when the user asks to open, view, or navigate to a vault file. Requires Obsidian to be running.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "File name (wikilink-style resolution, e.g., 'Sift' finds 'Projects/Sift.md') or exact path.",
        },
        newTab: {
          type: "boolean",
          description: "Open in a new tab instead of replacing the current one.",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "vault_search",
    description:
      "Full-text search across the entire Obsidian vault. Returns matching file paths with line numbers and surrounding context. Requires Obsidian to be running.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query text.",
        },
        path: {
          type: "string",
          description:
            "Optional folder path to limit search scope (e.g., 'Projects', 'Daily Notes').",
        },
        limit: {
          type: "number",
          description: "Maximum number of files to return (default: no limit).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "vault_backlinks",
    description:
      "List all files that link to a given file. Useful for finding related daily notes, meetings, and project references. Requires Obsidian to be running.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "File name to find backlinks for. Uses wikilink-style resolution (e.g., 'Sift' finds 'Projects/Sift.md').",
        },
        counts: {
          type: "boolean",
          description: "Include link counts per file.",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "vault_read",
    description:
      "Read the contents of a vault file by name (wikilink-style resolution) or exact path. Requires Obsidian to be running.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "File name (wikilink-style resolution, e.g., 'Sift' finds 'Projects/Sift.md') or exact path.",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "vault_outline",
    description:
      "Show the heading structure of a vault file. Returns a tree of headings with their levels. Useful for understanding file structure before reading specific sections. Requires Obsidian to be running.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "File name (wikilink-style resolution) or exact path.",
        },
      },
      required: ["file"],
    },
  },
  // ─── Thread Tools ────────────────────────────────────────────
  {
    name: "thread_create",
    description:
      "Start a new thread on an existing task. A thread tracks an async conversation with another person or team.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path containing the task" },
        line: { type: "number", description: "Line number of the task (1-indexed)" },
        counterparts: {
          type: "array",
          items: { type: "string" },
          description: "People or teams involved (wiki link names or plain text)",
        },
        state: {
          type: "string",
          enum: ["active", "waiting", "paused", "resolved"],
          description: "Initial state. Default: active",
        },
        followUp: { type: "string", description: "Follow-up date (YYYY-MM-DD)" },
        source: { type: "string", description: "URL or markdown link to conversation location" },
        content: { type: "string", description: "First entry description" },
        date: { type: "string", description: "Date for first entry (YYYY-MM-DD). Default: today" },
        description: { type: "string", description: "Partial task text for safety verification" },
      },
      required: ["file", "line", "counterparts"],
    },
  },
  {
    name: "thread_entry",
    description:
      "Add a timestamped entry to an existing thread. Optionally update state and follow-up simultaneously.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path containing the task" },
        line: { type: "number", description: "Line number of the task (1-indexed)" },
        content: { type: "string", description: "What happened (one line)" },
        state: {
          type: "string",
          enum: ["active", "waiting", "paused", "resolved"],
          description: "Change thread state simultaneously",
        },
        followUp: { type: "string", description: "Set/update follow-up date. Pass 'none' to clear." },
        date: { type: "string", description: "Entry date (YYYY-MM-DD). Default: today" },
        description: { type: "string", description: "Partial task text for safety verification" },
      },
      required: ["file", "line", "content"],
    },
  },
  {
    name: "thread_state",
    description:
      "Change thread metadata without adding an entry. Updates state, follow-up, counterparts, or source.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path containing the task" },
        line: { type: "number", description: "Line number of the task (1-indexed)" },
        state: {
          type: "string",
          enum: ["active", "waiting", "paused", "resolved"],
          description: "New state",
        },
        followUp: { type: "string", description: "Set/update/clear follow-up. 'none' to clear." },
        counterparts: {
          type: "array",
          items: { type: "string" },
          description: "Replace counterpart list",
        },
        source: { type: "string", description: "Update source link. 'none' to clear." },
        description: { type: "string", description: "Partial task text for safety verification" },
      },
      required: ["file", "line"],
    },
  },
  {
    name: "thread_list",
    description:
      "List threads filtered by state. The 'waiting for' view — shows conversations needing attention.",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          type: "string",
          enum: ["active", "waiting", "paused", "resolved"],
          description: "Filter by state. Default: active + waiting",
        },
        stale: {
          type: "boolean",
          description: "Only show stale threads (past follow-up or undated waiting > 2 days)",
        },
        counterpart: { type: "string", description: "Filter by counterpart name" },
        project: { type: "string", description: "Filter to threads within a specific project" },
      },
    },
  },
  {
    name: "promote",
    description:
      "Upgrade a task to a project. Moves the task (and any attached thread) into a new project file.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "File path containing the task" },
        line: { type: "number", description: "Line number of the task (1-indexed)" },
        name: { type: "string", description: "Project name. Default: task description." },
        area: { type: "string", description: "Parent area for the new project" },
        status: { type: "string", description: "Initial project status. Default: active" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for the new project",
        },
        description: { type: "string", description: "Partial task text for safety verification" },
      },
      required: ["file", "line"],
    },
  },
];

// Create server instance
const server = new Server(
  {
    name: "sift",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools,
  };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "list": {
        const result = await toolList({
          search: args?.search as string | undefined,
          priority: args?.priority as string | undefined,
          dueBefore: args?.dueBefore as string | undefined,
          scheduledBefore: args?.scheduledBefore as string | undefined,
          all: args?.all as boolean | undefined,
          project: args?.project as string | undefined,
        });
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "next": {
        const result = await toolNext({
          count: args?.count as number | undefined,
        });
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "summary": {
        const result = await toolSummary();
        return { content: [{ type: "text", text: result }] };
      }

      case "agenda": {
        const result = await toolAgenda();
        return { content: [{ type: "text", text: result }] };
      }

      case "add": {
        const result = await toolAdd({
          description: args!.description as string,
          priority: args?.priority as string | undefined,
          due: args?.due as string | undefined,
          scheduled: args?.scheduled as string | undefined,
          start: args?.start as string | undefined,
          recurrence: args?.recurrence as string | undefined,
          project: args?.project as string | undefined,
          date: args?.date as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "find": {
        const result = await toolFind({
          search: args!.search as string,
          all: args?.all as boolean | undefined,
          status: args?.status as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "done": {
        const result = await toolDone({
          file: args?.file as string | undefined,
          line: args?.line as number | undefined,
          search: args?.search as string | undefined,
          description: args?.description as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "projects": {
        const result = await toolProjects({
          tag: args?.tag as string | undefined,
          kind: args?.kind as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "project_create": {
        const result = await toolProjectCreate({
          name: args!.name as string,
          status: args?.status as string | undefined,
          area: args?.area as string | undefined,
          tags: args?.tags as string | undefined,
          content: args?.content as string | undefined,
          frontmatter: args?.frontmatter as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "project_path": {
        const result = await toolProjectPath({ name: args!.name as string });
        return { content: [{ type: "text", text: result }] };
      }

      case "area_create": {
        const result = await toolAreaCreate({
          name: args!.name as string,
          tags: args?.tags as string | undefined,
          content: args?.content as string | undefined,
          frontmatter: args?.frontmatter as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "area_path": {
        const result = await toolAreaPath({ name: args!.name as string });
        return { content: [{ type: "text", text: result }] };
      }

      case "note": {
        const result = await toolNote({
          content: args!.content as string,
          project: args?.project as string | undefined,
          heading: args?.heading as string | undefined,
          date: args?.date as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "subnote": {
        const result = await toolSubnote({
          project: args!.project as string,
          title: args!.title as string,
          content: args?.content as string | undefined,
          folder: args?.folder as string | undefined,
          type: args?.type as string | undefined,
          tags: args?.tags as string[] | undefined,
          heading: args?.heading as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "project_set": {
        const result = await toolProjectSet({
          name: args!.name as string,
          status: args?.status as string | undefined,
          timeframe: args?.timeframe as string | undefined,
          tags: args?.tags as string[] | undefined,
          reviewInterval: args?.reviewInterval as number | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "mark": {
        const result = await toolMark({
          status: args!.status as string,
          file: args?.file as string | undefined,
          line: args?.line as number | undefined,
          search: args?.search as string | undefined,
          description: args?.description as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "update": {
        const result = await toolUpdate({
          file: args!.file as string,
          line: args!.line as number,
          description: args?.description as string | undefined,
          priority: args?.priority as string | undefined,
          due: args?.due as string | undefined,
          scheduled: args?.scheduled as string | undefined,
          start: args?.start as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "move": {
        const result = await toolMove({
          file: args!.file as string,
          line: args!.line as number,
          description: args?.description as string | undefined,
          project: args?.project as string | undefined,
          date: args?.date as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "project_review": {
        const result = await toolProjectReview({ name: args!.name as string });
        return { content: [{ type: "text", text: result }] };
      }

      case "triage": {
        const result = await toolTriage({
          project: args?.project as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "review": {
        const result = await toolReview({
          days: args?.days as number | undefined,
          since: args?.since as string | undefined,
          until: args?.until as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      // ─── Graph / context tools ─────────────────────────────────

      case "graph": {
        const raw = runObsidian(["backlinks", `file=${args?.name as string}`, "format=json"]);
        if (raw.startsWith("Error")) {
          return { content: [{ type: "text", text: raw }], isError: true };
        }

        const SKIP_PREFIXES = ["Daily Notes/", "Weekly Notes/"];
        const PROJECT_PREFIX = "Projects/";
        const NOTE_PREFIXES = ["Notes/", "Meetings/"];

        let backlinks: Array<{ file: string }>;
        try {
          backlinks = JSON.parse(raw);
        } catch {
          return { content: [{ type: "text", text: `Error parsing backlinks: ${raw}` }], isError: true };
        }

        const graph: { projects: string[]; notes: string[]; other: string[] } = {
          projects: [],
          notes: [],
          other: [],
        };

        for (const { file } of backlinks) {
          if (SKIP_PREFIXES.some(p => file.startsWith(p))) continue;
          if (file.startsWith(PROJECT_PREFIX)) {
            graph.projects.push(file.slice(PROJECT_PREFIX.length).replace(/\.md$/, ""));
          } else if (NOTE_PREFIXES.some(p => file.startsWith(p))) {
            graph.notes.push(file);
          } else {
            graph.other.push(file);
          }
        }

        const lines: string[] = [`Graph: ${args?.name as string}`];
        if (graph.projects.length) {
          lines.push("", "Projects:", ...graph.projects.map(p => `  - ${p}`));
        }
        if (graph.notes.length) {
          lines.push("", "Notes:", ...graph.notes.map(n => `  - ${n}`));
        }
        if (graph.other.length) {
          lines.push("", "Other:", ...graph.other.map(o => `  - ${o}`));
        }
        if (!graph.projects.length && !graph.notes.length && !graph.other.length) {
          lines.push("  (no backlinks found)");
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      // ─── Obsidian CLI tools ────────────────────────────────────

      case "vault_open": {
        const fileArg = args?.file as string;
        const paramName = fileArg.includes("/") || fileArg.includes("\\") ? "path" : "file";
        const cliArgs = ["open", `${paramName}=${fileArg}`];
        if (args?.newTab) cliArgs.push("newtab");
        const result = runObsidian(cliArgs);
        return {
          content: [{ type: "text", text: result || "Opened in Obsidian." }],
        };
      }

      case "vault_search": {
        const cliArgs = ["search:context", `query=${args?.query as string}`, "format=json"];
        if (args?.path) cliArgs.push(`path=${args.path as string}`);
        if (args?.limit) cliArgs.push(`limit=${String(args.limit)}`);
        const result = runObsidian(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "vault_backlinks": {
        const cliArgs = ["backlinks", `file=${args?.file as string}`, "format=json"];
        if (args?.counts) cliArgs.push("counts");
        const result = runObsidian(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "vault_read": {
        // Determine if this is a name or a path (handles both / and \ separators)
        const fileArg = args?.file as string;
        const paramName = fileArg.includes("/") || fileArg.includes("\\") ? "path" : "file";
        const result = runObsidian(["read", `${paramName}=${fileArg}`]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "vault_outline": {
        const fileArg = args?.file as string;
        const paramName = fileArg.includes("/") || fileArg.includes("\\") ? "path" : "file";
        const result = runObsidian(["outline", `${paramName}=${fileArg}`, "format=json"]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      // ─── Thread Tools (direct core import) ──────────────────
      case "thread_create": {
        const result = await toolThreadCreate({
          file: args!.file as string,
          line: args!.line as number,
          counterparts: args!.counterparts as string[],
          state: args?.state as any,
          followUp: args?.followUp as string | undefined,
          source: args?.source as string | undefined,
          content: args?.content as string | undefined,
          date: args?.date as string | undefined,
          description: args?.description as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "thread_entry": {
        const result = await toolThreadEntry({
          file: args!.file as string,
          line: args!.line as number,
          content: args!.content as string,
          state: args?.state as any,
          followUp: args?.followUp as string | undefined,
          date: args?.date as string | undefined,
          description: args?.description as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "thread_state": {
        const result = await toolThreadState({
          file: args!.file as string,
          line: args!.line as number,
          state: args?.state as any,
          followUp: args?.followUp as string | undefined,
          counterparts: args?.counterparts as string[] | undefined,
          source: args?.source as string | undefined,
          description: args?.description as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "thread_list": {
        const result = await toolThreadList({
          state: args?.state as any,
          stale: args?.stale as boolean | undefined,
          counterpart: args?.counterpart as string | undefined,
          project: args?.project as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      case "promote": {
        const result = await toolPromote({
          file: args!.file as string,
          line: args!.line as number,
          name: args?.name as string | undefined,
          area: args?.area as string | undefined,
          status: args?.status as string | undefined,
          tags: args?.tags as string[] | undefined,
          description: args?.description as string | undefined,
        });
        return { content: [{ type: "text", text: result }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sift MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
