import chalk from "chalk";
import { localToday, type Task, type Priority } from "@sift/core";

/**
 * Priority display configuration: label, color, and sort indicator.
 */
const PRIORITY_DISPLAY: Record<Priority, { label: string; color: (s: string) => string }> = {
  highest: { label: "⏫", color: chalk.red },
  high: { label: "🔼", color: chalk.yellow },
  medium: { label: "🔸", color: chalk.blue },
  none: { label: " ", color: chalk.white },
  low: { label: "🔽", color: chalk.gray },
  lowest: { label: "⏬", color: chalk.dim },
};

/**
 * Format a single task for terminal display.
 */
export function formatTask(task: Task, options?: { showFile?: boolean }): string {
  const priority = PRIORITY_DISPLAY[task.priority];
  const statusIcon =
    task.status === "done" ? chalk.green("✓") :
    task.status === "cancelled" ? chalk.red("✗") :
    task.status === "in_progress" ? chalk.cyan("◐") :
    task.status === "on_hold" ? chalk.yellow("⏸") :
    task.status === "moved" ? chalk.dim("→") :
    chalk.dim("○");

  let line = `${statusIcon} ${priority.label} ${priority.color(task.description)}`;

  // Add date info
  const dateParts: string[] = [];
  if (task.due) {
    const isOverdue = task.due < localToday();
    const dueStr = isOverdue ? chalk.red(`due ${task.due}`) : chalk.cyan(`due ${task.due}`);
    dateParts.push(dueStr);
  }
  if (task.scheduled) {
    dateParts.push(chalk.dim(`scheduled ${task.scheduled}`));
  }

  if (dateParts.length > 0) {
    line += "  " + dateParts.join("  ");
  }

  if (options?.showFile) {
    line += "  " + chalk.dim(`[${task.filePath}:${task.line}]`);
  }

  return line;
}

/**
 * Format a list of tasks with a header.
 */
export function formatTaskList(tasks: Task[], header: string, options?: { showFile?: boolean }): string {
  if (tasks.length === 0) {
    return `${chalk.bold(header)}\n${chalk.dim("  No tasks found.")}`;
  }

  const lines = [chalk.bold(header)];
  for (const task of tasks) {
    lines.push("  " + formatTask(task, options));
  }
  return lines.join("\n");
}

/**
 * Format a summary of task counts.
 */
export function formatSummary(tasks: Task[]): string {
  const open = tasks.filter((t) => t.status === "open").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const done = tasks.filter((t) => t.status === "done").length;
  const today = localToday();
  const actionable = (t: Task) => t.status === "open" || t.status === "in_progress";
  const overdue = tasks.filter((t) => actionable(t) && t.due !== null && t.due < today).length;
  const dueToday = tasks.filter((t) => actionable(t) && t.due === today).length;

  const parts: string[] = [
    `${chalk.bold(String(open))} open`,
  ];
  if (inProgress > 0) {
    parts.push(`${chalk.cyan(String(inProgress))} in progress`);
  }
  parts.push(`${chalk.green(String(done))} done`);

  if (overdue > 0) {
    parts.push(`${chalk.red(String(overdue))} overdue`);
  }
  if (dueToday > 0) {
    parts.push(`${chalk.yellow(String(dueToday))} due today`);
  }

  return parts.join("  ·  ");
}
