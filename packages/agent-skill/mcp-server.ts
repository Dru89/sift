#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "child_process";

/**
 * Resolve the sift CLI command. Checks in order:
 * 1. SIFT_CLI_PATH env var (absolute path to the built CLI entry point)
 * 2. "sift" on PATH (if globally linked via `npm link`)
 *
 * The install script sets SIFT_CLI_PATH, but if sift is on your PATH
 * it will just work without any env var.
 */
function getSiftCommand(): string {
  if (process.env.SIFT_CLI_PATH) {
    return `node "${process.env.SIFT_CLI_PATH}"`;
  }
  return "sift";
}

function runSift(args: string[]): string {
  try {
    const result = execSync(`${getSiftCommand()} ${args.join(" ")}`, {
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
    description: "Add a new task to today's daily note in Obsidian.",
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
      },
      required: ["description"],
    },
  },
  {
    name: "sift_done",
    description:
      "Mark a task as complete by searching for it. If multiple tasks match, returns the list so you can be more specific.",
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
        if (args?.search) cliArgs.push("--search", `"${args.search}"`);
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
        const cliArgs = ["add", `"${args?.description}"`];
        if (args?.priority)
          cliArgs.push("--priority", args.priority as string);
        if (args?.due) cliArgs.push("--due", args.due as string);
        if (args?.scheduled)
          cliArgs.push("--scheduled", args.scheduled as string);
        if (args?.start) cliArgs.push("--start", args.start as string);
        if (args?.recurrence)
          cliArgs.push("--recurrence", args.recurrence as string);
        const result = runSift(cliArgs);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "sift_done": {
        const result = runSift(["done", `"${args?.search}"`]);
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
