import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseContent } from "./parser.js";
import { localToday, addDays, previousDayOfWeek } from "./dates.js";
import { type Task, type TaskFilter, type SiftConfig, type Priority, type ChangelogEntry, type VaultFile, type ReviewSummary, ACTIONABLE_STATUSES } from "./types.js";

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
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    result = result.filter((t) => statuses.includes(t.status));
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
  const tasks = await scanTasks(config, { status: ACTIONABLE_STATUSES });
  const sorted = sortByUrgency(tasks);
  return sorted.slice(0, count);
}

/**
 * Get overdue tasks (due date is before today).
 */
export async function getOverdueTasks(config: SiftConfig): Promise<Task[]> {
  const today = localToday();
  const tasks = await scanTasks(config, { status: ACTIONABLE_STATUSES });
  return sortByUrgency(tasks.filter((t) => t.due !== null && t.due < today));
}

/**
 * Get tasks due today.
 */
export async function getDueToday(config: SiftConfig): Promise<Task[]> {
  const today = localToday();
  const tasks = await scanTasks(config, { status: ACTIONABLE_STATUSES });
  return sortByUrgency(tasks.filter((t) => t.due === today));
}

/**
 * Scan all project files for changelog entries.
 * Changelog entries are lines under "## Changelog" matching:
 *   - **YYYY-MM-DD:** summary text
 *
 * @param config - The sift configuration
 * @param since - Only return entries on or after this date (YYYY-MM-DD)
 * @param until - Only return entries on or before this date (YYYY-MM-DD)
 * @returns Array of changelog entries sorted by date (newest first)
 */
export async function scanChangelog(
  config: SiftConfig,
  since?: string,
  until?: string,
): Promise<ChangelogEntry[]> {
  const { vaultPath, projectsPath } = config;
  const projectsDir = path.join(vaultPath, projectsPath);

  let files: string[];
  try {
    files = await glob("*.md", { cwd: projectsDir, absolute: false });
  } catch {
    return [];
  }

  const entries: ChangelogEntry[] = [];
  const changelogPattern = /^- \*\*(\d{4}-\d{2}-\d{2}):\*\*\s+(.+)$/;

  for (const file of files) {
    const fullPath = path.join(projectsDir, file);
    const content = await fs.readFile(fullPath, "utf-8");
    const lines = content.split("\n");
    const filePath = path.join(projectsPath, file);
    const projectName = path.basename(file, ".md");

    // Find the ## Changelog heading
    let inChangelog = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed === "## Changelog") {
        inChangelog = true;
        continue;
      }

      // Stop at the next heading
      if (inChangelog && trimmed.startsWith("#")) {
        break;
      }

      if (!inChangelog) continue;

      const match = trimmed.match(changelogPattern);
      if (match) {
        const [, date, summary] = match;
        if (since && date < since) continue;
        if (until && date > until) continue;
        entries.push({
          date,
          summary,
          project: projectName,
          filePath,
          line: i + 1,
        });
      }
    }
  }

  // Sort by date descending (newest first)
  entries.sort((a, b) => b.date.localeCompare(a.date));
  return entries;
}

/**
 * Extract a simple frontmatter field value from markdown content.
 * Returns the string value for a given key, or undefined if not found/blank.
 */
function extractFrontmatterField(content: string, key: string): string | undefined {
  if (!content.startsWith("---")) return undefined;
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return undefined;
  const yaml = content.slice(3, endIdx);
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "m");
  const match = yaml.match(regex);
  if (!match) return undefined;
  const value = match[1].trim().replace(/^["']|["']$/g, "");
  return value || undefined;
}

/**
 * Scan the vault for non-task files (meetings, weblinks, etc.) that have a
 * `created:` or `date:` frontmatter field within the given date range.
 *
 * Skips: daily notes folder, projects folder, and any excludeFolders.
 * Groups results by the `type` frontmatter field, or the top-level folder.
 */
export async function scanVaultFiles(
  config: SiftConfig,
  since: string,
  until: string,
): Promise<VaultFile[]> {
  const { vaultPath, dailyNotesPath, projectsPath, excludeFolders } = config;

  const skipFolders = new Set([
    ...excludeFolders,
    dailyNotesPath,
    projectsPath,
  ]);

  const allFiles = await glob("**/*.md", {
    cwd: vaultPath,
    ignore: [...skipFolders].map((f) => `${f}/**`),
    absolute: false,
  });

  const results: VaultFile[] = [];

  for (const file of allFiles) {
    // Skip root-level files
    if (!file.includes("/")) continue;

    const fullPath = path.join(vaultPath, file);
    const content = await fs.readFile(fullPath, "utf-8");
    if (!content.startsWith("---")) continue;

    // Use 'created' if present, fall back to 'date'
    const dateValue =
      extractFrontmatterField(content, "created") ??
      extractFrontmatterField(content, "date");

    if (!dateValue || !dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) continue;
    if (dateValue < since || dateValue > until) continue;

    // Determine category: prefer 'type' frontmatter field, fall back to top-level folder
    const typeField = extractFrontmatterField(content, "type");
    const topFolder = file.split("/")[0];
    const category = typeField && typeField !== "project" ? typeField : topFolder;

    results.push({
      filePath: file,
      name: path.basename(file, ".md"),
      category,
      date: dateValue,
    });
  }

  // Sort by date descending, then name
  results.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
  return results;
}

/**
 * Generate a review summary for a given period.
 *
 * @param config - The sift configuration
 * @param since - Start of review period (YYYY-MM-DD). Defaults to last Friday.
 * @param until - End of review period (YYYY-MM-DD). Defaults to today.
 * @returns A ReviewSummary with completed, created, stale, changelog, and upcoming data
 */
export async function getReviewSummary(
  config: SiftConfig,
  since?: string,
  until?: string,
): Promise<ReviewSummary> {
  const today = localToday();
  const effectiveUntil = until || today;
  // Default: since last Friday (day 5)
  const effectiveSince = since || previousDayOfWeek(effectiveUntil, 5);

  const allTasks = await scanTasks(config);

  // Tasks completed during the period
  const completed = sortByUrgency(
    allTasks.filter(
      (t) =>
        t.status === "done" &&
        t.done !== null &&
        t.done >= effectiveSince &&
        t.done <= effectiveUntil,
    ),
  );

  // Tasks created during the period that are still actionable
  const created = sortByUrgency(
    allTasks.filter(
      (t) =>
        ACTIONABLE_STATUSES.includes(t.status) &&
        t.created !== null &&
        t.created >= effectiveSince &&
        t.created <= effectiveUntil,
    ),
  );

  // Stale tasks: actionable, no due or scheduled date, created before the period
  const stale = sortByUrgency(
    allTasks.filter(
      (t) =>
        ACTIONABLE_STATUSES.includes(t.status) &&
        t.due === null &&
        t.scheduled === null &&
        (t.created === null || t.created < effectiveSince),
    ),
  );

  // Deferred tasks: moved or on_hold, created during the period
  const deferred = sortByUrgency(
    allTasks.filter(
      (t) =>
        (t.status === "moved" || t.status === "on_hold") &&
        t.created !== null &&
        t.created >= effectiveSince &&
        t.created <= effectiveUntil,
    ),
  );

  // Changelog entries from project files
  const changelog = await scanChangelog(config, effectiveSince, effectiveUntil);

  // Non-task vault files dated within the period
  const newFiles = await scanVaultFiles(config, effectiveSince, effectiveUntil);

  // Upcoming: tasks due in the 7 days after the period
  const upcomingEnd = addDays(effectiveUntil, 7);
  const upcoming = sortByUrgency(
    allTasks.filter(
      (t) =>
        ACTIONABLE_STATUSES.includes(t.status) &&
        t.due !== null &&
        t.due > effectiveUntil &&
        t.due <= upcomingEnd,
    ),
  );

  return {
    since: effectiveSince,
    until: effectiveUntil,
    completed,
    created,
    stale,
    changelog,
    newFiles,
    deferred,
    upcoming,
  };
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
