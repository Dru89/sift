/**
 * Core-based tool implementations for the sift MCP server.
 *
 * Each function takes typed arguments, calls @sift/core directly,
 * and returns formatted text suitable for agent consumption.
 *
 * This module replaces the "shell out to CLI and parse stdout" pattern
 * with direct library imports for better type safety, performance,
 * and testability.
 */
import {
  resolveConfig,
  scanTasks,
  applyFilter,
  sortByUrgency,
  getNextTasks,
  getAgendaTasks,
  getOverdueTasks,
  getDueToday,
  findTasks,
  completeTask,
  markTaskStatus,
  updateTask,
  moveTask,
  addTask,
  addNote,
  createSubnote,
  listProjects,
  findProject,
  createProject,
  createArea,
  setProjectField,
  getReviewSummary,
  getTriageSummary,
  localToday,
  createThread,
  addThreadEntry,
  updateThreadState,
  promoteTask,
  parseThread,
  type Task,
  type SiftConfig,
  type TaskFilter,
  type TaskStatus,
  type ItemKind,
  type Thread,
  type ThreadState,
  type ThreadEntry,
  type ReviewSummary,
  type TriageSummary,
  type Tier1Project,
  type Tier2Project,
  type Tier3Group,
  type OrphanTask,
  type TriageSignal,
} from "@sift/core";

// ─── Config ──────────────────────────────────────────────────

let _config: SiftConfig | null = null;

/**
 * Resolve and cache the sift config.
 * Caching is safe because the vault path doesn't change during a server session.
 */
async function getConfig(): Promise<SiftConfig> {
  if (!_config) {
    _config = await resolveConfig();
  }
  return _config;
}

// ─── Formatting Helpers ──────────────────────────────────────

function formatTaskLine(task: Task, config: SiftConfig): string {
  const statusIcon =
    task.status === "done" ? "✓" :
    task.status === "cancelled" ? "✗" :
    task.status === "in_progress" ? "◐" :
    task.status === "on_hold" ? "⏸" :
    task.status === "moved" ? "→" :
    "○";

  const priorityIcon =
    task.priority === "highest" ? "⏫" :
    task.priority === "high" ? "🔼" :
    task.priority === "low" ? "🔽" :
    task.priority === "lowest" ? "⏬" :
    " ";

  let line = `${statusIcon} ${priorityIcon} ${task.description}`;

  const dateParts: string[] = [];
  if (task.due) dateParts.push(`due ${task.due}`);
  if (task.scheduled) dateParts.push(`scheduled ${task.scheduled}`);
  if (task.start) dateParts.push(`starts ${task.start}`);
  if (dateParts.length > 0) line += "  " + dateParts.join("  ");

  // Always show file path for agent tools (absolute)
  const absPath = `${config.vaultPath}/${task.filePath}`;
  line += `  [${absPath}:${task.line}]`;

  // Thread summary if present
  if (task.thread) {
    line += "\n  " + formatThreadSummary(task.thread);
  }

  return line;
}

function formatThreadSummary(thread: Thread): string {
  const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
  let summary = `Thread: ${thread.state} on ${counterparts}`;
  if (thread.followUp) summary += ` · follow-up: ${thread.followUp}`;
  if (thread.entries.length > 0) {
    const last = thread.entries[thread.entries.length - 1];
    if (last.date) summary += ` · last: ${last.date}`;
  }
  return summary;
}

function formatTaskList(tasks: Task[], header: string, config: SiftConfig): string {
  if (tasks.length === 0) {
    return `${header}\n  No tasks found.`;
  }
  const lines = [header];
  for (const task of tasks) {
    lines.push("  " + formatTaskLine(task, config));
  }
  return lines.join("\n");
}

// ─── Thread Helpers ──────────────────────────────────────────

interface ThreadAttention {
  active: Task[];   // ball in my court
  stale: Task[];    // past follow-up or undated waiting > 2 business days
}

/**
 * Find threads that need attention from all scanned tasks.
 * Active threads = ball in my court.
 * Stale threads = waiting with overdue follow-up, or waiting with no follow-up and last entry > 2 days old.
 */
function findThreadsNeedingAttention(tasks: Task[], today: string): ThreadAttention {
  const active: Task[] = [];
  const stale: Task[] = [];

  for (const task of tasks) {
    if (!task.thread) continue;
    const thread = task.thread;

    if (thread.state === "active") {
      active.push(task);
    } else if (thread.state === "waiting") {
      if (thread.followUp && thread.followUp < today) {
        stale.push(task);
      } else if (!thread.followUp && thread.entries.length > 0) {
        const lastEntry = thread.entries[thread.entries.length - 1];
        if (lastEntry.date) {
          const daysSince = Math.floor(
            (new Date(today).getTime() - new Date(lastEntry.date).getTime()) / (1000 * 60 * 60 * 24),
          );
          if (daysSince > 2) {
            stale.push(task);
          }
        }
      }
    }
  }

  return { active, stale };
}

function formatThreadAttention(attention: ThreadAttention, config: SiftConfig): string {
  const sections: string[] = [];

  if (attention.stale.length > 0) {
    sections.push("Stale Threads (follow up needed)");
    for (const task of attention.stale) {
      const thread = task.thread!;
      const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
      let line = `  ⚠ ${task.description} · waiting on ${counterparts}`;
      if (thread.followUp) {
        line += ` · follow-up: ${thread.followUp} (overdue)`;
      } else {
        const last = thread.entries[thread.entries.length - 1];
        line += ` · last: ${last?.date || "undated"} (no follow-up set)`;
      }
      const absPath = `${config.vaultPath}/${task.filePath}`;
      line += `\n    ${absPath}:${task.line}`;
      sections.push(line);
    }
  }

  if (attention.active.length > 0) {
    if (sections.length > 0) sections.push("");
    sections.push("Active Threads (ball in your court)");
    for (const task of attention.active) {
      const thread = task.thread!;
      const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
      let line = `  ● ${task.description} · with ${counterparts}`;
      if (thread.entries.length > 0) {
        const last = thread.entries[thread.entries.length - 1];
        line += ` · last: ${last.date || "undated"}: ${last.description}`;
      }
      const absPath = `${config.vaultPath}/${task.filePath}`;
      line += `\n    ${absPath}:${task.line}`;
      sections.push(line);
    }
  }

  return sections.join("\n");
}

/**
 * Check if a task has an unresolved thread before completing it.
 * Returns a warning string or null.
 */
async function getThreadWarning(config: SiftConfig, filePath: string, line: number): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const { parseContent } = await import("@sift/core");

  const normalizedPath = path.default.isAbsolute(filePath) && filePath.startsWith(config.vaultPath)
    ? path.default.relative(config.vaultPath, filePath)
    : filePath;
  const fullPath = path.default.join(config.vaultPath, normalizedPath);

  try {
    const content = await fs.readFile(fullPath, "utf-8");
    const tasks = parseContent(content, normalizedPath);
    const task = tasks.find((t) => t.line === line);
    if (task?.thread && task.thread.state !== "resolved") {
      const counterparts = task.thread.counterparts.map((c) => `[[${c}]]`).join(", ");
      return `Thread with ${counterparts} was auto-resolved (was ${task.thread.state}).`;
    }
  } catch {
    // Can't read file — skip warning
  }

  return null;
}

// ─── Tool Implementations ────────────────────────────────────

export interface ListArgs {
  search?: string;
  priority?: string;
  dueBefore?: string;
  scheduledBefore?: string;
  startBefore?: string;
  startAfter?: string;
  all?: boolean;
  project?: string;
}

export async function toolList(args: ListArgs): Promise<string> {
  const config = await getConfig();

  const filter: TaskFilter = {};
  if (!args.all) filter.status = ["open", "in_progress"];
  if (args.search) filter.search = args.search;
  if (args.dueBefore) filter.dueBefore = args.dueBefore;
  if (args.scheduledBefore) filter.scheduledBefore = args.scheduledBefore;
  if (args.startBefore) filter.startBefore = args.startBefore;
  if (args.startAfter) filter.startAfter = args.startAfter;
  if (args.project) filter.filePatterns = [args.project];

  const tasks = await scanTasks(config, filter);
  const sorted = sortByUrgency(tasks);

  return formatTaskList(sorted, "Tasks", config);
}

export interface NextArgs {
  count?: number;
}

export async function toolNext(args: NextArgs): Promise<string> {
  const config = await getConfig();
  const count = args.count || 5;
  const tasks = await getNextTasks(config, count);
  return formatTaskList(tasks, `Up Next (top ${count})`, config);
}

export interface ThreadCreateArgs {
  file: string;
  line: number;
  counterparts: string[];
  state?: ThreadState;
  followUp?: string;
  source?: string;
  content?: string;
  date?: string;
  description?: string;
}

export async function toolThreadCreate(args: ThreadCreateArgs): Promise<string> {
  const config = await getConfig();
  const result = await createThread(config, {
    file: args.file,
    line: args.line,
    counterparts: args.counterparts,
    state: args.state,
    followUp: args.followUp,
    source: args.source,
    content: args.content,
    date: args.date,
    description: args.description,
  });

  const lines = [
    `✓ Created thread on task: ${result.task}`,
    `  File: ${result.file}:${result.line}`,
    `  Counterparts: ${result.counterparts.map((c) => `[[${c}]]`).join(", ")}`,
    `  State: ${result.state}`,
  ];
  if (result.followUp) lines.push(`  Follow-up: ${result.followUp}`);
  if (result.source) lines.push(`  Source: ${result.source}`);
  if (result.lastEntry) lines.push(`  Entry: ${result.lastEntry.date}: ${result.lastEntry.description}`);

  return lines.join("\n");
}

export interface ThreadEntryArgs {
  file: string;
  line: number;
  content: string;
  state?: ThreadState;
  followUp?: string;
  date?: string;
  description?: string;
}

export async function toolThreadEntry(args: ThreadEntryArgs): Promise<string> {
  const config = await getConfig();
  const result = await addThreadEntry(config, {
    file: args.file,
    line: args.line,
    content: args.content,
    state: args.state,
    followUp: args.followUp,
    date: args.date,
    description: args.description,
  });

  const lines = [
    `✓ Added entry to thread on: ${result.task}`,
    `  State: ${result.state}`,
  ];
  if (result.followUp) lines.push(`  Follow-up: ${result.followUp}`);
  lines.push(`  Entry: ${result.lastEntry!.date}: ${result.lastEntry!.description}`);

  return lines.join("\n");
}

export interface ThreadStateArgs {
  file: string;
  line: number;
  state?: ThreadState;
  followUp?: string;
  counterparts?: string[];
  source?: string;
  description?: string;
}

export async function toolThreadState(args: ThreadStateArgs): Promise<string> {
  const config = await getConfig();
  const result = await updateThreadState(config, {
    file: args.file,
    line: args.line,
    state: args.state,
    followUp: args.followUp,
    counterparts: args.counterparts,
    source: args.source,
    description: args.description,
  });

  const lines = [
    `✓ Updated thread on: ${result.task}`,
    `  Counterparts: ${result.counterparts.map((c) => `[[${c}]]`).join(", ")}`,
    `  State: ${result.state}`,
  ];
  if (result.followUp) lines.push(`  Follow-up: ${result.followUp}`);
  if (result.source) lines.push(`  Source: ${result.source}`);

  return lines.join("\n");
}

export interface ThreadListArgs {
  state?: ThreadState | ThreadState[];
  stale?: boolean;
  counterpart?: string;
  project?: string;
}

export async function toolThreadList(args: ThreadListArgs): Promise<string> {
  const config = await getConfig();

  // Scan all tasks, then filter to those with threads
  const allTasks = await scanTasks(config);
  const tasksWithThreads = allTasks.filter((t) => t.thread !== null);

  // Filter by state
  const states: ThreadState[] = args.state
    ? (Array.isArray(args.state) ? args.state : [args.state])
    : ["active", "waiting"];

  let filtered = tasksWithThreads.filter((t) => states.includes(t.thread!.state));

  // Filter by counterpart
  if (args.counterpart) {
    const search = args.counterpart.toLowerCase();
    filtered = filtered.filter((t) =>
      t.thread!.counterparts.some((c) => c.toLowerCase().includes(search)),
    );
  }

  // Filter by project
  if (args.project) {
    filtered = filtered.filter((t) => t.filePath.includes(args.project!));
  }

  // Filter stale (past follow-up or undated waiting > 2 business days)
  if (args.stale) {
    const today = new Date();
    filtered = filtered.filter((t) => {
      const thread = t.thread!;
      if (thread.followUp) {
        return thread.followUp < today.toISOString().slice(0, 10);
      }
      // Undated waiting: check days since last entry
      if (thread.state === "waiting" && thread.entries.length > 0) {
        const lastEntry = thread.entries[thread.entries.length - 1];
        if (lastEntry.date) {
          const daysSince = Math.floor(
            (today.getTime() - new Date(lastEntry.date).getTime()) / (1000 * 60 * 60 * 24),
          );
          return daysSince > 2; // simplified — not counting business days yet
        }
      }
      return false;
    });
  }

  if (filtered.length === 0) {
    return "No threads found matching criteria.";
  }

  // Format output
  const lines: string[] = [];
  const counts = {
    active: tasksWithThreads.filter((t) => t.thread!.state === "active").length,
    waiting: tasksWithThreads.filter((t) => t.thread!.state === "waiting").length,
    paused: tasksWithThreads.filter((t) => t.thread!.state === "paused").length,
  };

  lines.push(`Threads (${counts.active} active, ${counts.waiting} waiting, ${counts.paused} paused)`);
  lines.push("");

  for (const task of filtered) {
    const thread = task.thread!;
    const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
    const stateLabel = thread.state === "waiting" ? `waiting on ${counterparts}` : thread.state;

    let taskLine = `  ${task.description} · ${stateLabel}`;
    if (thread.followUp) {
      const overdue = thread.followUp < new Date().toISOString().slice(0, 10);
      taskLine += overdue
        ? ` · follow-up: ${thread.followUp} (OVERDUE)`
        : ` · follow-up: ${thread.followUp}`;
    }

    lines.push(taskLine);

    // Show last entry
    if (thread.entries.length > 0) {
      const last = thread.entries[thread.entries.length - 1];
      lines.push(`    last: ${last.date || "undated"}: ${last.description}`);
    }

    const absPath = `${config.vaultPath}/${task.filePath}`;
    lines.push(`    ${absPath}:${task.line}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

// ─── Summary ─────────────────────────────────────────────────

export async function toolSummary(): Promise<string> {
  const config = await getConfig();
  const allTasks = await scanTasks(config);

  const open = allTasks.filter((t) => t.status === "open").length;
  const inProgress = allTasks.filter((t) => t.status === "in_progress").length;
  const done = allTasks.filter((t) => t.status === "done").length;

  const today = localToday();
  const overdue = allTasks.filter(
    (t) => t.due !== null && t.due < today && t.status !== "done" && t.status !== "cancelled",
  ).length;
  const dueToday = allTasks.filter(
    (t) => t.due === today && t.status !== "done" && t.status !== "cancelled",
  ).length;

  // Thread counts
  const threadAttention = findThreadsNeedingAttention(allTasks, today);
  const waitingThreads = allTasks.filter((t) => t.thread?.state === "waiting").length;

  const lines = [
    "Task Summary",
    `  Open: ${open}`,
    `  In Progress: ${inProgress}`,
    `  Done: ${done}`,
    `  Overdue: ${overdue}`,
    `  Due Today: ${dueToday}`,
  ];

  if (threadAttention.active.length > 0 || waitingThreads > 0 || threadAttention.stale.length > 0) {
    lines.push("");
    lines.push("Threads");
    if (threadAttention.active.length > 0) lines.push(`  Active (ball in your court): ${threadAttention.active.length}`);
    if (waitingThreads > 0) lines.push(`  Waiting: ${waitingThreads}`);
    if (threadAttention.stale.length > 0) lines.push(`  Stale (follow up needed): ${threadAttention.stale.length}`);
  }

  return lines.join("\n");
}

// ─── Agenda ──────────────────────────────────────────────────

export async function toolAgenda(): Promise<string> {
  const config = await getConfig();
  const today = localToday();
  const tasks = await getAgendaTasks(config);

  // Also scan for threads needing attention (from all tasks, not just agenda)
  const allTasks = await scanTasks(config);
  const threadAttention = findThreadsNeedingAttention(allTasks, today);

  const sections: string[] = [];
  sections.push(formatTaskList(tasks, "Today's Agenda", config));

  if (threadAttention.active.length > 0 || threadAttention.stale.length > 0) {
    sections.push("");
    sections.push(formatThreadAttention(threadAttention, config));
  }

  return sections.join("\n");
}

// ─── Add ─────────────────────────────────────────────────────

export interface AddArgs {
  description: string;
  priority?: string;
  due?: string;
  scheduled?: string;
  start?: string;
  recurrence?: string;
  project?: string;
  date?: string;
}

export async function toolAdd(args: AddArgs): Promise<string> {
  const config = await getConfig();
  const result = await addTask(config, {
    description: args.description,
    priority: args.priority as any,
    due: args.due,
    scheduled: args.scheduled,
    start: args.start,
    recurrence: args.recurrence,
    project: args.project,
    date: args.date,
  });

  let msg = `✓ Task added: ${result.taskLine}`;
  if (result.reopened) {
    msg += `\n  (Project was reopened from "done" to "active")`;
  }
  return msg;
}

// ─── Find ────────────────────────────────────────────────────

export interface FindArgs {
  search: string;
  all?: boolean;
  status?: string;
}

export async function toolFind(args: FindArgs): Promise<string> {
  const config = await getConfig();
  const options: { all?: boolean; status?: TaskStatus | TaskStatus[] } = {};
  if (args.all) options.all = true;
  if (args.status) options.status = args.status as TaskStatus;

  const tasks = await findTasks(config, args.search, options);
  return formatTaskList(tasks, `Search: "${args.search}" (${tasks.length} matches)`, config);
}

// ─── Done ────────────────────────────────────────────────────

export interface DoneArgs {
  file?: string;
  line?: number;
  search?: string;
  description?: string;
}

export async function toolDone(args: DoneArgs): Promise<string> {
  const config = await getConfig();

  // Precise mode: file + line
  if (args.file && args.line !== undefined) {
    // Check for thread before completing
    const warning = await getThreadWarning(config, args.file, args.line);
    const desc = await completeTask(config, args.file, args.line, args.description);
    let result = `✓ Completed: ${desc}`;
    if (warning) result += `\n⚠ ${warning}`;
    return result;
  }

  // Search mode
  if (args.search) {
    const matches = await findTasks(config, args.search);
    if (matches.length === 0) {
      return `No open tasks matching "${args.search}".`;
    }
    if (matches.length > 1) {
      const list = formatTaskList(matches, `Multiple matches for "${args.search}" — be more specific:`, config);
      return list;
    }
    const task = matches[0];
    const warning = task.thread && task.thread.state !== "resolved"
      ? `Thread with ${task.thread.counterparts.map(c => `[[${c}]]`).join(", ")} was auto-resolved (was ${task.thread.state}).`
      : null;
    const desc = await completeTask(config, task.filePath, task.line);
    let result = `✓ Completed: ${desc}`;
    if (warning) result += `\n⚠ ${warning}`;
    return result;
  }

  return "Provide either file+line or search to identify the task.";
}

// ─── Mark ────────────────────────────────────────────────────

export interface MarkArgs {
  status: string;
  file?: string;
  line?: number;
  search?: string;
  description?: string;
}

export async function toolMark(args: MarkArgs): Promise<string> {
  const config = await getConfig();
  const status = args.status as TaskStatus;

  // Precise mode: file + line
  if (args.file && args.line !== undefined) {
    const desc = await markTaskStatus(config, args.file, args.line, status, args.description);
    return `✓ Marked as ${status}: ${desc}`;
  }

  // Search mode
  if (args.search) {
    const matches = await findTasks(config, args.search);
    if (matches.length === 0) {
      return `No open tasks matching "${args.search}".`;
    }
    if (matches.length > 1) {
      const list = formatTaskList(matches, `Multiple matches for "${args.search}" — be more specific:`, config);
      return list;
    }
    const task = matches[0];
    const desc = await markTaskStatus(config, task.filePath, task.line, status);
    return `✓ Marked as ${status}: ${desc}`;
  }

  return "Provide either file+line or search to identify the task.";
}

// ─── Update ──────────────────────────────────────────────────

export interface UpdateArgs {
  file: string;
  line: number;
  description?: string;
  priority?: string;
  due?: string;
  scheduled?: string;
  start?: string;
}

export async function toolUpdate(args: UpdateArgs): Promise<string> {
  const config = await getConfig();
  const result = await updateTask(config, {
    file: args.file,
    line: args.line,
    description: args.description,
    priority: args.priority as any,
    due: args.due,
    scheduled: args.scheduled,
    start: args.start,
  });

  return `✓ Updated: ${result.description}\n  ${result.updatedLine}`;
}

// ─── Move ────────────────────────────────────────────────────

export interface MoveArgs {
  file: string;
  line: number;
  description?: string;
  project?: string;
  date?: string;
}

export async function toolMove(args: MoveArgs): Promise<string> {
  const config = await getConfig();
  const result = await moveTask(config, {
    file: args.file,
    line: args.line,
    description: args.description,
    project: args.project,
    date: args.date,
  });

  let msg = `✓ Moved "${result.description}" to ${result.destination}`;
  if (result.reopened) {
    msg += `\n  (Project was reopened from "done" to "active")`;
  }
  return msg;
}

// ─── Projects ────────────────────────────────────────────────

export interface ProjectsArgs {
  tag?: string;
  kind?: string;
}

export async function toolProjects(args: ProjectsArgs): Promise<string> {
  const config = await getConfig();
  const kindFilter = args.kind as ItemKind | undefined;
  let projects = await listProjects(config, kindFilter);

  // Filter by tag if specified
  if (args.tag) {
    const tag = args.tag.replace(/^#/, "");
    projects = projects.filter(
      (p) => p.tags && p.tags.some((t) => t === tag),
    );
  }

  if (projects.length === 0) {
    return "No projects found matching criteria.";
  }

  const lines = [`Projects (${projects.length})`];
  for (const p of projects) {
    const status = p.status ? ` [${p.status}]` : "";
    const kind = p.kind === "area" ? " (area)" : "";
    const tags = p.tags ? ` #${p.tags.join(" #")}` : "";
    lines.push(`  ${p.name}${kind}${status}${tags}`);
  }

  return lines.join("\n");
}

// ─── Project Create ──────────────────────────────────────────

export interface ProjectCreateArgs {
  name: string;
  content?: string;
  status?: string;
  area?: string;
  tags?: string;
  frontmatter?: string;
}

export async function toolProjectCreate(args: ProjectCreateArgs): Promise<string> {
  const config = await getConfig();
  const options: any = {};
  if (args.content) options.content = args.content;
  if (args.status) options.status = args.status;
  if (args.area) options.area = args.area;
  if (args.tags) options.tags = args.tags.split(",").map((t: string) => t.trim());
  if (args.frontmatter) {
    try {
      options.frontmatter = JSON.parse(args.frontmatter);
    } catch {
      return "Error: frontmatter must be valid JSON.";
    }
  }

  const filePath = await createProject(config, args.name, options);
  const absPath = `${config.vaultPath}/${filePath}`;
  return `✓ Created project "${args.name}"\n  ${absPath}`;
}

// ─── Project Path ────────────────────────────────────────────

export interface ProjectPathArgs {
  name: string;
}

export async function toolProjectPath(args: ProjectPathArgs): Promise<string> {
  const config = await getConfig();
  const project = await findProject(config, args.name);
  if (!project) {
    return `Project "${args.name}" not found.`;
  }
  return `${config.vaultPath}/${project.filePath}`;
}

// ─── Project Set ─────────────────────────────────────────────

export interface ProjectSetArgs {
  name: string;
  status?: string;
  timeframe?: string;
  tags?: string[];
  reviewInterval?: number;
}

export async function toolProjectSet(args: ProjectSetArgs): Promise<string> {
  const config = await getConfig();

  const fields: Array<{ key: string; value: string | string[] }> = [];
  if (args.status) fields.push({ key: "status", value: args.status });
  if (args.timeframe) fields.push({ key: "timeframe", value: args.timeframe });
  if (args.tags) fields.push({ key: "tags", value: args.tags });
  if (args.reviewInterval !== undefined) fields.push({ key: "reviewInterval", value: String(args.reviewInterval) });

  if (fields.length === 0) {
    return "No fields specified to update.";
  }

  for (const { key, value } of fields) {
    await setProjectField(config, args.name, key, value);
  }

  const updated = fields.map((f) => `${f.key}: ${Array.isArray(f.value) ? f.value.join(", ") : f.value}`).join(", ");
  return `✓ Updated "${args.name}": ${updated}`;
}

// ─── Project Review ──────────────────────────────────────────

export interface ProjectReviewArgs {
  name: string;
}

export async function toolProjectReview(args: ProjectReviewArgs): Promise<string> {
  const config = await getConfig();
  const today = localToday();
  await setProjectField(config, args.name, "lastReviewed", today);
  return `✓ Stamped lastReviewed: ${today} on "${args.name}"`;
}

// ─── Area Create ─────────────────────────────────────────────

export interface AreaCreateArgs {
  name: string;
  content?: string;
  tags?: string;
  frontmatter?: string;
}

export async function toolAreaCreate(args: AreaCreateArgs): Promise<string> {
  const config = await getConfig();
  const options: any = {};
  if (args.content) options.content = args.content;
  if (args.tags) options.tags = args.tags.split(",").map((t: string) => t.trim());
  if (args.frontmatter) {
    try {
      options.frontmatter = JSON.parse(args.frontmatter);
    } catch {
      return "Error: frontmatter must be valid JSON.";
    }
  }

  const filePath = await createArea(config, args.name, options);
  const absPath = `${config.vaultPath}/${filePath}`;
  return `✓ Created area "${args.name}"\n  ${absPath}`;
}

// ─── Area Path ───────────────────────────────────────────────

export interface AreaPathArgs {
  name: string;
}

export async function toolAreaPath(args: AreaPathArgs): Promise<string> {
  const config = await getConfig();
  const project = await findProject(config, args.name);
  if (!project) {
    return `Area "${args.name}" not found.`;
  }
  return `${config.vaultPath}/${project.filePath}`;
}

// ─── Note ────────────────────────────────────────────────────

export interface NoteArgs {
  content: string;
  project?: string;
  heading?: string;
  date?: string;
}

export async function toolNote(args: NoteArgs): Promise<string> {
  const config = await getConfig();
  await addNote(config, {
    content: args.content,
    project: args.project,
    heading: args.heading,
    date: args.date,
  });

  const target = args.project ? `project "${args.project}"` : `daily note`;
  return `✓ Note added to ${target}`;
}

// ─── Subnote ─────────────────────────────────────────────────

export interface SubnoteArgs {
  project: string;
  title: string;
  content?: string;
  folder?: string;
  type?: string;
  tags?: string[];
  heading?: string;
}

export async function toolSubnote(args: SubnoteArgs): Promise<string> {
  const config = await getConfig();
  const result = await createSubnote(config, {
    project: args.project,
    title: args.title,
    content: args.content,
    folder: args.folder,
    type: args.type,
    tags: args.tags,
    heading: args.heading,
  });

  const absPath = `${config.vaultPath}/${result.filePath}`;
  const lines = [
    `✓ Created subnote "${result.title}" for project "${result.project}"`,
    `  File: ${absPath}`,
    `  Wiki link: [[${result.linkName}]]`,
  ];
  return lines.join("\n");
}

// ─── Triage ──────────────────────────────────────────────────

export interface TriageArgs {
  project?: string;
}

export async function toolTriage(args: TriageArgs): Promise<string> {
  const config = await getConfig();
  const today = localToday();
  const summary = await getTriageSummary(config, { project: args.project });

  // Also check for stale threads across all tasks
  const allTasks = await scanTasks(config);
  const threadAttention = findThreadsNeedingAttention(allTasks, today);

  let result = formatTriageSummary(summary, config);

  if (threadAttention.stale.length > 0) {
    const threadSection = [
      "",
      `== Stale Threads (${threadAttention.stale.length}) ==`,
      "",
    ];
    for (const task of threadAttention.stale) {
      const thread = task.thread!;
      const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
      let line = `  ⚠ ${task.description} · waiting on ${counterparts}`;
      if (thread.followUp) {
        line += ` · follow-up: ${thread.followUp} (overdue)`;
      }
      const absPath = `${config.vaultPath}/${task.filePath}`;
      line += `\n    ${absPath}:${task.line}`;
      threadSection.push(line);
    }
    result += "\n" + threadSection.join("\n");
  }

  return result;
}

function formatTriageSummary(summary: TriageSummary, config: SiftConfig): string {
  const lines: string[] = [];

  // Tier 1: needs attention
  if (summary.tier1.length > 0) {
    lines.push(`== Tier 1: Needs Attention (${summary.tier1.length}) ==`);
    lines.push("");
    for (const item of summary.tier1) {
      const kindLabel = item.project.kind === "area" ? "(area)" : "";
      lines.push(`  ${item.project.name} ${kindLabel}`.trimEnd());
      for (const signal of item.signals) {
        lines.push(`    - ${formatSignal(signal)}`);
      }
      if (item.tasks.length > 0) {
        const shown = item.tasks.slice(0, 3);
        for (const task of shown) {
          lines.push(`    ${formatTaskLine(task, config)}`);
        }
        if (item.tasks.length > 3) {
          lines.push(`    ... and ${item.tasks.length - 3} more tasks`);
        }
      }
      lines.push("");
    }
  }

  // Tier 2: due for review, looks healthy
  if (summary.tier2.length > 0) {
    lines.push(`== Tier 2: Due for Review (${summary.tier2.length}) ==`);
    lines.push("");
    for (const item of summary.tier2) {
      const activity = item.lastActivityDate ? `last activity: ${item.lastActivityDate}` : "no recent activity";
      lines.push(`  ${item.project.name} — ${item.openTaskCount} open tasks, ${activity}`);
      for (const task of item.topTasks) {
        lines.push(`    ${formatTaskLine(task, config)}`);
      }
      lines.push("");
    }
  }

  // Tier 3: not due
  if (summary.tier3.length > 0) {
    lines.push(`== Tier 3: Not Due for Review ==`);
    lines.push("");
    for (const group of summary.tier3) {
      lines.push(`  ${group.status}: ${group.names.join(", ")}`);
    }
    lines.push("");
  }

  // Loose tasks
  if (summary.looseTasks.length > 0) {
    lines.push(`== Loose Tasks (${summary.looseTasks.length}) ==`);
    lines.push("  Undated tasks from daily notes not on any project:");
    lines.push("");
    for (const orphan of summary.looseTasks) {
      let line = `  ${formatTaskLine(orphan.task, config)}`;
      if (orphan.mentionedProjects.length > 0) {
        line += `  (mentions: ${orphan.mentionedProjects.join(", ")})`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  if (lines.length === 0) {
    return "All projects look healthy. Nothing needs attention.";
  }

  return lines.join("\n").trimEnd();
}

function formatSignal(signal: TriageSignal): string {
  switch (signal.kind) {
    case "overdue_review":
      return `Review overdue (last: ${signal.lastReviewed || "never"}, interval: ${signal.intervalDays}d)`;
    case "stale_tasks":
      return `${signal.count} high-priority task(s) with stale scheduled dates`;
    case "undated_tasks":
      return `${signal.count} task(s) with no dates`;
    case "inactive":
      return `Inactive for ${signal.weeks} weeks (last activity: ${signal.lastActivityDate || "unknown"})`;
    case "orphan_mentions":
      return `${signal.count} daily-note task(s) mention this project`;
    case "done_with_open_tasks":
      return `Project marked "done" but has ${signal.openCount} open task(s)`;
  }
}

// ─── Review ──────────────────────────────────────────────────

export interface ReviewArgs {
  since?: string;
  until?: string;
  days?: number;
}

export async function toolReview(args: ReviewArgs): Promise<string> {
  const config = await getConfig();
  const today = localToday();

  let since = args.since;
  let until = args.until;

  // If days is specified, compute since from today
  if (args.days && !since) {
    until = until || today;
    const [y, m, d] = until.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() - args.days);
    since = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  const summary = await getReviewSummary(config, since, until);

  // Find thread activity in the review period
  const allTasks = await scanTasks(config);
  const periodStart = summary.since;
  const periodEnd = summary.until;

  const threadsWithActivity: Task[] = [];
  const staleThreads: Task[] = [];

  for (const task of allTasks) {
    if (!task.thread) continue;
    const thread = task.thread;

    // Thread has entries in the review period
    const hasRecentActivity = thread.entries.some(
      (e) => e.date && e.date >= periodStart && e.date <= periodEnd,
    );
    if (hasRecentActivity) threadsWithActivity.push(task);

    // Thread is stale at end of period
    if (thread.state === "waiting") {
      if (thread.followUp && thread.followUp < today) {
        staleThreads.push(task);
      } else if (!thread.followUp && thread.entries.length > 0) {
        const last = thread.entries[thread.entries.length - 1];
        if (last.date) {
          const daysSince = Math.floor(
            (new Date(today).getTime() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24),
          );
          if (daysSince > 2) staleThreads.push(task);
        }
      }
    }
  }

  let result = formatReviewSummary(summary, config);

  // Append thread section if there's activity
  if (threadsWithActivity.length > 0 || staleThreads.length > 0) {
    const threadLines: string[] = ["", "== Threads =="];

    if (threadsWithActivity.length > 0) {
      threadLines.push(`  Active during period: ${threadsWithActivity.length}`);
      for (const task of threadsWithActivity) {
        const thread = task.thread!;
        const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
        threadLines.push(`    ${task.description} · ${thread.state} · with ${counterparts}`);
      }
    }

    if (staleThreads.length > 0) {
      threadLines.push(`  Stale (need follow-up): ${staleThreads.length}`);
      for (const task of staleThreads) {
        const thread = task.thread!;
        const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
        threadLines.push(`    ⚠ ${task.description} · waiting on ${counterparts}`);
      }
    }

    result += "\n" + threadLines.join("\n");
  }

  return result;
}

function formatReviewSummary(summary: ReviewSummary, config: SiftConfig): string {
  const lines: string[] = [];

  lines.push(`Review: ${summary.since} → ${summary.until}`);
  lines.push("");

  // Completed
  lines.push(`== Completed (${summary.completed.length}) ==`);
  if (summary.completed.length > 0) {
    for (const task of summary.completed) {
      lines.push(`  ${formatTaskLine(task, config)}`);
    }
  } else {
    lines.push("  None.");
  }
  lines.push("");

  // Created & still open
  lines.push(`== Created & Still Open (${summary.created.length}) ==`);
  if (summary.created.length > 0) {
    for (const task of summary.created) {
      lines.push(`  ${formatTaskLine(task, config)}`);
    }
  } else {
    lines.push("  None.");
  }
  lines.push("");

  // Needs triage
  lines.push(`== Needs Triage (${summary.needsTriage.length}) ==`);
  if (summary.needsTriage.length > 0) {
    for (const task of summary.needsTriage) {
      lines.push(`  ${formatTaskLine(task, config)}`);
    }
  } else {
    lines.push("  None.");
  }
  lines.push("");

  // Deferred
  if (summary.deferred.length > 0) {
    lines.push(`== Deferred (${summary.deferred.length}) ==`);
    for (const task of summary.deferred) {
      lines.push(`  ${formatTaskLine(task, config)}`);
    }
    lines.push("");
  }

  // Changelog
  lines.push(`== Changelog (${summary.changelog.length}) ==`);
  if (summary.changelog.length > 0) {
    for (const entry of summary.changelog) {
      lines.push(`  ${entry.date} [${entry.project}] ${entry.summary}`);
    }
  } else {
    lines.push("  None.");
  }
  lines.push("");

  // New files
  if (summary.newFiles.length > 0) {
    lines.push(`== New Files (${summary.newFiles.length}) ==`);
    for (const file of summary.newFiles) {
      lines.push(`  ${file.date} [${file.category}] ${file.name}`);
    }
    lines.push("");
  }

  // Upcoming
  lines.push(`== Upcoming (${summary.upcoming.length}) ==`);
  if (summary.upcoming.length > 0) {
    for (const task of summary.upcoming) {
      lines.push(`  ${formatTaskLine(task, config)}`);
    }
  } else {
    lines.push("  None.");
  }

  return lines.join("\n").trimEnd();
}

// ─── Promote ─────────────────────────────────────────────────

export interface PromoteArgs {
  file: string;
  line: number;
  name?: string;
  area?: string;
  status?: string;
  tags?: string[];
  description?: string;
}

export async function toolPromote(args: PromoteArgs): Promise<string> {
  const config = await getConfig();
  const result = await promoteTask(config, {
    file: args.file,
    line: args.line,
    name: args.name,
    area: args.area,
    status: args.status,
    tags: args.tags,
    description: args.description,
  });

  const absPath = `${config.vaultPath}/${result.projectFile}`;
  const lines = [
    `✓ Promoted task to project: "${result.projectName}"`,
    `  Task: ${result.task}`,
    `  Project file: ${absPath}`,
  ];
  if (result.hadThread) {
    lines.push("  Thread: preserved");
  }

  return lines.join("\n");
}

// ─── Export for testing ──────────────────────────────────────

/**
 * Override the cached config (for testing).
 */
export function _setConfig(config: SiftConfig): void {
  _config = config;
}

/**
 * Clear the cached config (for testing).
 */
export function _clearConfig(): void {
  _config = null;
}
