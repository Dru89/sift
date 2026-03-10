import { getPreferenceValues } from "@raycast/api";
import { type SiftConfig } from "@sift/core";

interface Preferences {
  vaultPath: string;
  dailyNotesPath?: string;
  excludeFolders?: string;
}

export function getConfig(): SiftConfig {
  const prefs = getPreferenceValues<Preferences>();

  return {
    vaultPath: prefs.vaultPath,
    dailyNotesPath: prefs.dailyNotesPath || "Daily Notes",
    dailyNotesFormat: "YYYY-MM-DD",
    excludeFolders: prefs.excludeFolders
      ? prefs.excludeFolders.split(",").map((s) => s.trim())
      : ["Templates", "Attachments"],
    projectsPath: "Projects",
    projectTemplatePath: "Templates/Project.md",
  };
}
