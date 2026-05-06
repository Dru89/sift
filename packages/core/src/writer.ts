import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseLine, formatTask, statusToChar } from "./parser.js";
import { localToday, addDays } from "./dates.js";
import { scanTasks, matchesSearch } from "./scanner.js";
import { findProject } from "./projects.js";
import { type Task, type TaskStatus, type Priority, type SiftConfig, ACTIONABLE_STATUSES } from "./types.js";

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
  /**
   * Target date for the daily note (YYYY-MM-DD). Defaults to today.
   * Ignored when `project` is set.
   */
  date?: string;
}

/**
 * Options for adding a note.
 */
export interface AddNoteOptions {
  /** The note content (can be multi-line) */
  content: string;

  /**
   * Name of the project to add this note to. If provided, the note is added
   * to the project file. If omitted, the note goes to today's daily note.
   */
  project?: string;

  /**
   * The heading to insert the note under.
   * Defaults to "## Notes" for projects, "## Journal" for daily notes.
   */
  heading?: string;

  /**
   * Target date for the daily note (YYYY-MM-DD). Defaults to today.
   * Ignored when `project` is set.
   */
  date?: string;
}

/**
 * Options for creating a subnote linked to a project.
 */
export interface CreateSubnoteOptions {
  /** The project to link this subnote to (required) */
  project: string;

  /** Title of the subnote (used in filename and heading) */
  title: string;

  /** Content of the subnote (can be multi-line markdown) */
  content?: string;

  /**
   * The folder to place the subnote in, relative to vault root.
   * Defaults to "Notes".
   */
  folder?: string;

  /**
   * The frontmatter `type` field for the subnote.
   * Defaults to "note".
   */
  type?: string;

  /**
   * Tags to add to the subnote frontmatter.
   */
  tags?: string[];

  /**
   * The heading in the project file to insert the backlink under.
   * Defaults to "## Notes".
   */
  heading?: string;
}

/**
 * Result of creating a subnote.
 */
export interface SubnoteResult {
  /** Path to the created subnote, relative to vault root */
  filePath: string;
  /** The project the subnote is linked to */
  project: string;
  /** The title of the subnote */
  title: string;
  /** The wiki link name (filename without extension), for use in task descriptions */
  linkName: string;
}

/**
 * Result of adding a task.
 */
export interface AddTaskResult {
  /** The formatted task line that was written */
  taskLine: string;
  /** Whether the target project was reopened (was "done", now "active") */
  reopened: boolean;
}

/**
 * Add a new task to today's daily note, or to a project file if specified.
 *
 * When `options.project` is provided, the task is added under the "## Tasks"
 * heading in the matching project file. Otherwise it goes under "## Journal"
 * in today's daily note.
 *
 * If the target project has `status: done`, it is automatically reopened
 * (set to "active") before adding the task.
 *
 * @param config - The sift configuration
 * @param options - The task details
 * @returns The formatted task string that was written, plus a `reopened` flag
 */
export async function addTask(
  config: SiftConfig,
  options: NewTaskOptions,
): Promise<AddTaskResult> {
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

  const written = await addTaskToDailyNote(config, taskLine, options.date);
  return { taskLine: written, reopened: false };
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
  const normalizedPath = normalizeFilePath(config, filePath);
  const fullPath = path.join(config.vaultPath, normalizedPath);

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
    content = insertContentUnderHeading(content, taskLine, heading);
  } else {
    // Append to end
    content = content.trimEnd() + "\n" + taskLine + "\n";
  }

  await fs.writeFile(fullPath, content, "utf-8");
  return taskLine;
}

/**
 * Add a freeform note to today's daily note or to a project file.
 *
 * When `options.project` is provided, the note is inserted under
 * `options.heading` (default "## Notes") in the matching project file.
 * Otherwise it goes under `options.heading` (default "## Journal")
 * in today's daily note.
 *
 * @param config - The sift configuration
 * @param options - The note options
 * @returns The content that was written
 */
export async function addNote(
  config: SiftConfig,
  options: AddNoteOptions,
): Promise<string> {
  if (options.project) {
    return addNoteToProject(config, options);
  }
  return addNoteToDailyNote(config, options);
}

/**
 * Create a new subnote file linked to a project.
 *
 * Creates a markdown file in the specified folder (default "Notes") with
 * frontmatter linking it back to the project, then inserts a wiki link
 * to the new note in the project file under the specified heading.
 *
 * Filename format: `YYYY-MM-DD - <title>.md`
 *
 * @param config - The sift configuration
 * @param options - The subnote options
 * @returns Info about the created subnote
 */
export async function createSubnote(
  config: SiftConfig,
  options: CreateSubnoteOptions,
): Promise<SubnoteResult> {
  const project = await findProject(config, options.project);
  if (!project) {
    throw new Error(
      `Project "${options.project}" not found. Use "sift projects" to see available projects.`,
    );
  }

  const today = localToday();
  const folder = options.folder || "Notes";
  const noteType = options.type || "note";
  const fileName = `${today} - ${options.title}.md`;
  const filePath = path.join(folder, fileName);
  const fullPath = path.join(config.vaultPath, filePath);

  // Check for name collision
  try {
    await fs.access(fullPath);
    throw new Error(
      `File already exists: ${filePath}. Choose a different title.`,
    );
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
    // File doesn't exist — good, we can create it
  }

  // Build frontmatter
  const frontmatterLines = [
    "---",
    `type: ${noteType}`,
    `date: ${today}`,
    `project: "[[${project.name}]]"`,
  ];
  if (options.tags && options.tags.length > 0) {
    frontmatterLines.push(`tags: [${options.tags.join(", ")}]`);
  }
  frontmatterLines.push("---");

  // Build file content
  const parts = [frontmatterLines.join("\n")];
  if (options.content) {
    parts.push(options.content);
  }
  const fileContent = parts.join("\n") + "\n";

  // Ensure the folder exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Write the subnote file
  await fs.writeFile(fullPath, fileContent, "utf-8");

  // Insert a link in the project file
  const noteName = path.basename(fileName, ".md");
  const linkLine = `- [[${noteName}]]`;
  const heading = options.heading || "## Notes";

  const projectFullPath = path.join(config.vaultPath, project.filePath);
  let projectContent = await fs.readFile(projectFullPath, "utf-8");
  projectContent = insertContentUnderHeading(projectContent, linkLine, heading, "## Changelog");
  await fs.writeFile(projectFullPath, projectContent, "utf-8");

  return {
    filePath,
    project: project.name,
    title: options.title,
    linkName: noteName,
  };
}

/**
 * Search for open tasks matching a query string.
 * Returns matching tasks with full context (file path, line number, description)
 * without modifying anything. Use this to preview before completing.
 *
 * Uses tokenized search: strips markdown syntax (wiki links, bold, etc.) and
 * matches all whitespace-separated keywords independently (case-insensitive).
 *
 * @param config - The sift configuration
 * @param search - Text to search for in task descriptions
 * @param options - Optional settings: `all` includes all statuses, `status` filters to specific statuses
 * @returns Array of matching tasks
 */
export async function findTasks(
  config: SiftConfig,
  search: string,
  options?: { all?: boolean; status?: TaskStatus | TaskStatus[] },
): Promise<Task[]> {
  let statusFilter: TaskStatus | TaskStatus[] | undefined;
  if (options?.status) {
    statusFilter = options.status;
  } else if (options?.all) {
    statusFilter = undefined;
  } else {
    statusFilter = ACTIONABLE_STATUSES;
  }
  const tasks = await scanTasks(config, { status: statusFilter });
  return tasks.filter((t) => matchesSearch(t.description, search));
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
 * @param expectedDescription - Optional partial text the task must contain (safety check against stale line numbers)
 * @returns The description of the completed task
 */
export async function completeTask(
  config: SiftConfig,
  taskOrFile: Task | string,
  line?: number,
  expectedDescription?: string,
): Promise<string> {
  let filePath: string;
  let lineNum: number;

  if (typeof taskOrFile === "string") {
    if (line === undefined) {
      throw new Error("Line number is required when passing a file path");
    }
    filePath = normalizeFilePath(config, taskOrFile);
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

  // Verify the line is actually a task checkbox
  const targetLine = lines[lineIdx];
  if (!targetLine.match(/- \[.\]/)) {
    throw new Error(
      `Line ${lineNum} in ${filePath} is not a task: "${targetLine.trim()}"`,
    );
  }

  // Safety check: verify the task description matches what the caller expects
  if (expectedDescription) {
    verifyDescription(targetLine, expectedDescription, lineNum, filePath);
  }

  const today = localToday();

  // Replace the checkbox and add done date
  let updatedLine = targetLine;
  updatedLine = updatedLine.replace(/- \[.\]/, "- [x]");

  // Add done date if not already present
  if (!updatedLine.includes("✅")) {
    updatedLine = updatedLine.trimEnd() + ` ✅ ${today}`;
  }

  lines[lineIdx] = updatedLine;
  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");

  // Extract a description for confirmation
  const descMatch = targetLine.match(/- \[.\]\s+(.*)/);
  return descMatch ? descMatch[1].trim() : targetLine.trim();
}

/**
 * Mark a task with any status by updating its checkbox in the file.
 *
 * @param config - The sift configuration
 * @param filePath - File path (relative to vault root, or absolute)
 * @param lineNum - The 1-indexed line number
 * @param status - The new task status to set
 * @param expectedDescription - Optional partial text the task must contain (safety check against stale line numbers)
 * @returns The description of the updated task
 */
export async function markTaskStatus(
  config: SiftConfig,
  filePath: string,
  lineNum: number,
  status: TaskStatus,
  expectedDescription?: string,
): Promise<string> {
  const normalizedPath = normalizeFilePath(config, filePath);
  const fullPath = path.join(config.vaultPath, normalizedPath);
  const content = await fs.readFile(fullPath, "utf-8");
  const lines = content.split("\n");

  const lineIdx = lineNum - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) {
    throw new Error(`Line ${lineNum} out of range in ${filePath}`);
  }

  const targetLine = lines[lineIdx];
  if (!targetLine.match(/- \[.\]/)) {
    throw new Error(
      `Line ${lineNum} in ${filePath} is not a task: "${targetLine.trim()}"`,
    );
  }

  // Safety check: verify the task description matches what the caller expects
  if (expectedDescription) {
    verifyDescription(targetLine, expectedDescription, lineNum, filePath);
  }

  const newChar = statusToChar(status);
  let updatedLine = targetLine.replace(/- \[.\]/, `- [${newChar}]`);

  // When completing, add done date if not already present
  if (status === "done" && !updatedLine.includes("✅")) {
    updatedLine = updatedLine.trimEnd() + ` ✅ ${localToday()}`;
  }

  lines[lineIdx] = updatedLine;
  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");

  const descMatch = targetLine.match(/- \[.\]\s+(.*)/);
  return descMatch ? descMatch[1].trim() : targetLine.trim();
}

/**
 * Options for updating a task's metadata in place.
 * At least one of the optional fields must be provided.
 */
export interface UpdateTaskOptions {
  /** File path (relative to vault root, or absolute) */
  file: string;
  /** 1-indexed line number */
  line: number;
  /** Optional partial text the task must contain (safety check against stale line numbers) */
  description?: string;
  /** New priority level, or "none" to remove */
  priority?: Priority;
  /** New due date (YYYY-MM-DD), or "none" to remove */
  due?: string;
  /** New scheduled date (YYYY-MM-DD), or "none" to remove */
  scheduled?: string;
  /** New start date (YYYY-MM-DD), or "none" to remove */
  start?: string;
}

/**
 * Result of updating a task.
 */
export interface UpdateTaskResult {
  /** The task description (for confirmation messages) */
  description: string;
  /** The updated line as written to the file */
  updatedLine: string;
}

/**
 * Update a task's metadata (dates, priority) in place.
 *
 * Parses the existing task line, replaces the requested fields, re-formats
 * the line, and writes it back. Fields not specified in `options` are left
 * unchanged. Pass "none" for a date or priority field to remove it.
 *
 * @param config - The sift configuration
 * @param options - What to update
 * @returns The description and updated line
 */
export async function updateTask(
  config: SiftConfig,
  options: UpdateTaskOptions,
): Promise<UpdateTaskResult> {
  const normalizedPath = normalizeFilePath(config, options.file);
  const fullPath = path.join(config.vaultPath, normalizedPath);
  const content = await fs.readFile(fullPath, "utf-8");
  const lines = content.split("\n");

  const lineIdx = options.line - 1;
  if (lineIdx < 0 || lineIdx >= lines.length) {
    throw new Error(`Line ${options.line} out of range in ${normalizedPath}`);
  }

  const targetLine = lines[lineIdx];
  if (!targetLine.match(/- \[.\]/)) {
    throw new Error(
      `Line ${options.line} in ${normalizedPath} is not a task: "${targetLine.trim()}"`,
    );
  }

  // Safety check: verify the task description matches what the caller expects
  if (options.description) {
    verifyDescription(targetLine, options.description, options.line, normalizedPath);
  }

  // Parse the existing task to get all current metadata
  const task = parseLine(targetLine, normalizedPath, options.line);
  if (!task) {
    throw new Error(
      `Line ${options.line} in ${normalizedPath} could not be parsed as a task`,
    );
  }

  // Apply updates — "none" means remove, undefined means keep existing
  const updatedPriority = options.priority !== undefined
    ? (options.priority === "none" ? "none" : options.priority)
    : task.priority;

  const updatedDue = options.due !== undefined
    ? (options.due === "none" ? null : options.due)
    : task.due;

  const updatedScheduled = options.scheduled !== undefined
    ? (options.scheduled === "none" ? null : options.scheduled)
    : task.scheduled;

  const updatedStart = options.start !== undefined
    ? (options.start === "none" ? null : options.start)
    : task.start;

  // Re-format the task line with updated metadata
  const updatedLine = formatTask({
    description: task.description,
    status: task.status,
    priority: updatedPriority,
    scheduled: updatedScheduled,
    due: updatedDue,
    start: updatedStart,
    done: task.done,
    created: task.created,
    recurrence: task.recurrence,
  });

  lines[lineIdx] = updatedLine;
  await fs.writeFile(fullPath, lines.join("\n"), "utf-8");

  return {
    description: task.description,
    updatedLine,
  };
}

/**
 * Options for moving a task from one file to another.
 */
export interface MoveTaskOptions {
  /** Source file path (relative to vault root, or absolute) */
  file: string;
  /** 1-indexed line number of the task in the source file */
  line: number;
  /** Optional partial text the task must contain (safety check against stale line numbers) */
  description?: string;
  /** Destination project or area name (inserts under ## Tasks). Mutually exclusive with `date`. */
  project?: string;
  /** Destination daily note date YYYY-MM-DD (inserts under ## Journal). Mutually exclusive with `project`. */
  date?: string;
}

/**
 * Result of moving a task.
 */
export interface MoveTaskResult {
  /** The task description */
  description: string;
  /** The task line as written to the destination */
  taskLine: string;
  /** Where the task was moved to (for confirmation messages) */
  destination: string;
  /** Whether the destination project was reopened (was "done", now "active") */
  reopened?: boolean;
}

/**
 * Move a task from one file to another.
 *
 * Removes the task line from the source file and inserts it in the
 * destination file under the appropriate heading (## Tasks for projects/areas,
 * ## Journal for daily notes).
 *
 * Write order: destination first, then source — so if the second write fails,
 * the task exists in both places (safe) rather than neither (data loss).
 *
 * Exactly one of `options.project` or `options.date` must be provided.
 *
 * @param config - The sift configuration
 * @param options - Source location and destination
 * @returns Info about the moved task
 */
export async function moveTask(
  config: SiftConfig,
  options: MoveTaskOptions,
): Promise<MoveTaskResult> {
  if (!options.project && !options.date) {
    throw new Error("Provide either 'project' or 'date' as the destination.");
  }
  if (options.project && options.date) {
    throw new Error("Provide either 'project' or 'date', not both.");
  }

  // ── Read and validate the source ──────────────────────────
  const normalizedSourcePath = normalizeFilePath(config, options.file);
  const sourceFullPath = path.join(config.vaultPath, normalizedSourcePath);
  const sourceContent = await fs.readFile(sourceFullPath, "utf-8");
  const sourceLines = sourceContent.split("\n");

  const lineIdx = options.line - 1;
  if (lineIdx < 0 || lineIdx >= sourceLines.length) {
    throw new Error(`Line ${options.line} out of range in ${normalizedSourcePath}`);
  }

  const taskLine = sourceLines[lineIdx];
  if (!taskLine.match(/- \[.\]/)) {
    throw new Error(
      `Line ${options.line} in ${normalizedSourcePath} is not a task: "${taskLine.trim()}"`,
    );
  }

  if (options.description) {
    verifyDescription(taskLine, options.description, options.line, normalizedSourcePath);
  }

  // Extract description for the result
  const descMatch = taskLine.match(/- \[.\]\s+(.*)/);
  const description = descMatch ? descMatch[1].trim() : taskLine.trim();

  // ── Resolve the destination ───────────────────────────────
  let destFullPath: string;
  let destHeading: string;
  let destination: string;
  let reopened = false;

  if (options.project) {
    const project = await findProject(config, options.project);
    if (!project) {
      throw new Error(
        `Project "${options.project}" not found. Use "sift projects" to see available projects.`,
      );
    }
    destFullPath = path.join(config.vaultPath, project.filePath);
    destHeading = "## Tasks";
    destination = `${project.kind} "${project.name}"`;

    // Auto-reopen done projects when moving an incomplete task to them
    const task = parseLine(taskLine, normalizedSourcePath, options.line);
    if (task && task.status !== "done" && task.status !== "cancelled" && project.status === "done") {
      const { setProjectField: setField } = await import("./projects.js");
      await setField(config, project.name, "status", "active");
      reopened = true;
    }
  } else {
    const targetDate = options.date!;
    const dailyNotePath = getDailyNotePath(config, targetDate);
    destFullPath = path.join(config.vaultPath, dailyNotePath);
    destHeading = "## Journal";
    destination = `daily note for ${targetDate}`;

    // Ensure the daily notes directory exists
    await fs.mkdir(path.dirname(destFullPath), { recursive: true });
  }

  // ── Write destination first (task briefly in both places) ─
  let destContent: string;
  try {
    destContent = await fs.readFile(destFullPath, "utf-8");
  } catch {
    // Daily note doesn't exist yet — create from template
    if (options.date) {
      destContent = createDailyNoteTemplate(options.date);
    } else {
      throw new Error(`Destination file not found: ${destFullPath}`);
    }
  }

  // Strip self-referential wiki links if moving to a project
  let cleanedTaskLine = taskLine;
  if (options.project) {
    const project = await findProject(config, options.project);
    if (project) {
      cleanedTaskLine = stripSelfLinks(taskLine, project.name);
    }
  }

  destContent = insertContentUnderHeading(destContent, cleanedTaskLine, destHeading);
  await fs.writeFile(destFullPath, destContent, "utf-8");

  // ── Remove from source ────────────────────────────────────
  sourceLines.splice(lineIdx, 1);
  await fs.writeFile(sourceFullPath, sourceLines.join("\n"), "utf-8");

  return { description, taskLine: cleanedTaskLine, destination, reopened };
}

// ─── Internal helpers ────────────────────────────────────────

/**
 * Verify that a task line contains the expected description text.
 * Uses case-insensitive matching. Throws if the text is not found.
 */
function verifyDescription(
  line: string,
  expected: string,
  lineNum: number,
  filePath: string,
): void {
  // Strip markdown formatting from both sides so that backtick-wrapped terms,
  // wiki links, bold, etc. don't prevent matching.
  const cleanLine = stripMarkdownForVerify(line).toLowerCase();
  const cleanExpected = stripMarkdownForVerify(expected).toLowerCase();
  if (!cleanLine.includes(cleanExpected)) {
    throw new Error(
      `Task at line ${lineNum} in ${filePath} does not match expected description. ` +
      `Expected to contain "${expected}" but found: "${line.trim()}"`,
    );
  }
}

/**
 * Strip markdown syntax for description verification.
 * Removes: wiki links, bold, italic (word-boundary only), inline code, tags.
 */
function stripMarkdownForVerify(text: string): string {
  let result = text;
  // Wiki links: [[display|target]] -> display, [[target]] -> target
  result = result.replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2");
  // Bold/italic with asterisks
  result = result.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
  // Bold/italic with underscores (word-boundary only)
  result = result.replace(/(?<!\w)_{1,2}([^_]+)_{1,2}(?!\w)/g, "$1");
  // Inline code
  result = result.replace(/`([^`]+)`/g, "$1");
  // Tags
  result = result.replace(/(?<=\s|^)#([\w-]+)/g, "$1");
  return result;
}

/**
 * Normalize a file path that may be absolute or vault-relative.
 * If the path starts with the vault root, strip it to get the vault-relative path.
 */
function normalizeFilePath(config: SiftConfig, filePath: string): string {
  if (path.isAbsolute(filePath) && filePath.startsWith(config.vaultPath)) {
    return path.relative(config.vaultPath, filePath);
  }
  return filePath;
}

/**
 * Strip wiki links that reference the given name from text.
 * Handles both `[[Name]]` and `[[Name|alias]]` forms.
 * The link is replaced with its display text (alias if present, name otherwise),
 * so the prose still reads naturally — only the link syntax is removed.
 */
function stripSelfLinks(text: string, projectName: string): string {
  const escaped = projectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match [[Name]] or [[Name|display text]]
  const pattern = new RegExp(`\\[\\[${escaped}(?:\\|([^\\]]+))?\\]\\]`, "gi");
  return text.replace(pattern, (_match, alias) => alias || projectName);
}

/**
 * Add a formatted task line to a daily note under "## Journal".
 * @param date - Target date (YYYY-MM-DD). Defaults to today.
 */
async function addTaskToDailyNote(
  config: SiftConfig,
  taskLine: string,
  date?: string,
): Promise<string> {
  const targetDate = date || localToday();
  const dailyNotePath = getDailyNotePath(config, targetDate);
  const fullPath = path.join(config.vaultPath, dailyNotePath);

  // Ensure the daily notes directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  // Check if the daily note exists
  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch {
    // File doesn't exist, create it with the standard template
    content = createDailyNoteTemplate(targetDate);
  }

  // Insert the task under the "## Journal" section
  const updatedContent = insertContentUnderHeading(content, taskLine, "## Journal");
  await fs.writeFile(fullPath, updatedContent, "utf-8");

  return taskLine;
}

/**
 * Add a formatted task line to a project file under "## Tasks".
 * Falls back to appending at end if no "## Tasks" heading exists.
 *
 * If the project has `status: done`, it is automatically reopened
 * (set to "active") before adding the task.
 */
async function addTaskToProject(
  config: SiftConfig,
  projectName: string,
  taskLine: string,
): Promise<AddTaskResult> {
  const project = await findProject(config, projectName);
  if (!project) {
    throw new Error(
      `Project "${projectName}" not found. Use "sift projects" to see available projects.`,
    );
  }

  // Auto-reopen done projects when adding a new task
  let reopened = false;
  if (project.status === "done") {
    const { setProjectField } = await import("./projects.js");
    await setProjectField(config, project.name, "status", "active");
    reopened = true;
  }

  const fullPath = path.join(config.vaultPath, project.filePath);
  let content = await fs.readFile(fullPath, "utf-8");

  // Strip self-referential wiki links from the task line
  const cleanedTaskLine = stripSelfLinks(taskLine, project.name);

  // Try to insert under ## Tasks, fall back to appending
  content = insertContentUnderHeading(content, cleanedTaskLine, "## Tasks", "## Changelog");
  await fs.writeFile(fullPath, content, "utf-8");

  return { taskLine: cleanedTaskLine, reopened };
}

/**
 * Add a note to a daily note under a heading (default "## Journal").
 * @param options.date - Target date (YYYY-MM-DD). Defaults to today.
 */
async function addNoteToDailyNote(
  config: SiftConfig,
  options: AddNoteOptions,
): Promise<string> {
  const targetDate = options.date || localToday();
  const dailyNotePath = getDailyNotePath(config, targetDate);
  const fullPath = path.join(config.vaultPath, dailyNotePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  let content: string;
  try {
    content = await fs.readFile(fullPath, "utf-8");
  } catch {
    content = createDailyNoteTemplate(targetDate);
  }

  const heading = options.heading || "## Journal";
  content = insertContentUnderHeading(content, options.content, heading);
  await fs.writeFile(fullPath, content, "utf-8");

  return options.content;
}

/**
 * Add a note to a project file under a heading (default "## Notes").
 */
async function addNoteToProject(
  config: SiftConfig,
  options: AddNoteOptions,
): Promise<string> {
  const project = await findProject(config, options.project!);
  if (!project) {
    throw new Error(
      `Project "${options.project}" not found. Use "sift projects" to see available projects.`,
    );
  }

  const fullPath = path.join(config.vaultPath, project.filePath);
  let content = await fs.readFile(fullPath, "utf-8");

  const heading = options.heading || "## Notes";

  // Strip self-referential wiki links (e.g., [[Project Name]]) from content
  // being written to that project's own file — they add noise, not information.
  const noteContent = stripSelfLinks(options.content, project.name);
  content = insertContentUnderHeading(content, noteContent, heading, "## Changelog");

  await fs.writeFile(fullPath, content, "utf-8");

  return noteContent;
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


## Work Log


## Tasks Created Today
\`\`\`tasks
created on ${date}
filename does not include ${date}
\`\`\`

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
 * Insert content under a specific heading in a markdown document.
 *
 * The content is inserted after the last non-empty line in the section
 * (before the next heading or end of file). If the heading doesn't exist,
 * it is appended to the end of the file.
 *
 * When `beforeHeading` is provided and the target heading doesn't exist,
 * the new section is inserted immediately before `beforeHeading` instead
 * of at the end. This keeps anchor sections (like "## Changelog") at the
 * bottom of the file.
 *
 * Supports multi-line content: each line is inserted as a separate line
 * in the file.
 */
export function insertContentUnderHeading(
  fileContent: string,
  newContent: string,
  heading: string,
  beforeHeading?: string,
): string {
  const lines = fileContent.split("\n");
  let headingIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === heading) {
      headingIdx = i;
      break;
    }
  }

  if (headingIdx === -1) {
    // Heading not found — insert before `beforeHeading` if it exists,
    // otherwise append to end.
    if (beforeHeading) {
      let beforeIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() === beforeHeading) {
          beforeIdx = i;
          break;
        }
      }
      if (beforeIdx !== -1) {
        // Insert the new heading + content before the anchor heading.
        // Consume any leading blank lines so spacing stays clean.
        let insertIdx = beforeIdx;
        while (insertIdx > 0 && lines[insertIdx - 1].trim() === "") {
          insertIdx--;
        }
        const block = ["", heading, newContent, ""];
        lines.splice(insertIdx, beforeIdx - insertIdx, ...block);
        return lines.join("\n");
      }
    }

    // No beforeHeading or it wasn't found — append to end
    return fileContent.trimEnd() + "\n\n" + heading + "\n" + newContent + "\n";
  }

  // Find the last non-empty line in this section,
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

  // Split new content into lines for multi-line support
  const contentLines = newContent.split("\n");

  // Insert after the last content line in the section
  if (lastContentIdx === headingIdx) {
    // Section was empty, insert right after heading
    lines.splice(headingIdx + 1, 0, ...contentLines);
  } else {
    // Insert after the last content line
    lines.splice(lastContentIdx + 1, 0, ...contentLines);
  }

  return lines.join("\n");
}

// ─── Promote ─────────────────────────────────────────────────

/**
 * Options for promoting a task to a project.
 */
export interface PromoteTaskOptions {
  /** File path (relative to vault root, or absolute) */
  file: string;
  /** 1-indexed line number of the task */
  line: number;
  /** Project name. Default: task description. */
  name?: string;
  /** Parent area for the new project */
  area?: string;
  /** Initial project status. Default: "active" */
  status?: string;
  /** Tags for the new project */
  tags?: string[];
  /** Partial task text for safety verification */
  description?: string;
}

/**
 * Result of promoting a task to a project.
 */
export interface PromoteTaskResult {
  /** The task description */
  task: string;
  /** Source file path */
  sourceFile: string;
  /** Source line number */
  sourceLine: number;
  /** The new project name */
  projectName: string;
  /** Path to the new project file (relative to vault root) */
  projectFile: string;
  /** Whether the task had a thread that was preserved */
  hadThread: boolean;
}

/**
 * Promote a task to a project. Creates a new project file, moves the task
 * (and any attached thread) into it, and removes from the source file.
 *
 * Follows the same safety pattern as moveTask: writes destination first,
 * then removes from source.
 */
export async function promoteTask(
  config: SiftConfig,
  options: PromoteTaskOptions,
): Promise<PromoteTaskResult> {
  const { createProject: create } = await import("./projects.js");

  // ── Read and validate the source ──────────────────────────
  const normalizedSourcePath = normalizeFilePath(config, options.file);
  const sourceFullPath = path.join(config.vaultPath, normalizedSourcePath);
  const sourceContent = await fs.readFile(sourceFullPath, "utf-8");
  const sourceLines = sourceContent.split("\n");

  const lineIdx = options.line - 1;
  if (lineIdx < 0 || lineIdx >= sourceLines.length) {
    throw new Error(`Line ${options.line} out of range in ${normalizedSourcePath}`);
  }

  const taskLine = sourceLines[lineIdx];
  if (!taskLine.match(/- \[.\]/)) {
    throw new Error(
      `Line ${options.line} in ${normalizedSourcePath} is not a task: "${taskLine.trim()}"`,
    );
  }

  if (options.description) {
    verifyDescription(taskLine, options.description, options.line, normalizedSourcePath);
  }

  // Extract task description
  const task = parseLine(taskLine, normalizedSourcePath, options.line);
  const taskDescription = task ? task.description : taskLine.trim();

  // ── Collect the task block (task line + thread lines) ─────
  const blockLines = [taskLine];
  let threadLineCount = 0;

  // Look for thread blockquote lines following the task
  const blockquoteRegex = /^\s*>/;
  for (let i = lineIdx + 1; i < sourceLines.length; i++) {
    const line = sourceLines[i];
    // Stop at next task line
    if (/^\s*- \[.\]/.test(line)) break;
    // Stop at non-blockquote, non-empty lines (next content)
    if (line.trim() !== "" && !blockquoteRegex.test(line)) break;
    // Include blockquote lines and blank lines within the block
    if (blockquoteRegex.test(line)) {
      blockLines.push(line);
      threadLineCount++;
    } else if (line.trim() === "") {
      // Blank line — check if more blockquote follows
      let hasMore = false;
      for (let j = i + 1; j < sourceLines.length; j++) {
        if (sourceLines[j].trim() === "") continue;
        if (blockquoteRegex.test(sourceLines[j])) hasMore = true;
        break;
      }
      if (hasMore) {
        blockLines.push(line);
      } else {
        break;
      }
    } else {
      break;
    }
  }

  const hadThread = threadLineCount > 0;

  // ── Create the project ────────────────────────────────────
  const projectName = options.name || taskDescription;
  const projectFilePath = await create(config, projectName, {
    status: options.status || "active",
    area: options.area,
    tags: options.tags,
  });

  // ── Insert task block into the project ────────────────────
  const projectFullPath = path.join(config.vaultPath, projectFilePath);
  let projectContent = await fs.readFile(projectFullPath, "utf-8");
  const taskBlock = blockLines.join("\n");
  projectContent = insertContentUnderHeading(projectContent, taskBlock, "## Tasks");
  await fs.writeFile(projectFullPath, projectContent, "utf-8");

  // ── Remove task block from source ─────────────────────────
  sourceLines.splice(lineIdx, blockLines.length);
  await fs.writeFile(sourceFullPath, sourceLines.join("\n"), "utf-8");

  return {
    task: taskDescription,
    sourceFile: normalizedSourcePath,
    sourceLine: options.line,
    projectName,
    projectFile: projectFilePath,
    hadThread,
  };
}
