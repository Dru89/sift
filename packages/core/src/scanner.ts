import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseContent } from "./parser.js";
import { type Task, type TaskFilter, type SiftConfig, type Priority } from "./types.js";

/**
 * Priority ordering for comparison. Lower number = higher priority.
 */
const PRIORITY_ORDER: Record<Priority, number> = {
  highest: 0,
  high: 1,
  medium: 2,
  none: 3,
  low: 4,
  lowest: 5,
};

/**
 * Scan the entire vault for tasks, optionally filtering them.
 *
 * @param config - The sift configuration
 * @param filter - Optional filter criteria
 * @returns Array of tasks matching the filter
 */
export async function scanTasks(
  config: SiftConfig,
  filter?: TaskFilter,
): Promise<Task[]> {
  const { vaultPath, excludeFolders } = config;

  // Build ignore patterns from excluded folders
  const ignore = excludeFolders.map((folder) => path.join(vaultPath, folder, "**"));

  // Find all markdown files
  const files = await glob("**/*.md", {
    cwd: vaultPath,
    ignore: excludeFolders.map((f) => `${f}/**`),
    absolute: false,
  });

  const allTasks: Task[] = [];

  for (const file of files) {
    // Skip root-level files with ALL_CAPS names (e.g., QUICK_REFERENCE.md, SETUP_GUIDE.md)
    if (isRootAllCapsFile(file)) {
      continue;
    }

    // Apply file pattern filter early to avoid reading unnecessary files
    if (filter?.filePattern && !file.includes(filter.filePattern)) {
      continue;
    }

    const fullPath = path.join(vaultPath, file);
    const content = await fs.readFile(fullPath, "utf-8");
    const tasks = parseContent(content, file);
    allTasks.push(...tasks);
  }

  return applyFilter(allTasks, filter);
}

/**
 * Scan a single file for tasks.
 */
export async function scanFile(
  vaultPath: string,
  filePath: string,
): Promise<Task[]> {
  const fullPath = path.join(vaultPath, filePath);
  const content = await fs.readFile(fullPath, "utf-8");
  return parseContent(content, filePath);
}

/**
 * Apply filters to a list of tasks.
 */
export function applyFilter(tasks: Task[], filter?: TaskFilter): Task[] {
  if (!filter) return tasks;

  let result = tasks;

  if (filter.status) {
    result = result.filter((t) => t.status === filter.status);
  }

  if (filter.minPriority) {
    const threshold = PRIORITY_ORDER[filter.minPriority];
    result = result.filter((t) => PRIORITY_ORDER[t.priority] <= threshold);
  }

  if (filter.dueBefore) {
    result = result.filter(
      (t) => t.due !== null && t.due <= filter.dueBefore!,
    );
  }

  if (filter.scheduledBefore) {
    result = result.filter(
      (t) => t.scheduled !== null && t.scheduled <= filter.scheduledBefore!,
    );
  }

  if (filter.search) {
    const searchLower = filter.search.toLowerCase();
    result = result.filter((t) =>
      t.description.toLowerCase().includes(searchLower),
    );
  }

  return result;
}

/**
 * Sort tasks by urgency/importance.
 * Sort order:
 * 1. Priority (highest first)
 * 2. Due date (soonest first, tasks with due dates before tasks without)
 * 3. Scheduled date (soonest first)
 * 4. Alphabetical by description
 */
export function sortByUrgency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    // Priority first
    const prioA = PRIORITY_ORDER[a.priority];
    const prioB = PRIORITY_ORDER[b.priority];
    if (prioA !== prioB) return prioA - prioB;

    // Due date (null = later)
    if (a.due !== b.due) {
      if (a.due === null) return 1;
      if (b.due === null) return -1;
      return a.due.localeCompare(b.due);
    }

    // Scheduled date
    if (a.scheduled !== b.scheduled) {
      if (a.scheduled === null) return 1;
      if (b.scheduled === null) return -1;
      return a.scheduled.localeCompare(b.scheduled);
    }

    // Alphabetical fallback
    return a.description.localeCompare(b.description);
  });
}

/**
 * Get tasks that are most important right now.
 * Returns open tasks sorted by urgency, limited to `count`.
 */
export async function getNextTasks(
  config: SiftConfig,
  count: number = 10,
): Promise<Task[]> {
  const today = new Date().toISOString().slice(0, 10);

  const tasks = await scanTasks(config, { status: "open" });
  const sorted = sortByUrgency(tasks);
  return sorted.slice(0, count);
}

/**
 * Get overdue tasks (due date is before today).
 */
export async function getOverdueTasks(config: SiftConfig): Promise<Task[]> {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = await scanTasks(config, { status: "open" });
  return sortByUrgency(tasks.filter((t) => t.due !== null && t.due < today));
}

/**
 * Get tasks due today.
 */
export async function getDueToday(config: SiftConfig): Promise<Task[]> {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = await scanTasks(config, { status: "open" });
  return sortByUrgency(tasks.filter((t) => t.due === today));
}

/**
 * Check if a file path is a root-level file with an ALL_CAPS name.
 * These are typically setup/reference files, not real notes.
 *
 * Examples that match: "QUICK_REFERENCE.md", "SETUP_GUIDE.md"
 * Examples that don't: "Daily Notes/2026-01-23.md", "Projects/My Project.md"
 */
function isRootAllCapsFile(filePath: string): boolean {
  // Only root-level files (no directory separator)
  if (filePath.includes("/") || filePath.includes("\\")) return false;

  const name = path.basename(filePath, path.extname(filePath));
  // Check if the name is all uppercase letters, digits, and underscores
  return /^[A-Z][A-Z0-9_]+$/.test(name);
}
