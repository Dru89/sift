import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { parseContent } from "./parser.js";
import { localToday, addDays, previousDayOfWeek, daysBetween } from "./dates.js";
import { type Task, type TaskFilter, type SiftConfig, type Priority, type ChangelogEntry, type VaultFile, type ReviewSummary, ACTIONABLE_STATUSES } from "./types.js";

/**
 * Priority ordering for comparison. Lower number = higher priority.
 */
const PRIORITY_ORDER: Record<Priority, number> = {
  highest: 0,
  high: 1,
  none: 2,
  low: 3,
  lowest: 4,
};

// ─── Urgency Scoring ─────────────────────────────────────────
//
// Urgency is an additive numeric score computed from four independent
// components: due date, priority, scheduled date, and start date, plus
// a small boost for in-progress tasks. Higher score = more urgent.
//
// The model is inspired by Obsidian Tasks' urgency scoring (itself
// derived from Taskwarrior) but diverges in one key way: scheduled
// dates in the past decay over ~4 weeks instead of giving a permanent
// boost. This prevents stale tasks with long-past scheduled dates
// from permanently occupying the top of "next" views.
//
// See URGENCY.md for the design rationale.
//

/**
 * Urgency score contribution from priority.
 *
 * These values are calibrated so that priority alone doesn't dominate
 * over a near-term due date. A highest-priority task with no due date
 * (score 9.0) is outranked by a no-priority task due today (8.8 + 2.0).
 */
const PRIORITY_SCORE: Record<Priority, number> = {
  highest: 9.0,
  high: 6.0,
  none: 2.0,
  low: 0.0,
  lowest: -2.0,
};

/**
 * Compute the due-date component of urgency.
 *
 * Uses a linear ramp over a 14-day window around today:
 * - 7+ days overdue: 12.0 (capped — stays high until you act or the review flags it)
 * - Due today: 8.8
 * - 14+ days out: 2.4 (floor)
 * - No due date: 0.0
 *
 * The curve is ~0.46 points per day, matching Obsidian Tasks.
 */
function dueDateScore(dueDate: string | null, today: string): number {
  if (!dueDate) return 0.0;
  const daysUntil = daysBetween(today, dueDate);
  if (daysUntil < -7) return 12.0;   // overdue > 7 days, capped
  if (daysUntil > 14) return 2.4;    // far out, floor
  // Linear interpolation: -7 days → 12.0, +14 days → 2.4
  return 12.0 - ((daysUntil + 7) * (12.0 - 2.4)) / 21;
}

/**
 * Compute the scheduled-date component of urgency.
 *
 * - Scheduled for today: 5.0
 * - Scheduled in the past: decays from 5.0 to 0.0 over 4 weeks.
 *   A task scheduled 8 weeks ago contributes nothing — your behavior
 *   (ignoring it) is a signal that the scheduled date is stale.
 * - Scheduled in the future or no date: 0.0
 */
function scheduledDateScore(scheduledDate: string | null, today: string): number {
  if (!scheduledDate) return 0.0;
  const daysAgo = daysBetween(scheduledDate, today); // positive = past
  if (daysAgo < 0) return 0.0;   // future scheduled date
  if (daysAgo === 0) return 5.0;  // today
  // Decay: 5.0 at day 0, 0.0 at day 28 (4 weeks)
  return Math.max(5.0 - (daysAgo * 5.0) / 28, 0.0);
}

/**
 * Compute the start-date component of urgency.
 *
 * Start date is purely a penalty for future-start tasks.
 * - Future start: -3.0 (pushes task down)
 * - Today, past, or no date: 0.0
 */
function startDateScore(startDate: string | null, today: string): number {
  if (!startDate) return 0.0;
  if (startDate > today) return -3.0;
  return 0.0;
}

/**
 * Compute the urgency score for a single task.
 *
 * The score is the sum of independent components:
 * - Due date: 0.0 to 12.0 (strongest signal — deadlines dominate)
 * - Priority: -2.0 to 9.0 (sets the baseline importance)
 * - Scheduled date: 0.0 to 5.0 (decays if past, 0.0 if future/none)
 * - Start date: -3.0 or 0.0 (penalty for future-start only)
 * - In-progress: +3.0 if status is in_progress
 *
 * @returns A numeric score. Higher = more urgent.
 */
export function computeUrgency(task: Task, today?: string): number {
  const t = today ?? localToday();
  let score = 0;

  score += dueDateScore(task.due, t);
  score += PRIORITY_SCORE[task.priority];
  score += scheduledDateScore(task.scheduled, t);
  score += startDateScore(task.start, t);

  if (task.status === "in_progress") {
    score += 3.0;
  }

  return score;
}

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
    if (filter?.filePatterns?.length && !filter.filePatterns.some(p => file.includes(p))) {
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

  if (filter.startBefore) {
    result = result.filter(
      (t) => t.start !== null && t.start <= filter.startBefore!,
    );
  }

  if (filter.startAfter) {
    result = result.filter(
      (t) => t.start !== null && t.start >= filter.startAfter!,
    );
  }

  if (filter.search) {
    result = result.filter((t) => matchesSearch(t.description, filter.search!));
  }

  return result;
}

/**
 * Strip markdown syntax from text for search matching.
 * Removes wiki links ([[text]]), bold, italic, inline code, and tags.
 */
function stripMarkdownForSearch(text: string): string {
  let result = text;
  // Wiki links: [[display|target]] -> display, [[target]] -> target
  result = result.replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2");
  // Bold/italic with asterisks: **text** or *text*
  result = result.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1");
  // Bold/italic with underscores: __text__ or _text_ — only when bounded by non-word chars.
  // This avoids stripping underscores from identifiers like vault_write.
  result = result.replace(/(?<!\w)_{1,2}([^_]+)_{1,2}(?!\w)/g, "$1");
  // Inline code: `text`
  result = result.replace(/`([^`]+)`/g, "$1");
  // Tags: #tag-name (but not headings)
  result = result.replace(/(?<=\s|^)#([\w-]+)/g, "$1");
  return result;
}

/**
 * Exact tokenized search: strips markdown syntax from the description, then checks
 * that every whitespace-separated token in the search string appears somewhere
 * in the cleaned description (case-insensitive, order-independent).
 */
export function matchesSearch(description: string, search: string): boolean {
  const cleaned = stripMarkdownForSearch(description).toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => cleaned.includes(token));
}

/**
 * Check whether a task's start date is in the future (not yet actionable).
 * Tasks with no start date are always considered "ready."
 */
export function isNotYetStartable(task: Task, today?: string): boolean {
  if (!task.start) return false;
  return task.start > (today ?? localToday());
}

/**
 * Sort tasks by urgency score (descending).
 *
 * Uses the additive urgency scoring model — each task gets a numeric
 * score based on due date proximity, priority, scheduled date, start
 * date, and in-progress status. Tasks with higher scores come first.
 *
 * Ties are broken by: due date (soonest first) → priority → alphabetical.
 */
export function sortByUrgency(tasks: Task[]): Task[] {
  const today = localToday();
  const scoreCache = new Map<Task, number>();
  const getScore = (t: Task) => {
    let s = scoreCache.get(t);
    if (s === undefined) {
      s = computeUrgency(t, today);
      scoreCache.set(t, s);
    }
    return s;
  };

  return [...tasks].sort((a, b) => {
    // Primary: urgency score (higher first)
    const scoreDiff = getScore(b) - getScore(a);
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;

    // Tiebreaker 1: due date (soonest first, null last)
    if (a.due !== b.due) {
      if (a.due === null) return 1;
      if (b.due === null) return -1;
      return a.due.localeCompare(b.due);
    }

    // Tiebreaker 2: priority
    const prioA = PRIORITY_ORDER[a.priority];
    const prioB = PRIORITY_ORDER[b.priority];
    if (prioA !== prioB) return prioA - prioB;

    // Tiebreaker 3: alphabetical
    return a.description.localeCompare(b.description);
  });
}

/**
 * Get tasks that are most important right now.
 * Returns actionable tasks sorted by urgency score, limited to `count`.
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
 * Get tasks that are relevant to today's agenda.
 *
 * Returns actionable tasks matching any of these criteria:
 * - Due today or overdue (due <= today)
 * - Scheduled for today or a missed scheduled date (scheduled <= today)
 * - Start date is today (just became available)
 * - Status is in_progress (actively being worked on)
 * - Undated task on a daily note from the last 7 days (recent but unfiled)
 *
 * Excludes tasks with a future start date (can't work on them yet).
 * Results are sorted by urgency score.
 */
export async function getAgendaTasks(
  config: SiftConfig,
): Promise<Task[]> {
  const today = localToday();
  const recentCutoff = addDays(today, -7);
  const dailyNotesPrefix = config.dailyNotesPath + "/";
  const tasks = await scanTasks(config, { status: ACTIONABLE_STATUSES });

  const agenda = tasks.filter((t) => {
    // Exclude future-start tasks
    if (isNotYetStartable(t, today)) return false;

    // Include if any temporal condition matches
    if (t.due !== null && t.due <= today) return true;          // due today or overdue
    if (t.scheduled !== null && t.scheduled <= today) return true; // scheduled today or past
    if (t.start !== null && t.start === today) return true;      // just became available
    if (t.status === "in_progress") return true;                 // actively working on it

    // Include undated tasks from recent daily notes (last 7 days).
    // These are tasks you added recently but haven't scheduled or moved
    // to a project — they stay on the agenda for a week before falling
    // off into the triage loose-tasks bucket.
    if (t.due === null && t.scheduled === null && t.start === null) {
      if (t.filePath.startsWith(dailyNotesPrefix)) {
        const basename = t.filePath.split("/").pop()?.replace(/\.md$/, "");
        if (basename && /^\d{4}-\d{2}-\d{2}$/.test(basename) && basename >= recentCutoff) {
          return true;
        }
      }
    }

    return false;
  });

  return sortByUrgency(agenda);
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

  // Needs triage: actionable tasks where stated priority doesn't match
  // observed behavior, or tasks with no dates that may have been forgotten.
  // This replaces the narrower "stale" concept — it catches:
  // 1. No dates at all (may need scheduling or deprioritizing)
  // 2. High/highest priority with a scheduled date 4+ weeks in the past
  //    (stated priority doesn't match behavior)
  const TRIAGE_STALE_WEEKS = 4;
  const triageCutoff = addDays(today, -(TRIAGE_STALE_WEEKS * 7));
  const needsTriage = sortByUrgency(
    allTasks.filter((t) => {
      if (!ACTIONABLE_STATUSES.includes(t.status)) return false;
      // Created during this review period — too new to triage
      if (t.created !== null && t.created >= effectiveSince) return false;

      // Case 1: no dates at all
      if (t.due === null && t.scheduled === null && t.start === null) return true;

      // Case 2: high priority + stale scheduled date, no due date
      if (
        (t.priority === "highest" || t.priority === "high") &&
        t.due === null &&
        t.scheduled !== null &&
        t.scheduled < triageCutoff
      ) return true;

      return false;
    }),
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
    needsTriage,
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
