#!/usr/bin/env node

import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import {
  resolveConfig,
  writeConfig,
  scanTasks,
  getNextTasks,
  getOverdueTasks,
  getDueToday,
  sortByUrgency,
  addTask,
  completeTask,
  type Priority,
  type SiftConfig,
} from "@sift/core";
import { formatTask, formatTaskList, formatSummary } from "./format.js";

const program = new Command();

program
  .name("sift")
  .description("Surface tasks from your Obsidian vault")
  .version("0.1.0");

// ─── sift list ───────────────────────────────────────────────
program
  .command("list")
  .alias("ls")
  .description("List all open tasks")
  .option("-a, --all", "Include completed and cancelled tasks")
  .option("-f, --file <pattern>", "Filter by file path pattern")
  .option("-s, --search <text>", "Search task descriptions")
  .option("-p, --priority <level>", "Minimum priority: highest, high, low")
  .option("--due-before <date>", "Tasks due on or before date (YYYY-MM-DD)")
  .option("--show-file", "Show file path for each task")
  .action(async (opts) => {
    const config = await resolveConfig();
    const tasks = await scanTasks(config, {
      status: opts.all ? undefined : "open",
      search: opts.search,
      minPriority: opts.priority as Priority | undefined,
      dueBefore: opts.dueBefore,
    });

    const sorted = sortByUrgency(tasks);
    console.log(formatTaskList(sorted, "Tasks", { showFile: opts.showFile }));
    console.log();
    console.log(formatSummary(await scanTasks(config)));
  });

// ─── sift next ───────────────────────────────────────────────
program
  .command("next")
  .description("Show the most important tasks to work on now")
  .option("-n, --count <number>", "Number of tasks to show", "10")
  .option("--show-file", "Show file path for each task")
  .action(async (opts) => {
    const config = await resolveConfig();
    const count = parseInt(opts.count, 10);
    const tasks = await getNextTasks(config, count);

    console.log(formatTaskList(tasks, `Next ${count} tasks`, { showFile: opts.showFile }));
  });

// ─── sift overdue ────────────────────────────────────────────
program
  .command("overdue")
  .description("Show overdue tasks")
  .option("--show-file", "Show file path for each task")
  .action(async (opts) => {
    const config = await resolveConfig();
    const tasks = await getOverdueTasks(config);

    console.log(formatTaskList(tasks, "Overdue", { showFile: opts.showFile }));
  });

// ─── sift today ──────────────────────────────────────────────
program
  .command("today")
  .description("Show tasks due today")
  .option("--show-file", "Show file path for each task")
  .action(async (opts) => {
    const config = await resolveConfig();
    const tasks = await getDueToday(config);

    console.log(formatTaskList(tasks, "Due Today", { showFile: opts.showFile }));
  });

// ─── sift add ────────────────────────────────────────────────
program
  .command("add <description...>")
  .description("Add a new task to today's daily note")
  .option("-p, --priority <level>", "Priority: highest, high, low, lowest")
  .option("-d, --due <date>", "Due date (YYYY-MM-DD)")
  .option("-s, --scheduled <date>", "Scheduled date (YYYY-MM-DD)")
  .option("--start <date>", "Start date (YYYY-MM-DD)")
  .option("-r, --recurrence <rule>", "Recurrence rule (e.g., 'every week')")
  .action(async (descriptionParts: string[], opts) => {
    const config = await resolveConfig();
    const description = descriptionParts.join(" ");

    const taskLine = await addTask(config, {
      description,
      priority: opts.priority as Priority | undefined,
      due: opts.due,
      scheduled: opts.scheduled,
      start: opts.start,
      recurrence: opts.recurrence,
    });

    console.log(chalk.green("✓") + " Added task to today's daily note:");
    console.log("  " + taskLine);
  });

// ─── sift done ───────────────────────────────────────────────
program
  .command("done <search...>")
  .description("Mark a task as complete (fuzzy matches by description)")
  .action(async (searchParts: string[]) => {
    const config = await resolveConfig();
    const search = searchParts.join(" ").toLowerCase();

    const tasks = await scanTasks(config, { status: "open" });
    const matches = tasks.filter((t) =>
      t.description.toLowerCase().includes(search),
    );

    if (matches.length === 0) {
      console.log(chalk.yellow("No open tasks matching: ") + search);
      return;
    }

    if (matches.length > 1) {
      console.log(chalk.yellow(`Found ${matches.length} matching tasks:`));
      for (const task of matches) {
        console.log("  " + formatTask(task, { showFile: true }));
      }
      console.log(chalk.dim("\nBe more specific to match a single task."));
      return;
    }

    const task = matches[0];
    await completeTask(config, task);
    console.log(chalk.green("✓") + " Completed: " + task.description);
  });

// ─── sift init ───────────────────────────────────────────────
program
  .command("init")
  .description("Set up sift configuration")
  .argument("<vault-path>", "Path to your Obsidian vault")
  .option("--daily-notes <path>", "Daily notes folder (relative to vault)", "Daily Notes")
  .option("--exclude <folders...>", "Folders to exclude from scanning")
  .action(async (vaultPath: string, opts) => {
    const config: SiftConfig = {
      vaultPath: vaultPath.startsWith("/") ? vaultPath : path.resolve(vaultPath),
      dailyNotesPath: opts.dailyNotes,
      dailyNotesFormat: "YYYY-MM-DD",
      excludeFolders: opts.exclude || ["Templates", "Attachments"],
    };

    const configPath = await writeConfig(config);
    console.log(chalk.green("✓") + ` Configuration written to ${configPath}`);
    console.log(chalk.dim("  Vault: ") + config.vaultPath);
    console.log(chalk.dim("  Daily notes: ") + config.dailyNotesPath);
    console.log(chalk.dim("  Excluded: ") + config.excludeFolders.join(", "));
  });

// ─── sift summary ────────────────────────────────────────────
program
  .command("summary")
  .description("Quick overview of your task status")
  .action(async () => {
    const config = await resolveConfig();
    const today = new Date().toISOString().slice(0, 10);

    const allTasks = await scanTasks(config);
    const openTasks = allTasks.filter((t) => t.status === "open");
    const overdue = openTasks.filter((t) => t.due !== null && t.due < today);
    const dueToday = openTasks.filter((t) => t.due === today);
    const highPriority = openTasks.filter((t) => t.priority === "highest" || t.priority === "high");

    console.log(chalk.bold("📋 Sift Summary"));
    console.log();
    console.log(formatSummary(allTasks));
    console.log();

    if (overdue.length > 0) {
      console.log(formatTaskList(sortByUrgency(overdue), "🔴 Overdue"));
      console.log();
    }

    if (dueToday.length > 0) {
      console.log(formatTaskList(sortByUrgency(dueToday), "📅 Due Today"));
      console.log();
    }

    if (highPriority.length > 0) {
      console.log(formatTaskList(sortByUrgency(highPriority).slice(0, 5), "⏫ High Priority"));
      console.log();
    }

    const next = sortByUrgency(openTasks).slice(0, 5);
    console.log(formatTaskList(next, "👉 Up Next"));
  });

program.parse();
