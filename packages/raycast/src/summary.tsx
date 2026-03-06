import { List, Icon, Color, ActionPanel, Action, showToast, Toast } from "@raycast/api";
import { useState, useEffect } from "react";
import { getNextTasks, getOverdueTasks, scanTasks, sortByUrgency, completeTask, type Task, type Priority } from "@sift/core";
import { getConfig } from "./config";

const PRIORITY_ICONS: Record<Priority, { icon: Icon; color: Color }> = {
  highest: { icon: Icon.ExclamationMark, color: Color.Red },
  high: { icon: Icon.ArrowUp, color: Color.Orange },
  medium: { icon: Icon.Minus, color: Color.Blue },
  none: { icon: Icon.Circle, color: Color.SecondaryText },
  low: { icon: Icon.ArrowDown, color: Color.SecondaryText },
  lowest: { icon: Icon.ArrowDown, color: Color.SecondaryText },
};

export default function Summary() {
  const [overdueTasks, setOverdueTasks] = useState<Task[]>([]);
  const [nextTasks, setNextTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState({ open: 0, done: 0, overdue: 0 });
  const [isLoading, setIsLoading] = useState(true);

  const config = getConfig();
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    async function load() {
      try {
        const allTasks = await scanTasks(config);
        const open = allTasks.filter((t) => t.status === "open");
        const done = allTasks.filter((t) => t.status === "done");
        const overdue = open.filter((t) => t.due !== null && t.due < today);

        setStats({ open: open.length, done: done.length, overdue: overdue.length });
        setOverdueTasks(sortByUrgency(overdue));
        setNextTasks(sortByUrgency(open).slice(0, 5));
      } catch (error) {
        showToast(Toast.Style.Failure, "Failed to load tasks", String(error));
      }
      setIsLoading(false);
    }
    load();
  }, []);

  return (
    <List isLoading={isLoading}>
      <List.Section title={`Overview: ${stats.open} open · ${stats.done} done · ${stats.overdue} overdue`}>
        {overdueTasks.length > 0 && (
          <List.Item
            icon={{ source: Icon.Warning, tintColor: Color.Red }}
            title={`${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}`}
          />
        )}
      </List.Section>

      {overdueTasks.length > 0 && (
        <List.Section title="Overdue">
          {overdueTasks.map((task) => (
            <TaskItem key={`${task.filePath}:${task.line}`} task={task} config={config} />
          ))}
        </List.Section>
      )}

      <List.Section title="Up Next">
        {nextTasks.map((task) => (
          <TaskItem key={`${task.filePath}:${task.line}`} task={task} config={config} />
        ))}
      </List.Section>
    </List>
  );
}

function TaskItem({ task, config }: { task: Task; config: ReturnType<typeof getConfig> }) {
  const prio = PRIORITY_ICONS[task.priority];
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = task.due !== null && task.due < today;

  return (
    <List.Item
      icon={{ source: prio.icon, tintColor: prio.color }}
      title={task.description}
      subtitle={task.filePath}
      accessories={[
        ...(task.due ? [{ text: { value: `Due ${task.due}`, color: isOverdue ? Color.Red : undefined } }] : []),
        ...(task.scheduled ? [{ text: `Scheduled ${task.scheduled}` }] : []),
      ]}
      actions={
        <ActionPanel>
          <Action
            title="Mark as Done"
            icon={Icon.Checkmark}
            onAction={async () => {
              try {
                await completeTask(config, task);
                showToast(Toast.Style.Success, "Task completed!");
              } catch (error) {
                showToast(Toast.Style.Failure, "Failed to complete task", String(error));
              }
            }}
          />
          <Action.CopyToClipboard title="Copy Task" content={task.description} />
          <Action.Open
            title="Open in Obsidian"
            target={`obsidian://open?vault=${encodeURIComponent(config.vaultPath.split("/").pop() || "")}&file=${encodeURIComponent(task.filePath)}`}
          />
        </ActionPanel>
      }
    />
  );
}
