import { tool } from "@opencode-ai/plugin";
import { execFileSync } from "child_process";

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
    const stderr = error.stderr?.toString()?.trim();
    if (stderr) return `Error: ${stderr}`;
    return `Error running obsidian: ${error.message}`;
  }
}

export const search = tool({
  description:
    "Full-text search across the entire Obsidian vault. Returns matching file paths with line numbers and surrounding context. Requires Obsidian to be running.",
  args: {
    query: tool.schema.string().describe("Search query text."),
    path: tool.schema
      .string()
      .optional()
      .describe(
        "Optional folder path to limit search scope (e.g., 'Projects', 'Daily Notes').",
      ),
    limit: tool.schema
      .number()
      .optional()
      .describe("Maximum number of files to return."),
  },
  async execute(args) {
    const cliArgs = ["search:context", `query=${args.query}`, "format=json"];
    if (args.path) cliArgs.push(`path=${args.path}`);
    if (args.limit) cliArgs.push(`limit=${String(args.limit)}`);
    return runObsidian(cliArgs);
  },
});

export const backlinks = tool({
  description:
    "List all files that link to a given file. Useful for finding related daily notes, meetings, and project references. Requires Obsidian to be running.",
  args: {
    file: tool.schema
      .string()
      .describe(
        "File name to find backlinks for. Uses wikilink-style resolution (e.g., 'Sift' finds 'Projects/Sift.md').",
      ),
    counts: tool.schema
      .boolean()
      .optional()
      .describe("Include link counts per file."),
  },
  async execute(args) {
    const cliArgs = ["backlinks", `file=${args.file}`, "format=json"];
    if (args.counts) cliArgs.push("counts");
    return runObsidian(cliArgs);
  },
});

export const read = tool({
  description:
    "Read the contents of a vault file by name (wikilink-style resolution) or exact path. Requires Obsidian to be running.",
  args: {
    file: tool.schema
      .string()
      .describe(
        "File name (wikilink-style resolution, e.g., 'Sift' finds 'Projects/Sift.md') or exact path.",
      ),
  },
  async execute(args) {
    const isPath = args.file.includes("/") || args.file.includes("\\");
    const paramName = isPath ? "path" : "file";
    return runObsidian(["read", `${paramName}=${args.file}`]);
  },
});

export const open = tool({
  description:
    "Open a file in Obsidian. Use this when the user asks to open, view, or navigate to a vault file. Requires Obsidian to be running.",
  args: {
    file: tool.schema
      .string()
      .describe(
        "File name (wikilink-style resolution, e.g., 'Sift' finds 'Projects/Sift.md') or exact path.",
      ),
    newTab: tool.schema
      .boolean()
      .optional()
      .describe("Open in a new tab instead of replacing the current one."),
  },
  async execute(args) {
    const isPath = args.file.includes("/") || args.file.includes("\\");
    const paramName = isPath ? "path" : "file";
    const cliArgs = ["open", `${paramName}=${args.file}`];
    if (args.newTab) cliArgs.push("newtab");
    return runObsidian(cliArgs);
  },
});

export const outline = tool({
  description:
    "Show the heading structure of a vault file. Returns a tree of headings with their levels. Useful for understanding file structure before reading specific sections. Requires Obsidian to be running.",
  args: {
    file: tool.schema
      .string()
      .describe("File name (wikilink-style resolution) or exact path."),
  },
  async execute(args) {
    const isPath = args.file.includes("/") || args.file.includes("\\");
    const paramName = isPath ? "path" : "file";
    return runObsidian(["outline", `${paramName}=${args.file}`, "format=json"]);
  },
});
