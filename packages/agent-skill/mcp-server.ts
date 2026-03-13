#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "child_process";

/**
 * Resolve the sift CLI command. Checks in order:
 * 1. SIFT_CLI_PATH env var (absolute path to the built CLI entry point)
 * 2. "sift" on PATH (if globally linked via `npm link`)
 *
 * In both cases, the CLI is executed via process.execPath (the same Node
 * binary running this MCP server) to avoid shebang-based PATH resolution
 * picking up an incompatible Node version in restricted environments
 * like Claude Desktop.
 */
function getSiftCommand(): { command: string; prefixArgs: string[] } {
  if (process.env.SIFT_CLI_PATH) {
    return { command: process.execPath, prefixArgs: [process.env.SIFT_CLI_PATH] };
  }

  // Resolve "sift" on PATH to its real file path, then run it via
  // process.execPath so we bypass the #!/usr/bin/env node shebang.
  try {
    const which = execFileSync("which", ["sift"], { encoding: "utf-8" }).trim();
    if (which) {
      return { command: process.execPath, prefixArgs: [which] };
    }
  } catch {
    // fall through
  }

  // Last resort: hope "sift" works directly
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

// Define the tools
const tools: Tool[] = [
  {
    name: "sift_list",
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
        all: {
          type: "boolean",
          description: "Include completed and cancelled tasks",
        },
      },
    },
  },
  {
    name: "sift_next",
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
    name: "sift_summary",
    description:
      "Quick overview of task status: open count, overdue, due today, high priority, and what's up next.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "sift_add",
    description:
      "Add a new task to today's daily note or to a specific project in Obsidian.",
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
    name: "sift_find",
    description:
      "Search for open tasks matching a query without modifying them. Returns matching tasks with file paths and line numbers. Use this before sift_done to preview which task will be completed.",
    inputSchema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Text to search for in task descriptions",
        },
      },
      required: ["search"],
    },
  },
  {
    name: "sift_done",
    description:
      "Mark a task as complete by precise file path and line number. IMPORTANT: You MUST call sift_find first, show the user the exact task you found, and get their explicit confirmation BEFORE calling this tool. Never call sift_done in the same turn as sift_find.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description:
            "File path (relative to vault root) from sift_find output.",
        },
        line: {
          type: "number",
          description:
            "Line number (1-indexed) from sift_find output.",
        },
      },
      required: ["file", "line"],
    },
  },
  {
    name: "sift_projects",
    description:
      "List all projects in the vault. Returns project names, statuses, and tags.",
    inputSchema: {
      type: "object",
      properties: {
        tag: {
          type: "string",
          description: "Filter to only show projects with this tag",
        },
      },
    },
  },
  {
    name: "sift_project_create",
    description:
      "Create a new project from the vault's project template.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The project name (becomes the filename)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "sift_project_path",
    description:
      "Get the vault-relative file path for a project. Useful when you need to read or edit a project file directly.",
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
    name: "sift_note",
    description:
      "Add a freeform note to today's daily note or to a project. Use this for non-task content like observations, decisions, meeting notes, or project updates.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The note content (can be multi-line)",
        },
        project: {
          type: "string",
          description:
            "Name of the project to add the note to. If omitted, the note goes to today's daily note.",
        },
        heading: {
          type: "string",
          description:
            "The heading to insert the note under. Defaults to '## Notes' for projects, '## Journal' for daily notes. Use this to target any heading in the file (e.g., '## Accomplishments', '## Meeting Notes', '## Goals'). If the heading doesn't exist, it will be created.",
        },
        changelogSummary: {
          type: "string",
          description:
            "A short one-liner for the changelog entry (e.g. 'Decided to use ID3v2.4 format'). Always provide this when adding a note to a project — do not rely on the auto-generated default.",
        },
        date: {
          type: "string",
          description:
            "Target daily note date in YYYY-MM-DD format. Defaults to today. Ignored when project is set.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "sift_project_set",
    description:
      "Update frontmatter fields on a project (status, timeframe, tags). Use this to change a project's status (active, planning, someday, done), timeframe, or tags.",
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
      },
      required: ["name"],
    },
  },
  {
    name: "sift_mark",
    description:
      "Mark a task with any status (in_progress, on_hold, moved, cancelled, open, done) by precise file path and line number. IMPORTANT: You MUST call sift_find first, show the user the exact task you found, and get their explicit confirmation BEFORE calling this tool. Never call sift_mark in the same turn as sift_find.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "in_progress", "on_hold", "moved", "cancelled", "done"],
          description: "The new status to set on the task",
        },
        file: {
          type: "string",
          description:
            "File path (relative to vault root) from sift_find output.",
        },
        line: {
          type: "number",
          description:
            "Line number (1-indexed) from sift_find output.",
        },
      },
      required: ["status", "file", "line"],
    },
  },
  {
    name: "sift_review",
    description:
      "Generate a review summary for a time period. Shows tasks completed, tasks created (still open), stale tasks (no dates), project changelog entries, and upcoming tasks. Defaults to since last Friday.",
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
      case "sift_list": {
        const cliArgs = ["list", "--show-file"];
        if (args?.search) cliArgs.push("--search", args.search as string);
        if (args?.priority) cliArgs.push("--priority", args.priority as string);
        if (args?.dueBefore)
          cliArgs.push("--due-before", args.dueBefore as string);
        if (args?.all) cliArgs.push("--all");
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_next": {
        const cliArgs = ["next", "--show-file"];
        if (args?.count) cliArgs.push("-n", String(args.count));
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_summary": {
        const result = runSift(["summary"]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_add": {
        const cliArgs = ["add"];
        if (args?.priority)
          cliArgs.push("--priority", args.priority as string);
        if (args?.due) cliArgs.push("--due", args.due as string);
        if (args?.scheduled)
          cliArgs.push("--scheduled", args.scheduled as string);
        if (args?.start) cliArgs.push("--start", args.start as string);
        if (args?.recurrence)
          cliArgs.push("--recurrence", args.recurrence as string);
        if (args?.project)
          cliArgs.push("--project", args.project as string);
        if (args?.date)
          cliArgs.push("--date", args.date as string);
        cliArgs.push("--", args?.description as string);
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_find": {
        const result = runSift(["find", "--show-file", "--", args?.search as string]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_done": {
        if (!args?.file || !args?.line) {
          return {
            content: [
              {
                type: "text",
                text: "Error: both 'file' and 'line' are required. Use sift_find first to get the file path and line number.",
              },
            ],
            isError: true,
          };
        }
        const result = runSift([
          "done",
          "--file", args.file as string,
          "--line", String(args.line),
        ]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_projects": {
        const cliArgs = ["projects"];
        if (args?.tag) cliArgs.push("--tag", args.tag as string);
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_project_create": {
        const result = runSift(["project", "create", "--", args?.name as string]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_project_path": {
        const result = runSift(["project", "path", "--", args?.name as string]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_note": {
        const cliArgs = ["note"];
        if (args?.project)
          cliArgs.push("--project", args.project as string);
        if (args?.heading)
          cliArgs.push("--heading", args.heading as string);
        if (args?.changelogSummary)
          cliArgs.push("--changelog-summary", args.changelogSummary as string);
        if (args?.date)
          cliArgs.push("--date", args.date as string);
        cliArgs.push("--", args?.content as string);
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_project_set": {
        const cliArgs = ["project", "set"];
        if (args?.status) cliArgs.push("--status", args.status as string);
        if (args?.timeframe) cliArgs.push("--timeframe", args.timeframe as string);
        if (args?.tags && Array.isArray(args.tags) && args.tags.length > 0) {
          cliArgs.push("--tags", ...(args.tags as string[]));
        }
        cliArgs.push("--", args?.name as string);
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_mark": {
        if (!args?.file || !args?.line) {
          return {
            content: [{ type: "text", text: "Error: both 'file' and 'line' are required. Use sift_find first to get the file path and line number." }],
            isError: true,
          };
        }
        const cliArgs = ["mark", "--status", args?.status as string];
        cliArgs.push("--file", args.file as string, "--line", String(args.line));
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_review": {
        const cliArgs = ["review"];
        if (args?.days) cliArgs.push("--days", String(args.days));
        else if (args?.since) cliArgs.push("--since", args.since as string);
        if (args?.until) cliArgs.push("--until", args.until as string);
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
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
