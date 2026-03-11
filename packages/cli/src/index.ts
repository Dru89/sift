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
  getReviewSummary,
  sortByUrgency,
  addTask,
  addNote,
  completeTask,
  findTasks,
  markTaskStatus,
  listProjects,
  findProject,
  createProject,
  setProjectField,
  localToday,
  addDays,
  previousDayOfWeek,
  type Priority,
  type TaskStatus,
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

// ─── sift note ───────────────────────────────────────────────
program
  .command("note <content...>")
  .description("Add a note to today's daily note or to a project")
  .option("--project <name>", "Add note to a project instead of daily note")
  .option("--heading <heading>", "Target heading (default: '## Journal' for daily, '## Notes' for projects)")
  .option("--changelog-summary <summary>", "Explicit changelog entry summary (auto-generated if omitted)")
  .action(async (contentParts: string[], opts) => {
    const config = await resolveConfig();
    const content = contentParts.join(" ");

    try {
      await addNote(config, {
        content,
        project: opts.project,
        heading: opts.heading,
        changelogSummary: opts.changelogSummary,
      });

      const target = opts.project
        ? `project "${opts.project}"`
        : "today's daily note";
      const heading = opts.heading || (opts.project ? "## Notes" : "## Journal");
      console.log(chalk.green("✓") + ` Added note to ${target} under ${heading}`);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift projects ───────────────────────────────────────────
program
  .command("projects")
  .description("List projects in the vault")
  .option("--tag <tag>", "Filter to projects with this tag")
  .action(async (opts) => {
    const config = await resolveConfig();
    let projects = await listProjects(config);

    if (opts.tag) {
      const tagLower = opts.tag.toLowerCase();
      projects = projects.filter((p) =>
        p.tags?.some((t) => t.toLowerCase() === tagLower),
      );
    }

    if (projects.length === 0) {
      const msg = opts.tag
        ? `No projects found with tag #${opts.tag}`
        : `No projects found in ${config.projectsPath}`;
      console.log(chalk.dim(msg));
      return;
    }

    console.log(chalk.bold("Projects"));
    for (const project of projects) {
      const effectiveStatus = project.status || "active";
      const inactive = effectiveStatus === "someday" || effectiveStatus === "done";
      const nameStr = inactive ? chalk.dim(project.name) : chalk.white(project.name);
      const parts: string[] = [nameStr];
      if (project.status) {
        parts.push(chalk.dim(`(${project.status})`));
      }
      if (project.timeframe) {
        parts.push(chalk.dim(`[${project.timeframe}]`));
      }
      if (project.tags && project.tags.length > 0) {
        const tagStr = project.tags.map((t) => `#${t}`).join(" ");
        parts.push(inactive ? chalk.dim(tagStr) : chalk.cyan(tagStr));
      }
      if (project.created) {
        parts.push(chalk.dim(project.created));
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

projectCmd
  .command("path <name...>")
  .description("Get the vault-relative file path for a project")
  .option("--absolute", "Return the absolute path instead of vault-relative")
  .action(async (nameParts: string[], opts) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");
    const project = await findProject(config, name);

    if (!project) {
      console.error(chalk.red(`Project "${name}" not found.`));
      process.exit(1);
    }

    if (opts.absolute) {
      console.log(path.join(config.vaultPath, project.filePath));
    } else {
      console.log(project.filePath);
    }
  });

// ─── sift project set ────────────────────────────────────────
projectCmd
  .command("set <name...>")
  .description("Update project frontmatter fields")
  .option("--status <status>", "Set project status (active, planning, someday, done)")
  .option("--timeframe <timeframe>", "Set project timeframe")
  .option("--tags <tags...>", "Set project tags (space-separated, replaces existing tags)")
  .action(async (nameParts: string[], opts) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");

    const hasChanges = opts.status || opts.timeframe || opts.tags;
    if (!hasChanges) {
      console.error(chalk.red("Error: ") + "Specify at least one field to set (e.g. --status active)");
      process.exit(1);
    }

    try {
      if (opts.status) await setProjectField(config, name, "status", opts.status);
      if (opts.timeframe) await setProjectField(config, name, "timeframe", opts.timeframe);
      if (opts.tags) await setProjectField(config, name, "tags", opts.tags as string[]);

      console.log(chalk.green("✓") + ` Updated project "${name}"`);
      if (opts.status) console.log(chalk.dim("  status: ") + opts.status);
      if (opts.timeframe) console.log(chalk.dim("  timeframe: ") + opts.timeframe);
      if (opts.tags) console.log(chalk.dim("  tags: ") + (opts.tags as string[]).map((t: string) => `#${t}`).join(" "));
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift mark ───────────────────────────────────────────────
program
  .command("mark [search...]")
  .description("Mark a task with a status (in_progress, on_hold, moved, cancelled, open, done)")
  .option("--status <status>", "New status: open, in_progress, on_hold, moved, cancelled, done")
  .option("--file <path>", "File path (relative to vault root) for precise targeting")
  .option("--line <number>", "Line number for precise targeting")
  .action(async (searchParts: string[], opts) => {
    const config = await resolveConfig();

    if (!opts.status) {
      console.error(chalk.red("Error: ") + "Provide --status (open, in_progress, on_hold, moved, cancelled, done)");
      process.exit(1);
    }

    const validStatuses = ["open", "in_progress", "on_hold", "moved", "cancelled", "done"];
    if (!validStatuses.includes(opts.status)) {
      console.error(chalk.red("Invalid status: ") + opts.status);
      console.error(chalk.dim("Valid values: " + validStatuses.join(", ")));
      process.exit(1);
    }

    const newStatus = opts.status as TaskStatus;

    // Precise mode: --file and --line
    if (opts.file && opts.line) {
      const lineNum = parseInt(opts.line, 10);
      if (isNaN(lineNum) || lineNum < 1) {
        console.error(chalk.red("Invalid line number: ") + opts.line);
        process.exit(1);
      }

      try {
        const description = await markTaskStatus(config, opts.file, lineNum, newStatus);
        console.log(chalk.green("✓") + ` Marked as ${newStatus}: ` + description);
      } catch (err: any) {
        console.error(chalk.red("Error: ") + err.message);
        process.exit(1);
      }
      return;
    }

    // Search mode
    if (!searchParts || searchParts.length === 0) {
      console.error(chalk.red("Provide a search term, or use --file and --line for precise targeting."));
      process.exit(1);
    }

    const search = searchParts.join(" ");
    const matches = await findTasks(config, search);

    if (matches.length === 0) {
      console.log(chalk.yellow("No actionable tasks matching: ") + search);
      return;
    }

    if (matches.length > 1) {
      console.log(chalk.yellow(`Found ${matches.length} matching tasks:`));
      for (const task of matches) {
        console.log("  " + formatTask(task, { showFile: true }));
      }
      console.log(chalk.dim("\nBe more specific, or use --file and --line for precise targeting."));
      return;
    }

    const task = matches[0];
    await markTaskStatus(config, task.filePath, task.line, newStatus);
    console.log(chalk.green("✓") + ` Marked as ${newStatus}: ` + task.description);
  });

// ─── sift review ─────────────────────────────────────────────
program
  .command("review")
  .description("Review summary: completed, created, stale, changelog, and upcoming")
  .option("--since <date>", "Start of review period (YYYY-MM-DD, default: last Friday)")
  .option("--until <date>", "End of review period (YYYY-MM-DD, default: today)")
  .option("--days <number>", "Review the last N days (alternative to --since)")
  .action(async (opts) => {
    const config = await resolveConfig();
    const today = localToday();

    let since: string | undefined = opts.since;
    const until: string | undefined = opts.until;

    if (opts.days) {
      const days = parseInt(opts.days, 10);
      if (isNaN(days) || days < 1) {
        console.error(chalk.red("Invalid --days value: ") + opts.days);
        process.exit(1);
      }
      since = addDays(until || today, -(days - 1));
    }

    const review = await getReviewSummary(config, since, until);

    console.log(chalk.bold("📋 Review: ") + chalk.dim(`${review.since} → ${review.until}`));
    console.log();

    // Completed
    if (review.completed.length > 0) {
      console.log(chalk.bold.green(`✅ Completed (${review.completed.length})`));
      for (const task of review.completed) {
        const parts = [chalk.green("  ✓"), task.description];
        if (task.done) parts.push(chalk.dim(task.done));
        parts.push(chalk.dim(`[${task.filePath}]`));
        console.log(parts.join("  "));
      }
      console.log();
    } else {
      console.log(chalk.dim("✅ No tasks completed in this period."));
      console.log();
    }

    // Created (still open)
    if (review.created.length > 0) {
      console.log(chalk.bold.cyan(`➕ Created & still open (${review.created.length})`));
      for (const task of review.created) {
        console.log("  " + formatTask(task, { showFile: true }));
      }
      console.log();
    }

    // Changelog (notes added to projects)
    if (review.changelog.length > 0) {
      console.log(chalk.bold.magenta(`📝 Project notes (${review.changelog.length})`));
      for (const entry of review.changelog) {
        console.log(`  ${chalk.dim(entry.date)}  ${chalk.white(entry.project)}  ${entry.summary}`);
      }
      console.log();
    }

    // New vault files (meetings, weblinks, etc.)
    if (review.newFiles.length > 0) {
      // Group by category
      const byCategory = new Map<string, typeof review.newFiles>();
      for (const file of review.newFiles) {
        const group = byCategory.get(file.category) ?? [];
        group.push(file);
        byCategory.set(file.category, group);
      }
      console.log(chalk.bold.blue(`📄 New notes (${review.newFiles.length})`));
      for (const [category, files] of byCategory) {
        console.log(`  ${chalk.dim(category)}  ${chalk.dim(`(${files.length})`)}`);
        for (const file of files) {
          console.log(`    ${chalk.dim(file.date)}  ${file.name}`);
        }
      }
      console.log();
    }

    // Deferred (moved or on_hold during the period)
    if (review.deferred.length > 0) {
      console.log(chalk.bold.yellow(`⏸  Deferred (${review.deferred.length})`));
      for (const task of review.deferred) {
        const statusLabel = task.status === "on_hold" ? "on hold" : "moved";
        console.log("  " + formatTask(task, { showFile: true }) + chalk.dim(`  [${statusLabel}]`));
      }
      console.log();
    }

    // Stale
    if (review.stale.length > 0) {
      console.log(chalk.bold.yellow(`⚠️  Stale — no due date, no schedule (${review.stale.length})`));
      for (const task of review.stale.slice(0, 10)) {
        const parts = ["  " + chalk.dim("○"), task.description];
        if (task.created) parts.push(chalk.dim(`created ${task.created}`));
        parts.push(chalk.dim(`[${task.filePath}]`));
        console.log(parts.join("  "));
      }
      if (review.stale.length > 10) {
        console.log(chalk.dim(`  ... and ${review.stale.length - 10} more`));
      }
      console.log();
    }

    // Upcoming
    if (review.upcoming.length > 0) {
      console.log(chalk.bold(`📅 Coming up (next 7 days)`));
      for (const task of review.upcoming) {
        console.log("  " + formatTask(task));
      }
      console.log();
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
    const actionableTasks = allTasks.filter((t) => t.status === "open" || t.status === "in_progress");
    const inProgressTasks = allTasks.filter((t) => t.status === "in_progress");
    const openTasks = allTasks.filter((t) => t.status === "open");
    const overdue = actionableTasks.filter((t) => t.due !== null && t.due < today);
    const dueToday = actionableTasks.filter((t) => t.due === today);
    const highPriority = actionableTasks.filter((t) => t.priority === "highest" || t.priority === "high");

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

    if (inProgressTasks.length > 0) {
      console.log(formatTaskList(sortByUrgency(inProgressTasks), "◐ In Progress"));
      console.log();
    }

    if (highPriority.length > 0) {
      console.log(formatTaskList(sortByUrgency(highPriority).slice(0, 5), "⏫ High Priority"));
      console.log();
    }

    const next = sortByUrgency(openTasks).slice(0, 5);
    console.log(formatTaskList(next, "👉 Up Next"));

    // Projects section
    const projects = await listProjects(config);
    if (projects.length > 0) {
      console.log();
      const activeStatuses = new Set(["active", "planning"]);
      const active = projects.filter((p) => activeStatuses.has(p.status || "active"));
      const inactive = projects.filter((p) => !activeStatuses.has(p.status || "active"));

      const countStr = [
        chalk.white(`${active.length} active`),
        inactive.length > 0 ? chalk.dim(`${inactive.length} inactive`) : "",
      ].filter(Boolean).join(chalk.dim("  ·  "));

      console.log(chalk.bold("📁 Projects") + "  " + countStr);
      for (const project of active) {
        const status = project.status ? chalk.dim(` (${project.status})`) : "";
        const tags = project.tags?.length ? chalk.dim("  " + project.tags.map((t) => `#${t}`).join(" ")) : "";
        console.log("  " + chalk.white(project.name) + status + tags);
      }
      for (const project of inactive) {
        const status = project.status ? chalk.dim(` (${project.status})`) : "";
        console.log("  " + chalk.dim(project.name + status));
      }
    }

    // Show CWD project context if configured
    if (config.project) {
      console.log();
      console.log(chalk.dim(`📁 CWD project: ${config.project}`));
    }
  });

program.parse();
