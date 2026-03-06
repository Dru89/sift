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
