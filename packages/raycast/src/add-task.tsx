import { Form, ActionPanel, Action, showToast, Toast, popToRoot } from "@raycast/api";
import { useState } from "react";
import { addTask, type Priority } from "@sift/core";
import { getConfig } from "./config";

export default function AddTask() {
  const [description, setDescription] = useState("");

  const config = getConfig();

  async function handleSubmit(values: {
    description: string;
    priority: string;
    due: Date | null;
    scheduled: Date | null;
  }) {
    if (!values.description.trim()) {
      showToast(Toast.Style.Failure, "Task description is required");
      return;
    }

    try {
      const taskLine = await addTask(config, {
        description: values.description.trim(),
        priority: (values.priority || undefined) as Priority | undefined,
        due: values.due ? formatDate(values.due) : undefined,
        scheduled: values.scheduled ? formatDate(values.scheduled) : undefined,
      });

      showToast(Toast.Style.Success, "Task added!", taskLine);
      popToRoot();
    } catch (error) {
      showToast(Toast.Style.Failure, "Failed to add task", String(error));
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Task" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="description"
        title="Task"
        placeholder="What needs to be done?"
        value={description}
        onChange={setDescription}
      />
      <Form.Dropdown id="priority" title="Priority" defaultValue="">
        <Form.Dropdown.Item value="" title="None" />
        <Form.Dropdown.Item value="highest" title="⏫ Highest" />
        <Form.Dropdown.Item value="high" title="🔼 High" />
        <Form.Dropdown.Item value="low" title="🔽 Low" />
        <Form.Dropdown.Item value="lowest" title="⏬ Lowest" />
      </Form.Dropdown>
      <Form.DatePicker id="due" title="Due Date" type={Form.DatePicker.Type.Date} />
      <Form.DatePicker id="scheduled" title="Scheduled Date" type={Form.DatePicker.Type.Date} />
    </Form>
  );
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
