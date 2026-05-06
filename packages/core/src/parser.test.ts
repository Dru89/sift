import { describe, it, expect } from "vitest";
import { parseLine, parseContent } from "./parser.js";

describe("parseLine", () => {
  it("parses a basic open task", () => {
    const task = parseLine("- [ ] Do the thing", "test.md", 1);
    expect(task).not.toBeNull();
    expect(task!.description).toBe("Do the thing");
    expect(task!.status).toBe("open");
    expect(task!.priority).toBe("none");
  });

  it("parses a task with priority and dates", () => {
    const task = parseLine(
      "- [ ] Refactor auth module 🔼 📅 2026-05-15 ⏳ 2026-05-10 ➕ 2026-05-01",
      "Projects/Test.md",
      5,
    );
    expect(task).not.toBeNull();
    expect(task!.description).toBe("Refactor auth module");
    expect(task!.priority).toBe("high");
    expect(task!.due).toBe("2026-05-15");
    expect(task!.scheduled).toBe("2026-05-10");
    expect(task!.created).toBe("2026-05-01");
    expect(task!.filePath).toBe("Projects/Test.md");
    expect(task!.line).toBe(5);
  });

  it("parses completed tasks", () => {
    const task = parseLine("- [x] Done task ✅ 2026-05-02", "test.md", 1);
    expect(task).not.toBeNull();
    expect(task!.status).toBe("done");
    expect(task!.done).toBe("2026-05-02");
  });

  it("parses in-progress tasks", () => {
    const task = parseLine("- [/] Working on this", "test.md", 1);
    expect(task).not.toBeNull();
    expect(task!.status).toBe("in_progress");
  });

  it("parses cancelled tasks", () => {
    const task = parseLine("- [-] Nope", "test.md", 1);
    expect(task).not.toBeNull();
    expect(task!.status).toBe("cancelled");
  });

  it("parses on-hold tasks", () => {
    const task = parseLine("- [h] Paused for now", "test.md", 1);
    expect(task).not.toBeNull();
    expect(task!.status).toBe("on_hold");
  });

  it("parses moved tasks", () => {
    const task = parseLine("- [>] Deferred", "test.md", 1);
    expect(task).not.toBeNull();
    expect(task!.status).toBe("moved");
  });

  it("skips non-task checkboxes (~)", () => {
    const task = parseLine("- [~] Not a task", "test.md", 1);
    expect(task).toBeNull();
  });

  it("skips empty checkboxes", () => {
    const task = parseLine("- [ ] ", "test.md", 1);
    expect(task).toBeNull();
  });

  it("returns null for non-task lines", () => {
    expect(parseLine("Just some text", "test.md", 1)).toBeNull();
    expect(parseLine("## Heading", "test.md", 1)).toBeNull();
    expect(parseLine("- Regular list item", "test.md", 1)).toBeNull();
    expect(parseLine("> Blockquote", "test.md", 1)).toBeNull();
  });

  it("handles indented tasks", () => {
    const task = parseLine("  - [ ] Indented task", "test.md", 1);
    expect(task).not.toBeNull();
    expect(task!.description).toBe("Indented task");
  });

  it("parses all priority levels", () => {
    expect(parseLine("- [ ] P ⏫", "t.md", 1)!.priority).toBe("highest");
    expect(parseLine("- [ ] P 🔼", "t.md", 1)!.priority).toBe("high");
    expect(parseLine("- [ ] P 🔽", "t.md", 1)!.priority).toBe("low");
    expect(parseLine("- [ ] P ⏬", "t.md", 1)!.priority).toBe("lowest");
    expect(parseLine("- [ ] P", "t.md", 1)!.priority).toBe("none");
  });
});

describe("parseContent", () => {
  it("extracts all tasks from file content", () => {
    const content = `## Tasks

- [ ] First task 📅 2026-05-10
- [x] Second task ✅ 2026-05-02
- [-] Third task

Some other content here.

- [ ] Fourth task 🔼
`;
    const tasks = parseContent(content, "test.md");
    expect(tasks).toHaveLength(4);
    expect(tasks[0].description).toBe("First task");
    expect(tasks[1].description).toBe("Second task");
    expect(tasks[2].description).toBe("Third task");
    expect(tasks[3].description).toBe("Fourth task");
  });

  it("returns empty array for content with no tasks", () => {
    const content = `## Notes

Just some regular text.
No tasks here.
`;
    const tasks = parseContent(content, "test.md");
    expect(tasks).toHaveLength(0);
  });

  it("skips tasks inside fenced code blocks", () => {
    const content = `## Tasks

- [ ] Real task before code block

\`\`\`markdown
- [ ] Fake task inside code block 📅 2026-05-10
- [x] Another fake task ✅ 2026-05-02
\`\`\`

- [ ] Real task after code block
`;
    const tasks = parseContent(content, "test.md");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].description).toBe("Real task before code block");
    expect(tasks[1].description).toBe("Real task after code block");
  });

  it("skips tasks inside tilde fenced code blocks", () => {
    const content = `## Example

~~~
- [ ] This is not a real task
~~~

- [ ] This is a real task
`;
    const tasks = parseContent(content, "test.md");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("This is a real task");
  });

  it("skips threads inside fenced code blocks", () => {
    const content = `## Spec

\`\`\`markdown
- [ ] Work with Bob on login page design 📅 2026-05-15
  > 🧵 with [[Bob Martinez]] · waiting · follow-up: 2026-05-09
  > - 2026-05-03: Sent initial mockup
\`\`\`

- [ ] Actual task
`;
    const tasks = parseContent(content, "test.md");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Actual task");
    expect(tasks[0].thread).toBeNull();
  });

  it("handles indented code fences", () => {
    const content = `## Notes

  \`\`\`
  - [ ] Indented code block task
  \`\`\`

- [ ] Real task
`;
    const tasks = parseContent(content, "test.md");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].description).toBe("Real task");
  });
});
