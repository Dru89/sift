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
      "Mark a task as complete. Supports two modes: (1) search mode — pass 'search' to find and complete by description substring, or (2) precise mode — pass 'file' and 'line' to complete an exact task. Prefer precise mode after using sift_find to identify the task.",
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
            "File path (relative to vault root) for precise completion. Must be used with 'line'.",
        },
        line: {
          type: "number",
          description:
            "Line number (1-indexed) for precise completion. Must be used with 'file'.",
        },
      },
    },
  },
  {
    name: "sift_projects",
    description:
      "List all projects in the vault. Returns project names, statuses, and tags.",
    inputSchema: {
      type: "object",
      properties: {},
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
            "The heading to insert the note under. Defaults to '## Notes' for projects, '## Journal' for daily notes.",
        },
      },
      required: ["content"],
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
        const cliArgs = ["add", args?.description as string];
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
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_find": {
        const result = runSift(["find", args?.search as string, "--show-file"]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_done": {
        // Precise mode: file + line
        if (args?.file && args?.line) {
          const result = runSift([
            "done",
            "--file", args.file as string,
            "--line", String(args.line),
          ]);
          return {
            content: [{ type: "text", text: result }],
          };
        }

        // Search mode
        if (args?.search) {
          const result = runSift(["done", args.search as string]);
          return {
            content: [{ type: "text", text: result }],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: "Error: provide either 'search' or both 'file' and 'line'",
            },
          ],
          isError: true,
        };
      }

      case "sift_projects": {
        const result = runSift(["projects"]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_project_create": {
        const result = runSift(["project", "create", args?.name as string]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_project_path": {
        const result = runSift(["project", "path", args?.name as string]);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_note": {
        const cliArgs = ["note", args?.content as string];
        if (args?.project)
          cliArgs.push("--project", args.project as string);
        if (args?.heading)
          cliArgs.push("--heading", args.heading as string);
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
