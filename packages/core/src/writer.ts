import * as fs from "node:fs/promises";
import * as path from "node:path";
import { formatTask } from "./parser.js";
import { localToday, addDays } from "./dates.js";
import { scanTasks } from "./scanner.js";
import { findProject } from "./projects.js";
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
  /**
   * Name of the project to add this task to. If provided, the task is added
   * under the "## Tasks" heading in the project file instead of the daily note.
   * The project must exist in the vault.
   */
  project?: string;
}

/**
 * Add a new task to today's daily note, or to a project file if specified.
 *
 * When `options.project` is provided, the task is added under the "## Tasks"
 * heading in the matching project file. Otherwise it goes under "## Journal"
 * in today's daily note.
 *
 * @param config - The sift configuration
 * @param options - The task details
 * @returns The formatted task string that was written
 */
export async function addTask(
  config: SiftConfig,
  options: NewTaskOptions,
): Promise<string> {
  // For project files, include created date since it's not implicit from the filename.
  // For daily notes, creation date is implicit from the note's date.
  const created = options.project ? localToday() : null;

  const taskLine = formatTask({
    description: options.description,
    status: "open",
    priority: options.priority || "none",
    scheduled: options.scheduled || null,
    due: options.due || null,
    start: options.start || null,
    done: null,
    created,
    recurrence: options.recurrence || null,
  });

  if (options.project) {
    return addTaskToProject(config, options.project, taskLine);
  }

  return addTaskToDailyNote(config, taskLine);
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
    created: localToday(),
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
 * Search for open tasks matching a query string.
 * Returns matching tasks with full context (file path, line number, description)
 * without modifying anything. Use this to preview before completing.
 *
 * @param config - The sift configuration
 * @param search - Text to search for in task descriptions (case-insensitive substring match)
 * @returns Array of matching open tasks
 */
export async function findTasks(
  config: SiftConfig,
  search: string,
): Promise<Task[]> {
  const tasks = await scanTasks(config, { status: "open" });
  const searchLower = search.toLowerCase();
  return tasks.filter((t) =>
    t.description.toLowerCase().includes(searchLower),
  );
}

/**
 * Mark a task as done by updating its status in the file.
 *
 * Accepts either a full Task object (identified by filePath + line) or
 * explicit file/line parameters for precise targeting.
 *
 * @param config - The sift configuration
 * @param taskOrFile - A Task object, or a file path (relative to vault root)
 * @param line - The 1-indexed line number (required when taskOrFile is a string)
 * @returns The description of the completed task
 */
export async function completeTask(
  config: SiftConfig,
  taskOrFile: Task | string,
  line?: number,
): Promise<string> {
  let filePath: string;
  let lineNum: number;

  if (typeof taskOrFile === "string") {
    if (line === undefined) {
      throw new Error("Line number is required when passing a file path");
    }
    filePath = taskOrFile;
    lineNum = line;
  } else {
    filePath = taskOrFile.filePath;
    lineNum = taskOrFile.line;
  }

  const fullPath = path.join(config.vaultPath, filePath);
  const content = await fs.readFile(fullPath, "utf-8");
  const lines = content.split("\n");

  const lineIdx = lineNum - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) {
    throw new Error(`Line ${lineNum} out of range in ${filePath}`);
  }

  // Verify the line is actually an open task
  const targetLine = lines[lineIdx];
  if (!targetLine.match(/- \[[ ]\]/)) {
    throw new Error(
      `Line ${lineNum} in ${filePath} is not an open task: "${targetLine.trim()}"`,
    );
  }

  const today = localToday();

  // Replace the checkbox and add done date
  let updatedLine = targetLine;
  updatedLine = updatedLine.replace(/- \[[ ]\]/, "- [x]");

  // Add done date if not already present
  if (!updatedLine.includes("✅")) {
    updatedLine = updatedLine.trimEnd() + ` ✅ ${today}`;
  }

  lines[lineIdx] = updatedLine;
  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");

  // Extract a description for confirmation
  const descMatch = targetLine.match(/- \[[ ]\]\s+(.*)/);
  return descMatch ? descMatch[1].trim() : targetLine.trim();
}

// ─── Internal helpers ────────────────────────────────────────

/**
 * Add a formatted task line to today's daily note under "## Journal".
 */
async function addTaskToDailyNote(
  config: SiftConfig,
  taskLine: string,
): Promise<string> {
  const today = localToday();
  const dailyNotePath = getDailyNotePath(config, today);
  const fullPath = path.join(config.vaultPath, dailyNotePath);

  // Ensure the daily notes directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

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
 * Add a formatted task line to a project file under "## Tasks".
 * Falls back to appending at end if no "## Tasks" heading exists.
 */
async function addTaskToProject(
  config: SiftConfig,
  projectName: string,
  taskLine: string,
): Promise<string> {
  const project = await findProject(config, projectName);
  if (!project) {
    throw new Error(
      `Project "${projectName}" not found. Use "sift projects" to see available projects.`,
    );
  }

  const fullPath = path.join(config.vaultPath, project.filePath);
  let content = await fs.readFile(fullPath, "utf-8");

  // Try to insert under ## Tasks, fall back to appending
  content = insertTaskUnderHeading(content, taskLine, "## Tasks");
  await fs.writeFile(fullPath, content, "utf-8");

  return taskLine;
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
  const prevStr = addDays(date, -1);
  const nextStr = addDays(date, 1);

  // Calculate the "before" dates for the tasks query
  const dueBefore = addDays(date, 2);
  const scheduledBefore = addDays(date, 1);

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
