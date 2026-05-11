#!/usr/bin/env node

import * as path from "node:path";
import { Command } from "commander";
import chalk from "chalk";
import {
  resolveConfig,
  writeConfig,
  scanTasks,
  getNextTasks,
  getAgendaTasks,
  getOverdueTasks,
  getDueToday,
  getReviewSummary,
  getTriageSummary,
  sortByUrgency,
  addTask,
  addNote,
  createSubnote,
  completeTask,
  findTasks,
  markTaskStatus,
  updateTask,
  moveTask,
  promoteTask,
  listProjects,
  findProject,
  createProject,
  createArea,
  setProjectField,
  createThread,
  addThreadEntry,
  updateThreadState,
  localToday,
  addDays,
  previousDayOfWeek,
  ACTIONABLE_STATUSES,
  type Priority,
  type TaskStatus,
  type ThreadState,
  type SiftConfig,
  type Task,
  type TriageSignal,
} from "@sift/core";
import { formatTask, formatTaskList, formatGroupedTaskList, formatSummary, type FormatTaskOptions, type TaskGroup } from "./format.js";

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
  .option("--scheduled-before <date>", "Tasks scheduled on or before date (YYYY-MM-DD)")
  .option("--start-before <date>", "Tasks with start date on or before date (YYYY-MM-DD)")
  .option("--start-after <date>", "Tasks with start date on or after date (YYYY-MM-DD)")
  .option("--project <name>", "Only show tasks from this project's file")
  .option("--group-by-project", "Group tasks by project (applies when --project resolves to an area)")
  .option("--show-file", "Show file path for each task")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
  .action(async (opts) => {
    const config = await resolveConfig();

    // Resolve --project to one or more file patterns.
    // When --project names an area, expand to include all projects linked to it.
    let filePatterns: string[] | undefined = opts.file ? [opts.file] : undefined;
    let expansionItems: Array<{ name: string; filePath: string }> | undefined;

    if (opts.project) {
      const project = await findProject(config, opts.project);
      if (!project) {
        console.error(chalk.red(`Project "${opts.project}" not found.`));
        process.exit(1);
      }
      if (project.kind === "area") {
        const all = await listProjects(config);
        const linked = all.filter(p => p.kind === "project" && p.area === project.name);
        expansionItems = [project, ...linked];
        filePatterns = expansionItems.map(p => p.filePath);
      } else {
        filePatterns = [project.filePath];
      }
    }

    const tasks = await scanTasks(config, {
      status: opts.all ? undefined : ACTIONABLE_STATUSES,
      search: opts.search,
      minPriority: opts.priority as Priority | undefined,
      dueBefore: opts.dueBefore,
      scheduledBefore: opts.scheduledBefore,
      startBefore: opts.startBefore,
      startAfter: opts.startAfter,
      filePatterns,
    });

    const fmtOpts: FormatTaskOptions = {
      showFile: opts.showFile,
      vaultPath: opts.absolute ? config.vaultPath : undefined,
    };

    if (opts.groupByProject && expansionItems && expansionItems.length > 1) {
      const tasksByFile = new Map<string, Task[]>(expansionItems.map(item => [item.filePath, []]));
      for (const task of tasks) {
        tasksByFile.get(task.filePath)?.push(task);
      }
      const groups: TaskGroup[] = expansionItems.map(item => ({
        label: item.name,
        tasks: sortByUrgency(tasksByFile.get(item.filePath) ?? []),
      }));
      console.log(formatGroupedTaskList(groups, fmtOpts));
    } else {
      console.log(formatTaskList(sortByUrgency(tasks), "Tasks", fmtOpts));
    }

    console.log();
    console.log(formatSummary(await scanTasks(config)));
  });

// ─── sift next ───────────────────────────────────────────────
program
  .command("next")
  .description("Show the most important tasks to work on now")
  .option("-n, --count <number>", "Number of tasks to show", "10")
  .option("--show-file", "Show file path for each task")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
  .action(async (opts) => {
    const config = await resolveConfig();
    const count = parseInt(opts.count, 10);
    const tasks = await getNextTasks(config, count);

    const fmtOpts: FormatTaskOptions = {
      showFile: opts.showFile,
      vaultPath: opts.absolute ? config.vaultPath : undefined,
    };
    console.log(formatTaskList(tasks, `Next ${count} tasks`, fmtOpts));
  });

// ─── sift overdue ────────────────────────────────────────────
program
  .command("overdue")
  .description("Show overdue tasks")
  .option("--show-file", "Show file path for each task")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
  .action(async (opts) => {
    const config = await resolveConfig();
    const tasks = await getOverdueTasks(config);

    const fmtOpts: FormatTaskOptions = {
      showFile: opts.showFile,
      vaultPath: opts.absolute ? config.vaultPath : undefined,
    };
    console.log(formatTaskList(tasks, "Overdue", fmtOpts));
  });

// ─── sift today ──────────────────────────────────────────────
program
  .command("today")
  .description("Show tasks due today")
  .option("--show-file", "Show file path for each task")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
  .action(async (opts) => {
    const config = await resolveConfig();
    const tasks = await getDueToday(config);

    const fmtOpts: FormatTaskOptions = {
      showFile: opts.showFile,
      vaultPath: opts.absolute ? config.vaultPath : undefined,
    };
    console.log(formatTaskList(tasks, "Due Today", fmtOpts));
  });

// ─── sift agenda ─────────────────────────────────────────────
program
  .command("agenda")
  .description("Show tasks relevant to today: due, scheduled, in-progress, and overdue")
  .option("--show-file", "Show file path for each task")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
  .action(async (opts) => {
    const config = await resolveConfig();
    const tasks = await getAgendaTasks(config);

    const fmtOpts: FormatTaskOptions = {
      showFile: opts.showFile,
      vaultPath: opts.absolute ? config.vaultPath : undefined,
    };

    if (tasks.length === 0) {
      console.log(chalk.bold("📋 Today's Agenda"));
      console.log(chalk.dim("  Nothing on the agenda today."));
    } else {
      console.log(formatTaskList(tasks, "📋 Today's Agenda", fmtOpts));
    }
  });

// ─── sift open ───────────────────────────────────────────────
program
  .command("open <file...>")
  .description("Open a file in Obsidian")
  .option("--new-tab", "Open in a new tab")
  .action(async (fileParts: string[], opts) => {
    const file = fileParts.join(" ");

    try {
      const { execFileSync } = await import("child_process");
      const isPath = file.includes("/") || file.includes("\\");
      const paramName = isPath ? "path" : "file";
      const cliArgs = ["open", `${paramName}=${file}`];
      if (opts.newTab) cliArgs.push("newtab");

      execFileSync("obsidian", cliArgs, {
        encoding: "utf-8",
        timeout: 15000,
      });
      console.log(chalk.green("✓") + ` Opened "${file}" in Obsidian`);
    } catch (error: any) {
      if (error.message?.includes("ENOENT")) {
        console.error(chalk.red("Error: ") + "Obsidian CLI is not installed. Install it in Obsidian Settings → General → Command line interface.");
      } else if (error.message?.includes("ETIMEDOUT")) {
        console.error(chalk.red("Error: ") + "Obsidian CLI timed out. Make sure Obsidian is running.");
      } else {
        const stderr = error.stderr?.toString()?.trim();
        console.error(chalk.red("Error: ") + (stderr || error.message));
      }
      process.exit(1);
    }
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
  .option("-b, --body <line>", "Body line (sub-bullet or note) below the task. Can be repeated.", (val: string, prev: string[]) => [...prev, val], [] as string[])
  .option("--project <name>", "Add task to a project instead of daily note")
  .option("--date <date>", "Target daily note date (YYYY-MM-DD, default: today)")
  .action(async (descriptionParts: string[], opts) => {
    const config = await resolveConfig();
    const description = descriptionParts.join(" ");

    let result: { taskLine: string; reopened: boolean };
    try {
      result = await addTask(config, {
        description,
        priority: opts.priority as Priority | undefined,
        due: opts.due,
        scheduled: opts.scheduled,
        start: opts.start,
        recurrence: opts.recurrence,
        body: opts.body.length > 0 ? opts.body : undefined,
        project: opts.project,
        date: opts.date,
      });
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }

    const target = opts.project
      ? `project "${opts.project}"`
      : opts.date
        ? `daily note for ${opts.date}`
        : "today's daily note";
    console.log(chalk.green("✓") + ` Added task to ${target}:`);
    console.log("  " + result.taskLine);
    if (result.reopened) {
      console.log(chalk.yellow("  ⚠ Reopened project (was marked done)"));
    }
  });

// ─── sift find ───────────────────────────────────────────────
program
  .command("find <search...>")
  .description("Search for open tasks without modifying them")
  .option("--show-file", "Show file path for each task")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
  .option("-a, --all", "Include completed and cancelled tasks")
  .option("--status <status>", "Filter to a specific status: open, in_progress, done, cancelled, on_hold, moved")
  .action(async (searchParts: string[], opts) => {
    const config = await resolveConfig();
    const search = searchParts.join(" ");

    const validStatuses = ["open", "in_progress", "done", "cancelled", "on_hold", "moved"];
    if (opts.status && !validStatuses.includes(opts.status)) {
      console.error(chalk.red("Invalid status: ") + opts.status);
      console.error(chalk.dim("Valid values: " + validStatuses.join(", ")));
      process.exit(1);
    }

    const matches = await findTasks(config, search, {
      all: opts.all,
      status: opts.status as TaskStatus | undefined,
    });

    if (matches.length === 0) {
      const scope = opts.status ? `${opts.status} tasks` : opts.all ? "tasks" : "open tasks";
      console.log(chalk.yellow(`No ${scope} matching: `) + search);
      return;
    }

    const fmtOpts: FormatTaskOptions = {
      showFile: opts.showFile ?? true,
      vaultPath: opts.absolute ? config.vaultPath : undefined,
      showBody: true,
    };
    console.log(
      formatTaskList(
        sortByUrgency(matches),
        `Found ${matches.length} task${matches.length === 1 ? "" : "s"}`,
        fmtOpts,
      ),
    );
  });

// ─── sift done ───────────────────────────────────────────────
program
  .command("done [search...]")
  .description("Mark a task as complete (by search or by file:line)")
  .option("--file <path>", "File path (relative to vault root, or absolute) for precise completion")
  .option("--line <number>", "Line number for precise completion")
  .option("--description <text>", "Expected task text (safety check against stale line numbers)")
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
        const description = await completeTask(config, opts.file, lineNum, opts.description);
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
    try {
      await completeTask(config, task);
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
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
  .option("--date <date>", "Target daily note date (YYYY-MM-DD, default: today)")
  .action(async (contentParts: string[], opts) => {
    const config = await resolveConfig();
    const content = contentParts.join(" ");

    try {
      await addNote(config, {
        content,
        project: opts.project,
        heading: opts.heading,
        date: opts.date,
      });

      const target = opts.project
        ? `project "${opts.project}"`
        : opts.date
          ? `daily note for ${opts.date}`
          : "today's daily note";
      const heading = opts.heading || (opts.project ? "## Notes" : "## Journal");
      console.log(chalk.green("✓") + ` Added note to ${target} under ${heading}`);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift subnote ─────────────────────────────────────────────
program
  .command("subnote <title...>")
  .description("Create a new note file linked to a project")
  .requiredOption("--project <name>", "Project to link this note to")
  .option("--folder <folder>", "Folder to create the note in (default: Notes)")
  .option("--type <type>", "Frontmatter type field (default: note)")
  .option("--tags <tags...>", "Tags to add to frontmatter")
  .option("--heading <heading>", "Heading in project file to insert link under (default: ## Notes)")
  .option("--absolute", "Show absolute file path in output")
  .option("--content <content>", "Initial content for the subnote")
  .action(async (titleParts: string[], opts) => {
    const config = await resolveConfig();
    const title = titleParts.join(" ");

    try {
      const result = await createSubnote(config, {
        project: opts.project,
        title,
        content: opts.content,
        folder: opts.folder,
        type: opts.type,
        tags: opts.tags,
        heading: opts.heading,
      });

      const displayPath = opts.absolute
        ? path.join(config.vaultPath, result.filePath)
        : result.filePath;
      console.log(chalk.green("✓") + ` Created subnote: ${displayPath}`);
      console.log(chalk.dim(`  Linked from: ${result.project}`));
      console.log(chalk.dim(`  Wiki link: [[${result.linkName}]]`));
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift projects ───────────────────────────────────────────
program
  .command("projects")
  .description("List projects and areas in the vault")
  .option("--tag <tag>", "Filter by tag")
  .option("--kind <kind>", "Filter by kind: project or area")
  .action(async (opts) => {
    const config = await resolveConfig();
    const kindFilter = opts.kind as "project" | "area" | undefined;
    let items = await listProjects(config, kindFilter);

    if (opts.tag) {
      const tagLower = opts.tag.toLowerCase();
      items = items.filter((p) =>
        p.tags?.some((t) => t.toLowerCase() === tagLower),
      );
    }

    if (items.length === 0) {
      const msg = opts.tag
        ? `No items found with tag #${opts.tag}`
        : opts.kind
          ? `No ${opts.kind}s found`
          : `No projects or areas found`;
      console.log(chalk.dim(msg));
      return;
    }

    // Group by kind
    const areas = items.filter((p) => p.kind === "area");
    const projects = items.filter((p) => p.kind === "project");

    if (areas.length > 0 && !kindFilter) {
      console.log(chalk.bold("Areas"));
      for (const area of areas) {
        const parts: string[] = [chalk.white(area.name)];
        if (area.tags && area.tags.length > 0) {
          parts.push(chalk.cyan(area.tags.map((t) => `#${t}`).join(" ")));
        }
        if (area.created) {
          parts.push(chalk.dim(area.created));
        }
        console.log("  " + parts.join("  "));
      }
      if (projects.length > 0) console.log();
    }

    if (projects.length > 0) {
      if (!kindFilter) console.log(chalk.bold("Projects"));
      for (const project of projects) {
        const effectiveStatus = project.status || "active";
        const inactive = effectiveStatus === "someday" || effectiveStatus === "done";
        const nameStr = inactive ? chalk.dim(project.name) : chalk.white(project.name);
        const parts: string[] = [nameStr];
        if (project.status) {
          parts.push(chalk.dim(`(${project.status})`));
        }
        if (project.area) {
          parts.push(chalk.dim(`→ ${project.area}`));
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
    }
  });

// ─── sift project create ────────────────────────────────────
const projectCmd = program
  .command("project")
  .description("Manage projects");

projectCmd
  .command("create <name...>")
  .description("Create a new project from template")
  .option("--absolute", "Show absolute file path instead of vault-relative")
  .option("--status <status>", "Initial project status")
  .option("--area <area>", "Parent area name")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--content <content>", "Initial overview content")
  .option("--frontmatter <json>", "Additional frontmatter as JSON")
  .action(async (nameParts: string[], opts) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");

    try {
      const filePath = await createProject(config, name, {
        status: opts.status,
        area: opts.area,
        tags: opts.tags ? (opts.tags as string).split(",").map((t: string) => t.trim()) : undefined,
        content: opts.content,
        frontmatter: opts.frontmatter ? JSON.parse(opts.frontmatter) : undefined,
      });
      const displayPath = opts.absolute ? path.join(config.vaultPath, filePath) : filePath;
      console.log(chalk.green("✓") + ` Created project "${name}"`);
      console.log(chalk.dim("  File: ") + displayPath);
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
  .option("--review-interval <days>", "Set review interval in days (overrides the per-status default)")
  .action(async (nameParts: string[], opts) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");

    const hasChanges = opts.status || opts.timeframe || opts.tags || opts.reviewInterval;
    if (!hasChanges) {
      console.error(chalk.red("Error: ") + "Specify at least one field to set (e.g. --status active)");
      process.exit(1);
    }

    if (opts.reviewInterval) {
      const parsed = parseInt(opts.reviewInterval, 10);
      if (isNaN(parsed) || parsed < 1) {
        console.error(chalk.red("Invalid --review-interval: ") + opts.reviewInterval + chalk.dim(" (must be a positive integer)"));
        process.exit(1);
      }
    }

    try {
      if (opts.status) await setProjectField(config, name, "status", opts.status);
      if (opts.timeframe) await setProjectField(config, name, "timeframe", opts.timeframe);
      if (opts.tags) await setProjectField(config, name, "tags", opts.tags as string[]);
      if (opts.reviewInterval) await setProjectField(config, name, "reviewInterval", opts.reviewInterval);

      console.log(chalk.green("✓") + ` Updated project "${name}"`);
      if (opts.status) console.log(chalk.dim("  status: ") + opts.status);
      if (opts.timeframe) console.log(chalk.dim("  timeframe: ") + opts.timeframe);
      if (opts.tags) console.log(chalk.dim("  tags: ") + (opts.tags as string[]).map((t: string) => `#${t}`).join(" "));
      if (opts.reviewInterval) console.log(chalk.dim("  reviewInterval: ") + opts.reviewInterval + " days");

      // Warn about open tasks when closing a project
      if (opts.status === "done") {
        const project = await findProject(config, name);
        if (project) {
          const openTasks = await scanTasks(config, {
            status: ACTIONABLE_STATUSES,
            filePatterns: [project.filePath],
          });
          if (openTasks.length > 0) {
            console.log();
            console.log(chalk.yellow(`  ⚠ This project has ${openTasks.length} open task${openTasks.length > 1 ? "s" : ""}:`));
            for (const task of openTasks) {
              console.log("    " + formatTask(task, { showFile: true }));
            }
            console.log(chalk.dim("  Consider cancelling, completing, or moving these tasks."));
          }
        }
      }
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift project review ────────────────────────────────────
projectCmd
  .command("review <name...>")
  .description("Mark a project as reviewed (stamps lastReviewed: today in frontmatter)")
  .action(async (nameParts: string[]) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");
    const today = localToday();

    try {
      await setProjectField(config, name, "lastReviewed", today);
      console.log(chalk.green("✓") + ` Marked "${name}" as reviewed (${today})`);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift area ──────────────────────────────────────────────
const areaCmd = program
  .command("area")
  .description("Manage areas");

areaCmd
  .command("create <name...>")
  .description("Create a new area from template")
  .option("--absolute", "Show absolute file path instead of vault-relative")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--content <content>", "Initial overview content")
  .option("--frontmatter <json>", "Additional frontmatter as JSON")
  .action(async (nameParts: string[], opts) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");

    try {
      const filePath = await createArea(config, name, {
        tags: opts.tags ? (opts.tags as string).split(",").map((t: string) => t.trim()) : undefined,
        content: opts.content,
        frontmatter: opts.frontmatter ? JSON.parse(opts.frontmatter) : undefined,
      });
      const displayPath = opts.absolute ? path.join(config.vaultPath, filePath) : filePath;
      console.log(chalk.green("✓") + ` Created area "${name}"`);
      console.log(chalk.dim("  File: ") + displayPath);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

areaCmd
  .command("path <name...>")
  .description("Get the vault-relative file path for an area")
  .option("--absolute", "Return the absolute path instead of vault-relative")
  .action(async (nameParts: string[], opts) => {
    const config = await resolveConfig();
    const name = nameParts.join(" ");
    const area = await findProject(config, name);

    if (!area || area.kind !== "area") {
      console.error(chalk.red(`Area "${name}" not found.`));
      process.exit(1);
    }

    if (opts.absolute) {
      console.log(path.join(config.vaultPath, area.filePath));
    } else {
      console.log(area.filePath);
    }
  });

// ─── sift mark ───────────────────────────────────────────────
program
  .command("mark [search...]")
  .description("Mark a task with a status (in_progress, on_hold, moved, cancelled, open, done)")
  .option("--status <status>", "New status: open, in_progress, on_hold, moved, cancelled, done")
  .option("--file <path>", "File path (relative to vault root, or absolute) for precise targeting")
  .option("--line <number>", "Line number for precise targeting")
  .option("--description <text>", "Expected task text (safety check against stale line numbers)")
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
        const description = await markTaskStatus(config, opts.file, lineNum, newStatus, opts.description);
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
    try {
      await markTaskStatus(config, task.filePath, task.line, newStatus);
    } catch (err: any) {
      console.error(chalk.red("Error:"), err.message);
      process.exit(1);
    }
    console.log(chalk.green("✓") + ` Marked as ${newStatus}: ` + task.description);
  });

// ─── sift update ─────────────────────────────────────────────
program
  .command("update")
  .description("Update a task's metadata (dates, priority) in place")
  .requiredOption("--file <path>", "File path (relative to vault root, or absolute)")
  .requiredOption("--line <number>", "Line number (1-indexed)")
  .option("--description <text>", "Expected task text (safety check against stale line numbers)")
  .option("--priority <level>", "New priority: highest, high, low, lowest, none")
  .option("--due <date>", "New due date (YYYY-MM-DD), or 'none' to remove")
  .option("--scheduled <date>", "New scheduled date (YYYY-MM-DD), or 'none' to remove")
  .option("--start <date>", "New start date (YYYY-MM-DD), or 'none' to remove")
  .action(async (opts) => {
    const config = await resolveConfig();

    const lineNum = parseInt(opts.line, 10);
    if (isNaN(lineNum) || lineNum < 1) {
      console.error(chalk.red("Invalid line number: ") + opts.line);
      process.exit(1);
    }

    const hasUpdate = opts.priority || opts.due || opts.scheduled || opts.start;
    if (!hasUpdate) {
      console.error(chalk.red("Error: ") + "Specify at least one field to update (--priority, --due, --scheduled, --start)");
      process.exit(1);
    }

    try {
      const result = await updateTask(config, {
        file: opts.file,
        line: lineNum,
        description: opts.description,
        priority: opts.priority as Priority | undefined,
        due: opts.due,
        scheduled: opts.scheduled,
        start: opts.start,
      });

      console.log(chalk.green("✓") + ` Updated: ${result.description}`);
      console.log("  " + result.updatedLine);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift move ───────────────────────────────────────────────
program
  .command("move")
  .description("Move a task from one file to another")
  .requiredOption("--file <path>", "Source file path (relative to vault root, or absolute)")
  .requiredOption("--line <number>", "Source line number (1-indexed)")
  .option("--description <text>", "Expected task text (safety check against stale line numbers)")
  .option("--project <name>", "Destination project or area name (inserts under ## Tasks)")
  .option("--date <date>", "Destination daily note date YYYY-MM-DD (inserts under ## Journal)")
  .action(async (opts) => {
    const config = await resolveConfig();

    const lineNum = parseInt(opts.line, 10);
    if (isNaN(lineNum) || lineNum < 1) {
      console.error(chalk.red("Invalid line number: ") + opts.line);
      process.exit(1);
    }

    if (!opts.project && !opts.date) {
      console.error(chalk.red("Error: ") + "Specify a destination: --project <name> or --date <YYYY-MM-DD>");
      process.exit(1);
    }

    if (opts.project && opts.date) {
      console.error(chalk.red("Error: ") + "Specify either --project or --date, not both.");
      process.exit(1);
    }

    try {
      const result = await moveTask(config, {
        file: opts.file,
        line: lineNum,
        description: opts.description,
        project: opts.project,
        date: opts.date,
      });

      console.log(chalk.green("✓") + ` Moved to ${result.destination}: ${result.description}`);
      if (result.reopened) {
        console.log(chalk.yellow("  ⚠ Reopened project (was marked done)"));
      }
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

// ─── sift review ─────────────────────────────────────────────
program
  .command("review")
  .description("Review summary: completed, created, needs triage, changelog, and upcoming")
  .option("--since <date>", "Start of review period (YYYY-MM-DD, default: last Friday)")
  .option("--until <date>", "End of review period (YYYY-MM-DD, default: today)")
  .option("--days <number>", "Review the last N days (alternative to --since)")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
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
    const resolvePath = (p: string) =>
      opts.absolute ? path.join(config.vaultPath, p) : p;

    console.log(chalk.bold("📋 Review: ") + chalk.dim(`${review.since} → ${review.until}`));
    console.log();

    // Completed
    if (review.completed.length > 0) {
      console.log(chalk.bold.green(`✅ Completed (${review.completed.length})`));
      for (const task of review.completed) {
        const parts = [chalk.green("  ✓"), task.description];
        if (task.done) parts.push(chalk.dim(task.done));
        parts.push(chalk.dim(`[${resolvePath(task.filePath)}]`));
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
      const fmtOpts: FormatTaskOptions = {
        showFile: true,
        vaultPath: opts.absolute ? config.vaultPath : undefined,
      };
      for (const task of review.created) {
        console.log("  " + formatTask(task, fmtOpts));
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
      const fmtOpts: FormatTaskOptions = {
        showFile: true,
        vaultPath: opts.absolute ? config.vaultPath : undefined,
      };
      for (const task of review.deferred) {
        const statusLabel = task.status === "on_hold" ? "on hold" : "moved";
        console.log("  " + formatTask(task, fmtOpts) + chalk.dim(`  [${statusLabel}]`));
      }
      console.log();
    }

    // Needs triage — tasks that may need reprioritizing or scheduling
    if (review.needsTriage.length > 0) {
      console.log(chalk.bold.yellow(`⚠️  Needs triage — may need reprioritizing or scheduling (${review.needsTriage.length})`));
      for (const task of review.needsTriage.slice(0, 10)) {
        const parts = ["  " + chalk.dim("○"), task.description];
        if (task.priority === "highest" || task.priority === "high") {
          parts.push(chalk.yellow(`${task.priority} priority`));
        }
        if (task.scheduled) parts.push(chalk.dim(`scheduled ${task.scheduled}`));
        if (task.created) parts.push(chalk.dim(`created ${task.created}`));
        parts.push(chalk.dim(`[${resolvePath(task.filePath)}]`));
        console.log(parts.join("  "));
      }
      if (review.needsTriage.length > 10) {
        console.log(chalk.dim(`  ... and ${review.needsTriage.length - 10} more`));
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

// ─── sift triage ─────────────────────────────────────────────
program
  .command("triage")
  .description("Review projects and surface tasks that need attention")
  .option("--project <name>", "Show full detail for a single project")
  .option("--absolute", "Show absolute file paths instead of vault-relative")
  .action(async (opts) => {
    const config = await resolveConfig();

    const summary = await getTriageSummary(config, {
      project: opts.project,
    });

    const fmtOpts: FormatTaskOptions = {
      showFile: true,
      vaultPath: opts.absolute ? config.vaultPath : undefined,
    };

    // ── Tier 1: Needs attention ───────────────────────────────
    if (summary.tier1.length > 0) {
      console.log(chalk.bold.red(`Tier 1 — Needs attention (${summary.tier1.length})`));
      for (const item of summary.tier1) {
        console.log();
        const parts = [chalk.bold.white(`  ${item.project.name}`)];
        if (item.project.lastReviewed) {
          parts.push(chalk.dim(`last reviewed: ${item.project.lastReviewed}`));
        }
        if (item.lastActivityDate) {
          parts.push(chalk.dim(`last activity: ${item.lastActivityDate}`));
        }
        console.log(parts.join("  "));

        // Show why
        const whyParts: string[] = [];
        for (const signal of item.signals) {
          whyParts.push(formatSignal(signal));
        }
        console.log(chalk.yellow(`    Why: ${whyParts.join(", ")}`));

        // Show tasks
        if (item.tasks.length > 0) {
          console.log(chalk.dim("    Tasks:"));
          for (const task of item.tasks) {
            console.log("      " + formatTask(task, fmtOpts));
          }
        }
      }
      console.log();
    }

    // ── Tier 2: Quick check ───────────────────────────────────
    if (summary.tier2.length > 0) {
      console.log(chalk.bold.yellow(`Tier 2 — Quick check (${summary.tier2.length})`));
      for (const item of summary.tier2) {
        const parts = [chalk.white(`  ${item.project.name}`)];
        parts.push(chalk.dim(`${item.openTaskCount} open tasks`));
        if (item.lastActivityDate) {
          parts.push(chalk.dim(`last activity: ${item.lastActivityDate}`));
        }
        console.log(parts.join("  "));

        for (const task of item.topTasks) {
          console.log("    " + formatTask(task, fmtOpts));
        }
      }
      console.log();
    }

    // ── Tier 3: Not due ───────────────────────────────────────
    if (summary.tier3.length > 0) {
      console.log(chalk.bold.dim(`Tier 3 — Not due (${summary.tier3.reduce((n, g) => n + g.names.length, 0)})`));
      for (const group of summary.tier3) {
        console.log(`  ${chalk.dim(group.status + ":")} ${group.names.join(", ")}`);
      }
      console.log();
    }

    // ── Loose tasks ───────────────────────────────────────────
    if (summary.looseTasks.length > 0) {
      console.log(chalk.bold(`Loose tasks — daily note orphans (${summary.looseTasks.length})`));
      for (const orphan of summary.looseTasks) {
        let line = "  " + formatTask(orphan.task, fmtOpts);
        if (orphan.mentionedProjects.length > 0) {
          line += chalk.cyan(`  → ${orphan.mentionedProjects.join(", ")}`);
        }
        console.log(line);
      }
      console.log();
    }

    // If everything is clean
    if (summary.tier1.length === 0 && summary.tier2.length === 0 && summary.looseTasks.length === 0) {
      console.log(chalk.green("All projects are reviewed and healthy. No loose tasks found."));
    }
  });

/**
 * Format a triage signal as a human-readable string for CLI output.
 */
function formatSignal(signal: TriageSignal): string {
  switch (signal.kind) {
    case "overdue_review":
      return signal.lastReviewed
        ? `review overdue (last: ${signal.lastReviewed}, interval: ${signal.intervalDays}d)`
        : `never reviewed (interval: ${signal.intervalDays}d)`;
    case "stale_tasks":
      return `${signal.count} high-priority task${signal.count > 1 ? "s" : ""} with stale scheduled dates`;
    case "undated_tasks":
      return `${signal.count} undated task${signal.count > 1 ? "s" : ""}`;
    case "inactive":
      return `no activity in ${signal.weeks} weeks (last: ${signal.lastActivityDate ?? "unknown"})`;
    case "orphan_mentions":
      return `${signal.count} orphaned daily-note task${signal.count > 1 ? "s" : ""} mention this project`;
    case "done_with_open_tasks":
      return `marked done but has ${signal.openCount} open task${signal.openCount > 1 ? "s" : ""}`;
  }
}

// ─── sift init ───────────────────────────────────────────────
program
  .command("init")
  .description("Set up sift configuration")
  .argument("<vault-path>", "Path to your Obsidian vault")
  .option("--daily-notes <path>", "Daily notes folder (relative to vault)", "Daily Notes")
  .option("--projects <path>", "Projects folder (relative to vault)", "Projects")
  .option("--areas <path>", "Areas folder (relative to vault)", "Areas")
  .option("--project-template <path>", "Project template file (relative to vault)", "Templates/Project.md")
  .option("--area-template <path>", "Area template file (relative to vault)", "Templates/Area.md")
  .option("--exclude <folders...>", "Folders to exclude from scanning")
  .action(async (vaultPath: string, opts) => {
    const config: SiftConfig = {
      vaultPath: vaultPath.startsWith("/") ? vaultPath : path.resolve(vaultPath),
      dailyNotesPath: opts.dailyNotes,
      dailyNotesFormat: "YYYY-MM-DD",
      excludeFolders: opts.exclude || ["Templates", "Attachments"],
      projectsPath: opts.projects,
      areasPath: opts.areas,
      projectTemplatePath: opts.projectTemplate,
      areaTemplatePath: opts.areaTemplate,
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

    const allTasks = await scanTasks(config);
    const agenda = await getAgendaTasks(config);
    const next = await getNextTasks(config, 5);

    console.log(chalk.bold("📋 Sift Summary"));
    console.log(chalk.dim(`  Vault: ${config.vaultPath}`));
    console.log();
    console.log(formatSummary(allTasks));
    console.log();

    // Agenda: what's relevant today
    if (agenda.length > 0) {
      console.log(formatTaskList(agenda, "📋 Today's Agenda"));
      console.log();
    }

    // Up next: most important overall
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

// ─── sift thread ─────────────────────────────────────────────

const threadCmd = program
  .command("thread")
  .description("Manage conversation threads on tasks");

threadCmd
  .command("create")
  .description("Start a new thread on a task")
  .requiredOption("--file <path>", "File path containing the task")
  .requiredOption("--line <number>", "Line number of the task (1-indexed)")
  .requiredOption("--with <names...>", "Counterparts (people or teams)")
  .option("--state <state>", "Initial state: active, waiting, paused", "active")
  .option("--follow-up <date>", "Follow-up date (YYYY-MM-DD)")
  .option("--source <url>", "URL or markdown link to conversation")
  .option("--date <date>", "Date for first entry (YYYY-MM-DD, default: today)")
  .argument("[entry]", "First entry description")
  .action(async (entry: string | undefined, opts) => {
    const config = await resolveConfig();
    try {
      const result = await createThread(config, {
        file: opts.file,
        line: parseInt(opts.line, 10),
        counterparts: opts.with,
        state: opts.state as ThreadState,
        followUp: opts.followUp,
        source: opts.source,
        content: entry,
        date: opts.date,
      });
      console.log(chalk.green("✓") + ` Created thread on: ${result.task}`);
      console.log(chalk.dim("  Counterparts: ") + result.counterparts.map((c) => `[[${c}]]`).join(", "));
      console.log(chalk.dim("  State: ") + result.state);
      if (result.followUp) console.log(chalk.dim("  Follow-up: ") + result.followUp);
      if (result.lastEntry) console.log(chalk.dim("  Entry: ") + `${result.lastEntry.date}: ${result.lastEntry.description}`);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

threadCmd
  .command("entry")
  .description("Add a timestamped entry to an existing thread")
  .requiredOption("--file <path>", "File path containing the task")
  .requiredOption("--line <number>", "Line number of the task (1-indexed)")
  .option("--state <state>", "Change thread state: active, waiting, paused, resolved")
  .option("--follow-up <date>", "Set/update follow-up date (YYYY-MM-DD, or 'none' to clear)")
  .option("--date <date>", "Entry date (YYYY-MM-DD, default: today)")
  .argument("<content>", "What happened (one line)")
  .action(async (content: string, opts) => {
    const config = await resolveConfig();
    try {
      const result = await addThreadEntry(config, {
        file: opts.file,
        line: parseInt(opts.line, 10),
        content,
        state: opts.state as ThreadState | undefined,
        followUp: opts.followUp,
        date: opts.date,
      });
      console.log(chalk.green("✓") + ` Added entry to thread on: ${result.task}`);
      console.log(chalk.dim("  State: ") + result.state);
      if (result.followUp) console.log(chalk.dim("  Follow-up: ") + result.followUp);
      console.log(chalk.dim("  Entry: ") + `${result.lastEntry!.date}: ${result.lastEntry!.description}`);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

threadCmd
  .command("state")
  .description("Change thread metadata without adding an entry")
  .requiredOption("--file <path>", "File path containing the task")
  .requiredOption("--line <number>", "Line number of the task (1-indexed)")
  .option("--state <state>", "New state: active, waiting, paused, resolved")
  .option("--follow-up <date>", "Set/update/clear follow-up (YYYY-MM-DD, or 'none')")
  .option("--with <names...>", "Replace counterpart list")
  .option("--source <url>", "Update source link ('none' to clear)")
  .action(async (opts) => {
    const config = await resolveConfig();
    try {
      const result = await updateThreadState(config, {
        file: opts.file,
        line: parseInt(opts.line, 10),
        state: opts.state as ThreadState | undefined,
        followUp: opts.followUp,
        counterparts: opts.with,
        source: opts.source,
      });
      console.log(chalk.green("✓") + ` Updated thread on: ${result.task}`);
      console.log(chalk.dim("  Counterparts: ") + result.counterparts.map((c) => `[[${c}]]`).join(", "));
      console.log(chalk.dim("  State: ") + result.state);
      if (result.followUp) console.log(chalk.dim("  Follow-up: ") + result.followUp);
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

threadCmd
  .command("list")
  .description("List threads needing attention")
  .option("--state <state>", "Filter by state: active, waiting, paused, resolved")
  .option("--stale", "Only show stale threads (past follow-up or undated waiting > 2 days)")
  .option("--counterpart <name>", "Filter by counterpart name")
  .option("--project <name>", "Filter to a specific project")
  .action(async (opts) => {
    const config = await resolveConfig();
    const allTasks = await scanTasks(config);
    const tasksWithThreads = allTasks.filter((t) => t.thread !== null);

    // Filter by state
    const states: ThreadState[] = opts.state
      ? [opts.state as ThreadState]
      : ["active", "waiting"];
    let filtered = tasksWithThreads.filter((t) => states.includes(t.thread!.state));

    // Filter by counterpart
    if (opts.counterpart) {
      const search = opts.counterpart.toLowerCase();
      filtered = filtered.filter((t) =>
        t.thread!.counterparts.some((c) => c.toLowerCase().includes(search)),
      );
    }

    // Filter by project
    if (opts.project) {
      filtered = filtered.filter((t) => t.filePath.includes(opts.project));
    }

    // Filter stale
    if (opts.stale) {
      const today = localToday();
      filtered = filtered.filter((t) => {
        const thread = t.thread!;
        if (thread.followUp && thread.followUp < today) return true;
        if (thread.state === "waiting" && !thread.followUp && thread.entries.length > 0) {
          const last = thread.entries[thread.entries.length - 1];
          if (last.date) {
            const daysSince = Math.floor(
              (new Date(today).getTime() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24),
            );
            return daysSince > 2;
          }
        }
        return false;
      });
    }

    if (filtered.length === 0) {
      console.log(chalk.dim("No threads found matching criteria."));
      return;
    }

    // Display
    const counts = {
      active: tasksWithThreads.filter((t) => t.thread!.state === "active").length,
      waiting: tasksWithThreads.filter((t) => t.thread!.state === "waiting").length,
      paused: tasksWithThreads.filter((t) => t.thread!.state === "paused").length,
    };

    console.log(chalk.bold(`Threads`) + chalk.dim(` (${counts.active} active, ${counts.waiting} waiting, ${counts.paused} paused)`));
    console.log();

    for (const task of filtered) {
      const thread = task.thread!;
      const counterparts = thread.counterparts.map((c) => `[[${c}]]`).join(", ");
      const stateLabel = thread.state === "waiting" ? chalk.yellow(`waiting on ${counterparts}`) : chalk.cyan(thread.state);

      let taskLine = `  ${task.description} ${chalk.dim("·")} ${stateLabel}`;
      if (thread.followUp) {
        const today = localToday();
        const overdue = thread.followUp < today;
        taskLine += overdue
          ? chalk.dim(" · ") + chalk.red(`follow-up: ${thread.followUp} (overdue)`)
          : chalk.dim(` · follow-up: ${thread.followUp}`);
      }
      console.log(taskLine);

      if (thread.entries.length > 0) {
        const last = thread.entries[thread.entries.length - 1];
        console.log(chalk.dim(`    last: ${last.date || "undated"}: ${last.description}`));
      }

      const displayPath = path.join(config.vaultPath, task.filePath);
      console.log(chalk.dim(`    ${displayPath}:${task.line}`));
      console.log();
    }
  });

// ─── sift promote ────────────────────────────────────────────
program
  .command("promote")
  .description("Upgrade a task to a project (moves task + thread into new project file)")
  .requiredOption("--file <path>", "File path containing the task")
  .requiredOption("--line <number>", "Line number of the task (1-indexed)")
  .option("--name <name>", "Project name (default: task description)")
  .option("--area <area>", "Parent area for the new project")
  .option("--status <status>", "Initial project status (default: active)")
  .option("--tags <tags>", "Comma-separated tags")
  .option("--description <text>", "Safety check: partial task text to verify")
  .action(async (opts) => {
    const config = await resolveConfig();
    try {
      const result = await promoteTask(config, {
        file: opts.file,
        line: parseInt(opts.line, 10),
        name: opts.name,
        area: opts.area,
        status: opts.status,
        tags: opts.tags ? (opts.tags as string).split(",").map((t: string) => t.trim()) : undefined,
        description: opts.description,
      });
      console.log(chalk.green("✓") + ` Promoted task to project: "${result.projectName}"`);
      console.log(chalk.dim("  Task: ") + result.task);
      console.log(chalk.dim("  Project file: ") + path.join(config.vaultPath, result.projectFile));
      if (result.hadThread) {
        console.log(chalk.dim("  Thread: ") + "preserved");
      }
    } catch (err: any) {
      console.error(chalk.red("Error: ") + err.message);
      process.exit(1);
    }
  });

program.parse();
