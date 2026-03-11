/**
 * Represents the priority level of an Obsidian Task.
 *
 * Obsidian Tasks uses emoji markers for priority:
 * - ⏫ = highest
 * - 🔼 = high
 * - 🔽 = low
 * - 🔽 = lowest (double low in some setups, but we treat 🔽 as low)
 *
 * Tasks without a priority marker are considered "none".
 */
export type Priority = "highest" | "high" | "medium" | "low" | "lowest" | "none";

/**
 * Represents the completion status of a task.
 * Maps to Obsidian's checkbox states:
 * - `- [ ]` = "open"
 * - `- [x]` = "done"
 * - `- [-]` = "cancelled"
 */
export type TaskStatus = "open" | "done" | "cancelled";

/**
 * A fully parsed Obsidian Task with all metadata extracted.
 */
export interface Task {
  /** The raw text of the task, including all emoji metadata */
  raw: string;

  /** The task description with emoji metadata stripped out */
  description: string;

  /** open, done, or cancelled */
  status: TaskStatus;

  /** Priority level extracted from emoji markers */
  priority: Priority;

  /** Scheduled date (⏳ emoji) - when you plan to start working on it */
  scheduled: string | null;

  /** Due date (📅 emoji) - when the task is due */
  due: string | null;

  /** Start date (🛫 emoji) - the earliest date you can start */
  start: string | null;

  /** Completion date (✅ emoji) - when the task was marked done */
  done: string | null;

  /** Created date (➕ emoji) - when the task was created */
  created: string | null;

  /** Recurrence rule (🔁 emoji) - e.g., "every week" */
  recurrence: string | null;

  /** The file path (relative to vault root) where this task lives */
  filePath: string;

  /** The line number in the file (1-indexed) */
  line: number;
}

/**
 * Configuration for sift, determining where and how to access the vault.
 */
export interface SiftConfig {
  /** Absolute path to the Obsidian vault root */
  vaultPath: string;

  /** Path to the daily notes folder, relative to vault root */
  dailyNotesPath: string;

  /** Date format for daily note filenames (using date-fns style tokens) */
  dailyNotesFormat: string;

  /**
   * Folders to exclude from task scanning.
   * Relative to vault root. Defaults to ["Templates", "Attachments"].
   */
  excludeFolders: string[];

  /** Path to the projects folder, relative to vault root. Defaults to "Projects". */
  projectsPath: string;

  /** Path to the project template file, relative to vault root. Defaults to "Templates/Project.md". */
  projectTemplatePath: string;

  /**
   * The project associated with the current working directory.
   * Set in a per-repo .siftrc.json to associate a repo with a vault project.
   * When set, agents will default to adding tasks to this project.
   */
  project?: string;
}

/**
 * Metadata about a project in the vault.
 */
export interface ProjectInfo {
  /** The project name (derived from filename) */
  name: string;

  /** Path to the project file, relative to vault root */
  filePath: string;

  /** Frontmatter status field, if present */
  status?: string;

  /** Frontmatter timeframe field, if present */
  timeframe?: string;

  /** Frontmatter tags, if present */
  tags?: string[];
}

/**
 * Options for filtering tasks when querying.
 */
export interface TaskFilter {
  /** Only return tasks with this status */
  status?: TaskStatus;

  /** Only return tasks with this priority or higher */
  minPriority?: Priority;

  /** Only return tasks due on or before this date (YYYY-MM-DD) */
  dueBefore?: string;

  /** Only return tasks scheduled on or before this date (YYYY-MM-DD) */
  scheduledBefore?: string;

  /** Only return tasks from files matching this glob pattern */
  filePattern?: string;

  /** Free-text search in description */
  search?: string;
}

/**
 * A parsed changelog entry from a project file.
 * Changelog entries are lines like: `- **2026-03-10:** Added research notes on...`
 */
export interface ChangelogEntry {
  /** The date the entry was logged (YYYY-MM-DD) */
  date: string;

  /** The summary text */
  summary: string;

  /** The project name this entry belongs to */
  project: string;

  /** Path to the project file, relative to vault root */
  filePath: string;

  /** The line number in the file (1-indexed) */
  line: number;
}

/**
 * A weekly (or custom period) review summary.
 */
export interface ReviewSummary {
  /** Start of the review period (inclusive, YYYY-MM-DD) */
  since: string;

  /** End of the review period (inclusive, YYYY-MM-DD) */
  until: string;

  /** Tasks completed during the period (have ✅ date in range) */
  completed: Task[];

  /** Tasks created during the period that are still open (have ➕ date in range) */
  created: Task[];

  /** Open tasks with no due/scheduled date, created before the period */
  stale: Task[];

  /** Changelog entries from project files during the period */
  changelog: ChangelogEntry[];

  /** Tasks due in the 7 days after the review period */
  upcoming: Task[];
}
