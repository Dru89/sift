import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseLine } from "./parser.js";
import { parseThread } from "./thread-parser.js";
import { localToday } from "./dates.js";
import { type Thread, type ThreadState, type ThreadEntry, type SiftConfig } from "./types.js";

// ─── Types ───────────────────────────────────────────────────

/**
 * Options for creating a new thread on a task.
 */
export interface CreateThreadOptions {
  /** File path (relative to vault root, or absolute) */
  file: string;
  /** 1-indexed line number of the task */
  line: number;
  /** People or teams involved */
  counterparts: string[];
  /** Initial state. Default: "active" */
  state?: ThreadState;
  /** Follow-up date (YYYY-MM-DD) */
  followUp?: string;
  /** URL or markdown link to where the conversation lives */
  source?: string;
  /** First entry content (if provided, creates an initial entry) */
  content?: string;
  /** Date for first entry (YYYY-MM-DD). Default: today. Ignored if content not provided. */
  date?: string;
  /** Partial task text for safety verification */
  description?: string;
}

/**
 * Options for adding an entry to an existing thread.
 */
export interface AddThreadEntryOptions {
  /** File path (relative to vault root, or absolute) */
  file: string;
  /** 1-indexed line number of the task */
  line: number;
  /** What happened (one line) */
  content: string;
  /** Change thread state simultaneously */
  state?: ThreadState;
  /** Set/update follow-up date. Pass "none" to clear. */
  followUp?: string;
  /** Entry date (YYYY-MM-DD). Default: today. */
  date?: string;
  /** Partial task text for safety verification */
  description?: string;
}

/**
 * Options for updating thread metadata without adding an entry.
 */
export interface UpdateThreadStateOptions {
  /** File path (relative to vault root, or absolute) */
  file: string;
  /** 1-indexed line number of the task */
  line: number;
  /** New state */
  state?: ThreadState;
  /** Set/update/clear follow-up date. "none" to clear. */
  followUp?: string;
  /** Replace counterpart list */
  counterparts?: string[];
  /** Update source link. "none" to clear. */
  source?: string;
  /** Partial task text for safety verification */
  description?: string;
}

/**
 * Result of a thread mutation operation.
 */
export interface ThreadResult {
  /** Task description */
  task: string;
  /** File path */
  file: string;
  /** Task line number */
  line: number;
  /** Current thread state after the operation */
  counterparts: string[];
  state: ThreadState;
  followUp: string | null;
  source: string | null;
  lastEntry: ThreadEntry | null;
}

// ─── Formatting ──────────────────────────────────────────────

/**
 * The canonical separator used when writing thread headers.
 */
const SEPARATOR = " · ";

/**
 * Format a thread into markdown blockquote lines.
 * Returns an array of lines (each prefixed with `> `) ready to be inserted into a file.
 *
 * @param thread - The thread data to format
 * @param indent - Indentation prefix (e.g., "  " for two-space indent). Default: "  "
 */
export function formatThread(
  thread: { counterparts: string[]; state: ThreadState; followUp?: string | null; source?: string | null; entries?: ThreadEntry[] },
  indent: string = "  ",
): string[] {
  const lines: string[] = [];

  // Header line
  const counterpartStr = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
  let header = `${indent}> 🧵 with ${counterpartStr}`;

  // Always write state (even if active, for clarity)
  header += `${SEPARATOR}${thread.state}`;

  if (thread.followUp) {
    header += `${SEPARATOR}follow-up: ${thread.followUp}`;
  }

  lines.push(header);

  // Source line (optional)
  if (thread.source) {
    lines.push(`${indent}> Source: ${thread.source}`);
  }

  // Entries
  if (thread.entries) {
    for (const entry of thread.entries) {
      if (entry.date) {
        lines.push(`${indent}> - ${entry.date}: ${entry.description}`);
      } else {
        lines.push(`${indent}> - ${entry.description}`);
      }
    }
  }

  return lines;
}

/**
 * Format just the header line of a thread (for in-place replacement).
 */
function formatHeaderLine(
  counterparts: string[],
  state: ThreadState,
  followUp: string | null,
  indent: string,
): string {
  const counterpartStr = counterparts.map((c) => `[[${c}]]`).join(", ");
  let header = `${indent}> 🧵 with ${counterpartStr}${SEPARATOR}${state}`;
  if (followUp) {
    header += `${SEPARATOR}follow-up: ${followUp}`;
  }
  return header;
}

// ─── File Operations ─────────────────────────────────────────

/**
 * Create a new thread on a task.
 *
 * Inserts a blockquote thread block immediately below the task line.
 * Fails if the task already has a thread or the target line is not a task.
 */
export async function createThread(
  config: SiftConfig,
  options: CreateThreadOptions,
): Promise<ThreadResult> {
  const filePath = normalizeFilePath(config, options.file);
  const fullPath = path.join(config.vaultPath, filePath);
  const fileContent = await fs.readFile(fullPath, "utf-8");
  const lines = fileContent.split("\n");

  const lineIdx = options.line - 1;
  validateTaskLine(lines, lineIdx, options.line, filePath, options.description);

  // Check if task already has a thread
  const remainingLines = lines.slice(lineIdx + 1);
  const existingThread = parseThread(remainingLines, options.line);
  if (existingThread) {
    throw new Error(
      `Task at line ${options.line} in ${filePath} already has a thread`,
    );
  }

  // Build the thread
  const state = options.state || "active";
  const followUp = options.followUp || null;
  const entries: ThreadEntry[] = [];

  if (options.content) {
    entries.push({
      date: options.date || localToday(),
      description: options.content,
    });
  }

  // Detect indentation from the task line
  const indent = detectIndent(lines[lineIdx]);

  const threadLines = formatThread(
    {
      counterparts: options.counterparts,
      state,
      followUp,
      source: options.source || null,
      entries,
    },
    indent,
  );

  // Find the insertion point: after all body content (indented lines below the task)
  const taskIndent = (lines[lineIdx].match(/^(\s*)/) ?? ["", ""])[1].length;
  let insertIdx = lineIdx + 1;
  for (let i = lineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Stop at next top-level task or non-subordinate content
    if (line.trim() === "") {
      // Blank line — check if more subordinate content follows
      let hasMore = false;
      for (let k = i + 1; k < lines.length; k++) {
        if (lines[k].trim() === "") continue;
        const nextIndent = (lines[k].match(/^(\s*)/) ?? ["", ""])[1].length;
        if (nextIndent > taskIndent) {
          hasMore = true;
        }
        break;
      }
      if (hasMore) {
        insertIdx = i + 1;
        continue;
      }
      break;
    }
    // Stop if not indented deeper than the task
    const lineIndent = (line.match(/^(\s*)/) ?? ["", ""])[1].length;
    if (lineIndent <= taskIndent && !/^\s*>/.test(line)) break;
    insertIdx = i + 1;
  }

  // Insert thread lines after body content
  lines.splice(insertIdx, 0, ...threadLines);

  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");

  // Extract task description for result
  const taskDescription = extractTaskDescription(lines[lineIdx]);

  return {
    task: taskDescription,
    file: filePath,
    line: options.line,
    counterparts: options.counterparts,
    state,
    followUp,
    source: options.source || null,
    lastEntry: entries.length > 0 ? entries[entries.length - 1] : null,
  };
}

/**
 * Add a timestamped entry to an existing thread.
 * Optionally updates state and/or follow-up simultaneously.
 */
export async function addThreadEntry(
  config: SiftConfig,
  options: AddThreadEntryOptions,
): Promise<ThreadResult> {
  const filePath = normalizeFilePath(config, options.file);
  const fullPath = path.join(config.vaultPath, filePath);
  const fileContent = await fs.readFile(fullPath, "utf-8");
  const lines = fileContent.split("\n");

  const lineIdx = options.line - 1;
  validateTaskLine(lines, lineIdx, options.line, filePath, options.description);

  // Find the existing thread
  const remainingLines = lines.slice(lineIdx + 1);
  const thread = parseThread(remainingLines, options.line);
  if (!thread) {
    throw new Error(
      `Task at line ${options.line} in ${filePath} has no thread. Use createThread first.`,
    );
  }

  if (thread.state === "resolved") {
    throw new Error(
      `Thread on task at line ${options.line} in ${filePath} is resolved. Change state before adding entries.`,
    );
  }

  // Determine new state and follow-up
  const newState = options.state || thread.state;
  const newFollowUp = options.followUp === "none" ? null : (options.followUp || thread.followUp);

  // If state or follow-up changed, rewrite the header line
  if (newState !== thread.state || newFollowUp !== thread.followUp) {
    const headerLineIdx = thread.startLine - 1; // convert to 0-indexed
    const indent = detectIndent(lines[lineIdx]);
    lines[headerLineIdx] = formatHeaderLine(thread.counterparts, newState, newFollowUp, indent);
  }

  // Add the new entry at the end of the thread block
  const entryDate = options.date || localToday();
  const indent = detectIndent(lines[lineIdx]);
  const entryLine = `${indent}> - ${entryDate}: ${options.content}`;

  // Insert after the last line of the thread block
  const insertIdx = thread.endLine; // endLine is 1-indexed, so this is the 0-indexed position after it
  lines.splice(insertIdx, 0, entryLine);

  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");

  const newEntry: ThreadEntry = { date: entryDate, description: options.content };
  const taskDescription = extractTaskDescription(lines[lineIdx]);

  return {
    task: taskDescription,
    file: filePath,
    line: options.line,
    counterparts: thread.counterparts,
    state: newState,
    followUp: newFollowUp,
    source: thread.source,
    lastEntry: newEntry,
  };
}

/**
 * Update thread metadata without adding an entry.
 * Changes state, follow-up, counterparts, or source.
 */
export async function updateThreadState(
  config: SiftConfig,
  options: UpdateThreadStateOptions,
): Promise<ThreadResult> {
  const filePath = normalizeFilePath(config, options.file);
  const fullPath = path.join(config.vaultPath, filePath);
  const fileContent = await fs.readFile(fullPath, "utf-8");
  const lines = fileContent.split("\n");

  const lineIdx = options.line - 1;
  validateTaskLine(lines, lineIdx, options.line, filePath, options.description);

  // Find the existing thread
  const remainingLines = lines.slice(lineIdx + 1);
  const thread = parseThread(remainingLines, options.line);
  if (!thread) {
    throw new Error(
      `Task at line ${options.line} in ${filePath} has no thread.`,
    );
  }

  // Must have at least one change
  if (!options.state && !options.followUp && !options.counterparts && !options.source) {
    throw new Error("At least one of state, followUp, counterparts, or source must be provided.");
  }

  // Compute new values
  const newState = options.state || thread.state;
  const newFollowUp = options.followUp === "none" ? null : (options.followUp || thread.followUp);
  const newCounterparts = options.counterparts || thread.counterparts;
  const newSource = options.source === "none" ? null : (options.source || thread.source);

  // Rewrite the header line
  const headerLineIdx = thread.startLine - 1;
  const indent = detectIndent(lines[lineIdx]);
  lines[headerLineIdx] = formatHeaderLine(newCounterparts, newState, newFollowUp, indent);

  // Handle source line changes
  if (options.source !== undefined) {
    // Find existing source line (if any) — it's between header and first entry
    let sourceLineIdx = -1;
    for (let i = headerLineIdx + 1; i <= thread.endLine - 1; i++) {
      const lineContent = lines[i].match(/^\s*>\s?(.*)/);
      if (lineContent && lineContent[1].trim().startsWith("Source:")) {
        sourceLineIdx = i;
        break;
      }
      // Stop looking once we hit an entry
      if (lineContent && lineContent[1].trim().startsWith("- ")) break;
    }

    if (newSource === null && sourceLineIdx !== -1) {
      // Remove existing source line
      lines.splice(sourceLineIdx, 1);
    } else if (newSource !== null && sourceLineIdx !== -1) {
      // Update existing source line
      lines[sourceLineIdx] = `${indent}> Source: ${newSource}`;
    } else if (newSource !== null && sourceLineIdx === -1) {
      // Insert new source line after header
      lines.splice(headerLineIdx + 1, 0, `${indent}> Source: ${newSource}`);
    }
  }

  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");

  const taskDescription = extractTaskDescription(lines[lineIdx]);
  const lastEntry = thread.entries.length > 0 ? thread.entries[thread.entries.length - 1] : null;

  return {
    task: taskDescription,
    file: filePath,
    line: options.line,
    counterparts: newCounterparts,
    state: newState,
    followUp: newFollowUp,
    source: newSource,
    lastEntry,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Normalize file path — convert absolute to vault-relative if needed.
 */
function normalizeFilePath(config: SiftConfig, filePath: string): string {
  if (path.isAbsolute(filePath) && filePath.startsWith(config.vaultPath)) {
    return path.relative(config.vaultPath, filePath);
  }
  return filePath;
}

/**
 * Validate that the given line is a task.
 */
function validateTaskLine(
  lines: string[],
  lineIdx: number,
  lineNum: number,
  filePath: string,
  expectedDescription?: string,
): void {
  if (lineIdx < 0 || lineIdx >= lines.length) {
    throw new Error(`Line ${lineNum} out of range in ${filePath}`);
  }

  const targetLine = lines[lineIdx];
  if (!targetLine.match(/- \[.\]/)) {
    throw new Error(
      `Line ${lineNum} in ${filePath} is not a task: "${targetLine.trim()}"`,
    );
  }

  if (expectedDescription) {
    const task = parseLine(targetLine, filePath, lineNum);
    if (task && !task.description.toLowerCase().includes(expectedDescription.toLowerCase())) {
      throw new Error(
        `Task at line ${lineNum} in ${filePath} does not match expected description "${expectedDescription}". Found: "${task.description}"`,
      );
    }
  }
}

/**
 * Detect indentation of a task line and return the continuation indent.
 * For a task at "  - [ ] ...", the continuation indent is "    " (task indent + 2 more).
 * For a task at "- [ ] ...", the continuation indent is "  ".
 */
function detectIndent(taskLine: string): string {
  const match = taskLine.match(/^(\s*)/);
  const taskIndent = match ? match[1] : "";
  return taskIndent + "  ";
}

/**
 * Extract the task description from a raw line.
 */
function extractTaskDescription(line: string): string {
  const match = line.match(/- \[.\]\s+(.*)/);
  if (!match) return line.trim();
  // Strip emoji metadata for a clean description — reuse parseLine logic
  const task = parseLine(line, "", 1);
  return task ? task.description : match[1].trim();
}
