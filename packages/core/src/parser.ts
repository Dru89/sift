import { type Task, type TaskStatus, type Priority } from "./types.js";

/**
 * Emoji markers used by Obsidian Tasks plugin.
 * Reference: https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format
 */
const EMOJI = {
  scheduled: "⏳",
  due: "📅",
  start: "🛫",
  done: "✅",
  created: "➕",
  cancelled: "❌",
  recurrence: "🔁",
  highest: "⏫",
  high: "🔼",
  medium: "🔽", // Obsidian Tasks uses 🔽 for medium in some configs
  low: "🔽",
  lowest: "⏬",
} as const;

/**
 * Priority emoji to Priority level mapping.
 * Order matters: we check these in sequence.
 */
const PRIORITY_MAP: Array<[string, Priority]> = [
  ["⏫", "highest"],
  ["🔼", "high"],
  ["🔽", "low"],
  ["⏬", "lowest"],
];

/**
 * Date field emoji to field name mapping.
 */
const DATE_FIELDS: Array<[string, keyof Pick<Task, "scheduled" | "due" | "start" | "done" | "created">]> = [
  ["⏳", "scheduled"],
  ["📅", "due"],
  ["🛫", "start"],
  ["✅", "done"],
  ["➕", "created"],
];

/** Regex to match a date in YYYY-MM-DD format */
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;

/**
 * Matches an Obsidian task checkbox line.
 * Captures: [1] = status char (space, x, X, -)
 *           [2] = rest of the line
 */
const TASK_LINE_REGEX = /^(\s*)- \[([ xX-])\]\s+(.*)/;

/**
 * Parse a single line of text into a Task, if it matches the task format.
 * Returns null if the line is not a valid task.
 *
 * @param line - The raw line of text
 * @param filePath - The file this line comes from (relative to vault root)
 * @param lineNumber - The 1-indexed line number
 */
export function parseLine(
  line: string,
  filePath: string,
  lineNumber: number,
): Task | null {
  const match = line.match(TASK_LINE_REGEX);
  if (!match) return null;

  const [, , statusChar, content] = match;
  const raw = content.trim();

  // Don't count empty checkboxes as tasks (template placeholders)
  if (raw === "") return null;

  const status = parseStatus(statusChar);
  const priority = parsePriority(raw);
  const dates = parseDates(raw);
  const recurrence = parseRecurrence(raw);
  const description = stripMetadata(raw);

  return {
    raw,
    description,
    status,
    priority,
    scheduled: dates.scheduled,
    due: dates.due,
    start: dates.start,
    done: dates.done,
    created: dates.created,
    recurrence,
    filePath,
    line: lineNumber,
  };
}

/**
 * Parse multiple lines of text and extract all tasks.
 *
 * @param content - The full text content of a file
 * @param filePath - The file path (relative to vault root)
 */
export function parseContent(content: string, filePath: string): Task[] {
  const lines = content.split("\n");
  const tasks: Task[] = [];

  for (let i = 0; i < lines.length; i++) {
    const task = parseLine(lines[i], filePath, i + 1);
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

function parseStatus(char: string): TaskStatus {
  switch (char) {
    case "x":
    case "X":
      return "done";
    case "-":
      return "cancelled";
    default:
      return "open";
  }
}

function parsePriority(text: string): Priority {
  for (const [emoji, priority] of PRIORITY_MAP) {
    if (text.includes(emoji)) return priority;
  }
  return "none";
}

function parseDates(text: string): {
  scheduled: string | null;
  due: string | null;
  start: string | null;
  done: string | null;
  created: string | null;
} {
  const result: {
    scheduled: string | null;
    due: string | null;
    start: string | null;
    done: string | null;
    created: string | null;
  } = {
    scheduled: null,
    due: null,
    start: null,
    done: null,
    created: null,
  };

  for (const [emoji, field] of DATE_FIELDS) {
    const idx = text.indexOf(emoji);
    if (idx === -1) continue;
    const after = text.slice(idx + emoji.length).trim();
    const dateMatch = after.match(DATE_PATTERN);
    if (dateMatch) {
      result[field] = dateMatch[0];
    }
  }

  return result;
}

function parseRecurrence(text: string): string | null {
  const idx = text.indexOf(EMOJI.recurrence);
  if (idx === -1) return null;
  // Recurrence text runs until the next emoji or end of line
  const after = text.slice(idx + EMOJI.recurrence.length).trim();
  // Stop at the next emoji marker
  const emojiPattern = /[⏫🔼🔽⏬⏳📅🛫✅➕❌🔁]/;
  const endMatch = after.search(emojiPattern);
  return endMatch === -1 ? after.trim() : after.slice(0, endMatch).trim();
}

/**
 * Strip all Obsidian Tasks emoji metadata from a task line,
 * leaving just the human-readable description.
 */
function stripMetadata(text: string): string {
  let result = text;

  // Remove priority emojis
  for (const [emoji] of PRIORITY_MAP) {
    result = result.replace(emoji, "");
  }

  // Remove date fields (emoji + date)
  for (const [emoji] of DATE_FIELDS) {
    const regex = new RegExp(
      emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\d{4}-\\d{2}-\\d{2}",
      "g",
    );
    result = result.replace(regex, "");
  }

  // Remove recurrence
  const recIdx = result.indexOf(EMOJI.recurrence);
  if (recIdx !== -1) {
    // Find the next emoji or end of string
    const after = result.slice(recIdx + EMOJI.recurrence.length);
    const emojiPattern = /[⏫🔼🔽⏬⏳📅🛫✅➕❌]/;
    const endMatch = after.search(emojiPattern);
    if (endMatch === -1) {
      result = result.slice(0, recIdx);
    } else {
      result = result.slice(0, recIdx) + after.slice(endMatch);
    }
  }

  return result.replace(/\s+/g, " ").trim();
}

/**
 * Format a Task back into the Obsidian Tasks emoji format.
 * Useful for writing tasks to files.
 */
export function formatTask(task: Omit<Task, "raw" | "filePath" | "line">): string {
  const parts: string[] = [`- [${statusToChar(task.status)}] ${task.description}`];

  if (task.priority !== "none") {
    parts.push(priorityToEmoji(task.priority));
  }

  if (task.recurrence) {
    parts.push(`${EMOJI.recurrence} ${task.recurrence}`);
  }

  if (task.start) {
    parts.push(`${EMOJI.start} ${task.start}`);
  }

  if (task.scheduled) {
    parts.push(`${EMOJI.scheduled} ${task.scheduled}`);
  }

  if (task.due) {
    parts.push(`${EMOJI.due} ${task.due}`);
  }

  if (task.done) {
    parts.push(`${EMOJI.done} ${task.done}`);
  }

  if (task.created) {
    parts.push(`${EMOJI.created} ${task.created}`);
  }

  return parts.join(" ");
}

function statusToChar(status: TaskStatus): string {
  switch (status) {
    case "done":
      return "x";
    case "cancelled":
      return "-";
    default:
      return " ";
  }
}

function priorityToEmoji(priority: Priority): string {
  for (const [emoji, p] of PRIORITY_MAP) {
    if (p === priority) return emoji;
  }
  return "";
}
