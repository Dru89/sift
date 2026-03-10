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
  findTasks,
  listProjects,
  createProject,
  localToday,
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
  .description("Add a new task to today's daily note (or to a project)")
  .option("-p, --priority <level>", "Priority: highest, high, low, lowest")
  .option("-d, --due <date>", "Due date (YYYY-MM-DD)")
  .option("-s, --scheduled <date>", "Scheduled date (YYYY-MM-DD)")
  .option("--start <date>", "Start date (YYYY-MM-DD)")
  .option("-r, --recurrence <rule>", "Recurrence rule (e.g., 'every week')")
  .option("--project <name>", "Add task to a project instead of daily note")
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
      project: opts.project,
    });

    const target = opts.project
      ? `project "${opts.project}"`
      : "today's daily note";
    console.log(chalk.green("✓") + ` Added task to ${target}:`);
    console.log("  " + taskLine);
  });

// ─── sift find ───────────────────────────────────────────────
program
  .command("find <search...>")
  .description("Search for open tasks without modifying them")
  .option("--show-file", "Show file path for each task")
  .action(async (searchParts: string[], opts) => {
    const config = await resolveConfig();
    const search = searchParts.join(" ");
    const matches = await findTasks(config, search);

    if (matches.length === 0) {
      console.log(chalk.yellow("No open tasks matching: ") + search);
      return;
    }

    console.log(
      formatTaskList(
        sortByUrgency(matches),
        `Found ${matches.length} task${matches.length === 1 ? "" : "s"}`,
        { showFile: opts.showFile ?? true },
      ),
    );
  });

// ─── sift done ───────────────────────────────────────────────
program
  .command("done [search...]")
  .description("Mark a task as complete (by search or by file:line)")
  .option("--file <path>", "File path (relative to vault root) for precise completion")
  .option("--line <number>", "Line number for precise completion")
  .action(async (searchParts: string[], opts) => {
    const config = await resolveConfig();

    // Precise mode: --file and --line
    if (opts.file && opts.line) {
      const lineNum = parseInt(opts.line, 10);
      if (isNaN(lineNum) || lineNum < 1) {
        console.error(chalk.red("Invalid line number: ") + opts.line);
        process.exit(1);
      }

      try {
        const description = await completeTask(config, opts.file, lineNum);
        console.log(chalk.green("✓") + " Completed: " + description);
      } catch (err: any) {
        console.error(chalk.red("Error: ") + err.message);
        process.exit(1);
      }
      return;
    }

    // Search mode: fuzzy match by description
    if (!searchParts || searchParts.length === 0) {
      console.error(chalk.red("Provide a search term, or use --file and --line for precise completion."));
      process.exit(1);
    }

    const search = searchParts.join(" ");
    const matches = await findTasks(config, search);

    if (matches.length === 0) {
      console.log(chalk.yellow("No open tasks matching: ") + search);
      return;
    }

    if (matches.length > 1) {
      console.log(chalk.yellow(`Found ${matches.length} matching tasks:`));
      for (const task of matches) {
        console.log("  " + formatTask(task, { showFile: true }));
      }
      console.log(chalk.dim("\nBe more specific, or use --file and --line for precise completion."));
      return;
    }

    const task = matches[0];
    await completeTask(config, task);
    console.log(chalk.green("✓") + " Completed: " + task.description);
  });

// ─── sift find ───────────────────────────────────────────────
// (see above, before done)

// ─── sift projects ───────────────────────────────────────────
program
  .command("projects")
  .description("List projects in the vault")
  .action(async () => {
    const config = await resolveConfig();
    const projects = await listProjects(config);

    if (projects.length === 0) {
      console.log(chalk.dim("No projects found in ") + config.projectsPath);
      return;
    }

    console.log(chalk.bold("Projects"));
    for (const project of projects) {
      const parts: string[] = [chalk.white(project.name)];
      if (project.status) {
        parts.push(chalk.dim(`(${project.status})`));
      }
      if (project.timeframe) {
        parts.push(chalk.dim(`[${project.timeframe}]`));
      }
      if (project.tags && project.tags.length > 0) {
        parts.push(chalk.cyan(project.tags.map((t) => `#${t}`).join(" ")));
      }
      console.log("  " + parts.join("  "));
    }
  });

// ─── sift project create ────────────────────────────────────
const projectCmd = program
  .command("project")
  .description("Manage projects");

projectCmd
  .command("create <name...>")
  .description("Create a new project from template")
  .action(async (nameParts: string[]) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");

    try {
      const filePath = await createProject(config, name);
      console.log(chalk.green("✓") + ` Created project "${name}"`);
      console.log(chalk.dim("  File: ") + filePath);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift init ───────────────────────────────────────────────
program
  .command("init")
  .description("Set up sift configuration")
  .argument("<vault-path>", "Path to your Obsidian vault")
  .option("--daily-notes <path>", "Daily notes folder (relative to vault)", "Daily Notes")
  .option("--projects <path>", "Projects folder (relative to vault)", "Projects")
  .option("--project-template <path>", "Project template file (relative to vault)", "Templates/Project.md")
  .option("--exclude <folders...>", "Folders to exclude from scanning")
  .action(async (vaultPath: string, opts) => {
    const config: SiftConfig = {
      vaultPath: vaultPath.startsWith("/") ? vaultPath : path.resolve(vaultPath),
      dailyNotesPath: opts.dailyNotes,
      dailyNotesFormat: "YYYY-MM-DD",
      excludeFolders: opts.exclude || ["Templates", "Attachments"],
      projectsPath: opts.projects,
      projectTemplatePath: opts.projectTemplate,
    };

    const configPath = await writeConfig(config);
    console.log(chalk.green("✓") + ` Configuration written to ${configPath}`);
    console.log(chalk.dim("  Vault: ") + config.vaultPath);
    console.log(chalk.dim("  Daily notes: ") + config.dailyNotesPath);
    console.log(chalk.dim("  Projects: ") + config.projectsPath);
    console.log(chalk.dim("  Excluded: ") + config.excludeFolders.join(", "));
  });

// ─── sift summary ────────────────────────────────────────────
program
  .command("summary")
  .description("Quick overview of your task status")
  .action(async () => {
    const config = await resolveConfig();
    const today = localToday();

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

    // Show CWD project context if configured
    if (config.project) {
      console.log();
      console.log(chalk.dim(`📁 CWD project: ${config.project}`));
    }
  });

program.parse();
