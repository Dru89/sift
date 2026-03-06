import { List, Icon, Color, ActionPanel, Action, showToast, Toast } from "@raycast/api";
import { useState, useEffect } from "react";
import { scanTasks, sortByUrgency, completeTask, type Task, type Priority } from "@sift/core";
import { getConfig } from "./config";

const PRIORITY_ICONS: Record<Priority, { icon: Icon; color: Color }> = {
  highest: { icon: Icon.ExclamationMark, color: Color.Red },
  high: { icon: Icon.ArrowUp, color: Color.Orange },
  medium: { icon: Icon.Minus, color: Color.Blue },
  none: { icon: Icon.Circle, color: Color.SecondaryText },
  low: { icon: Icon.ArrowDown, color: Color.SecondaryText },
  lowest: { icon: Icon.ArrowDown, color: Color.SecondaryText },
};

export default function ListTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState("");

  const config = getConfig();

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const allTasks = await scanTasks(config, { status: "open" });
        setTasks(sortByUrgency(allTasks));
      } catch (error) {
        showToast(Toast.Style.Failure, "Failed to load tasks", String(error));
      }
      setIsLoading(false);
    }
    load();
  }, []);

  const filteredTasks = searchText
    ? tasks.filter((t) => t.description.toLowerCase().includes(searchText.toLowerCase()))
    : tasks;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search tasks..." onSearchTextChange={setSearchText}>
      {filteredTasks.map((task, i) => {
        const prio = PRIORITY_ICONS[task.priority];
        const isOverdue = task.due !== null && task.due < today;

        return (
          <List.Item
            key={`${task.filePath}:${task.line}`}
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
                      setTasks((prev) => prev.filter((t) => !(t.filePath === task.filePath && t.line === task.line)));
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
      })}
    </List>
  );
}
