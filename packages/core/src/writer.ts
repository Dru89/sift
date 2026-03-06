import * as fs from "node:fs/promises";
import * as path from "node:path";
import { formatTask } from "./parser.js";
import { type Task, type TaskStatus, type Priority, type SiftConfig } from "./types.js";

/**
 * Options for creating a new task.
 */
export interface NewTaskOptions {
  description: string;
  priority?: Priority;
  due?: string;
  scheduled?: string;
  start?: string;
  recurrence?: string;
}

/**
 * Add a new task to today's daily note.
 *
 * The task is appended under the "## Journal" section of today's daily note.
 * If the daily note doesn't exist, it is created from the standard template.
 *
 * @param config - The sift configuration
 * @param options - The task details
 * @returns The formatted task string that was written
 */
export async function addTask(
  config: SiftConfig,
  options: NewTaskOptions,
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const dailyNotePath = getDailyNotePath(config, today);
  const fullPath = path.join(config.vaultPath, dailyNotePath);

  // Ensure the daily notes directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  const taskLine = formatTask({
    description: options.description,
    status: "open",
    priority: options.priority || "none",
    scheduled: options.scheduled || null,
    due: options.due || null,
    start: options.start || null,
    done: null,
    recurrence: options.recurrence || null,
  });

  // Check if the daily note exists
  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch {
    // File doesn't exist, create it with the standard template
    content = createDailyNoteTemplate(today);
  }

  // Insert the task under the "## Journal" section
  const updatedContent = insertTaskUnderJournal(content, taskLine);
  await fs.writeFile(fullPath, updatedContent, "utf-8");

  return taskLine;
}

/**
 * Add a task to a specific file, appending it at the end of the file
 * or under a specified heading.
 */
export async function addTaskToFile(
  config: SiftConfig,
  filePath: string,
  options: NewTaskOptions,
  heading?: string,
): Promise<string> {
  const fullPath = path.join(config.vaultPath, filePath);

  const taskLine = formatTask({
    description: options.description,
    status: "open",
    priority: options.priority || "none",
    scheduled: options.scheduled || null,
    due: options.due || null,
    start: options.start || null,
    done: null,
    recurrence: options.recurrence || null,
  });

  let content = await fs.readFile(fullPath, "utf-8");

  if (heading) {
    content = insertTaskUnderHeading(content, taskLine, heading);
  } else {
    // Append to end
    content = content.trimEnd() + "\n" + taskLine + "\n";
  }

  await fs.writeFile(fullPath, content, "utf-8");
  return taskLine;
}

/**
 * Mark a task as done by updating its status in the file.
 */
export async function completeTask(
  config: SiftConfig,
  task: Task,
): Promise<void> {
  const fullPath = path.join(config.vaultPath, task.filePath);
  const content = await fs.readFile(fullPath, "utf-8");
  const lines = content.split("\n");

  const lineIdx = task.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) {
    throw new Error(`Line ${task.line} out of range in ${task.filePath}`);
  }

  const today = new Date().toISOString().slice(0, 10);

  // Replace the checkbox and add done date
  let updatedLine = lines[lineIdx];
  updatedLine = updatedLine.replace(/- \[[ ]\]/, "- [x]");

  // Add done date if not already present
  if (!updatedLine.includes("✅")) {
    updatedLine = updatedLine.trimEnd() + ` ✅ ${today}`;
  }

  lines[lineIdx] = updatedLine;
  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");
}

/**
 * Get the daily note path for a given date.
 */
function getDailyNotePath(config: SiftConfig, date: string): string {
  // The vault uses YYYY-MM-DD.md format in the daily notes folder
  return path.join(config.dailyNotesPath, `${date}.md`);
}

/**
 * Create a daily note from the standard template observed in the vault.
 */
function createDailyNoteTemplate(date: string): string {
  // Calculate surrounding dates for navigation links
  const d = new Date(date + "T00:00:00");
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  const next = new Date(d);
  next.setDate(next.getDate() + 1);

  const prevStr = prev.toISOString().slice(0, 10);
  const nextStr = next.toISOString().slice(0, 10);

  // Calculate the "before" dates for the tasks query
  const twoDaysLater = new Date(d);
  twoDaysLater.setDate(twoDaysLater.getDate() + 2);
  const dueBefore = twoDaysLater.toISOString().slice(0, 10);

  const oneDayLater = new Date(d);
  oneDayLater.setDate(oneDayLater.getDate() + 1);
  const scheduledBefore = oneDayLater.toISOString().slice(0, 10);

  return `---
type: daily-note
date: ${date}
---
## Tasks
\`\`\`tasks
(due before ${dueBefore}) OR (scheduled before ${scheduledBefore}) OR (priority is highest)
(NOT done) OR (done on ${date}) OR (cancelled on ${date})
filename does not include ${date}
\`\`\`

## Journal


## Notes Created Today
\`\`\`dataview
TABLE type as "Type"
WHERE file.cday = date("${date}")
AND file.name != "${date}"
SORT file.ctime DESC
\`\`\`

---
**Previous:** [[${prevStr}]] | **Next:** [[${nextStr}]]`;
}

/**
 * Insert a task line under the "## Journal" heading.
 * If there are already tasks there, append after the last one.
 * If the section is empty, add the task right after the heading.
 */
function insertTaskUnderJournal(content: string, taskLine: string): string {
  return insertTaskUnderHeading(content, taskLine, "## Journal");
}

/**
 * Insert a task line under a specific heading.
 */
function insertTaskUnderHeading(
  content: string,
  taskLine: string,
  heading: string,
): string {
  const lines = content.split("\n");
  let headingIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx === -1) {
    // Heading not found, append to end
    return content.trimEnd() + "\n\n" + heading + "\n" + taskLine + "\n";
  }

  // Find the last task line (or any content) in this section,
  // before the next heading or end of content
  let insertIdx = headingIdx + 1;
  let lastContentIdx = headingIdx;

  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop at the next heading
    if (line.startsWith("#")) break;

    // Track the last non-empty line in this section
    if (line !== "") {
      lastContentIdx = i;
    }
  }

  // Insert after the last content line in the section
  if (lastContentIdx === headingIdx) {
    // Section was empty, insert right after heading
    lines.splice(headingIdx + 1, 0, taskLine);
  } else {
    // Insert after the last task/content line
    lines.splice(lastContentIdx + 1, 0, taskLine);
  }

  return lines.join("\n");
}
