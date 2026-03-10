import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type SiftConfig } from "./types.js";

const CONFIG_FILENAME = ".siftrc.json";

/**
 * Default configuration values.
 */
const DEFAULTS: Omit<SiftConfig, "vaultPath"> = {
  dailyNotesPath: "Daily Notes",
  dailyNotesFormat: "YYYY-MM-DD",
  excludeFolders: ["Templates", "Attachments"],
  projectsPath: "Projects",
  projectTemplatePath: "Templates/Project.md",
};

/**
 * Resolve the sift configuration by checking (in order):
 * 1. Explicit config object passed in
 * 2. Environment variable SIFT_VAULT_PATH
 * 3. Config file at ~/.siftrc.json
 * 4. Config file at ./.siftrc.json
 *
 * Throws if no vault path can be determined.
 */
export async function resolveConfig(
  overrides?: Partial<SiftConfig>,
): Promise<SiftConfig> {
  // Start with defaults
  let config: Partial<SiftConfig> = { ...DEFAULTS };

  // Try loading from config files (home dir, then current dir)
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const configPaths = [
    path.join(homeDir, CONFIG_FILENAME),
    path.join(process.cwd(), CONFIG_FILENAME),
  ];

  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const fileConfig = JSON.parse(content) as Partial<SiftConfig>;
      config = { ...config, ...fileConfig };
    } catch {
      // File doesn't exist or is invalid, skip
    }
  }

  // Environment variable overrides file config
  if (process.env.SIFT_VAULT_PATH) {
    config.vaultPath = process.env.SIFT_VAULT_PATH;
  }

  // Explicit overrides win
  if (overrides) {
    config = { ...config, ...overrides };
  }

  if (!config.vaultPath) {
    throw new Error(
      "No vault path configured. Set SIFT_VAULT_PATH environment variable, " +
        `create a ${CONFIG_FILENAME} file, or pass vaultPath explicitly.`,
    );
  }

  return config as SiftConfig;
}

/**
 * Write a config file to the user's home directory.
 */
export async function writeConfig(config: SiftConfig): Promise<string> {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "";
  const configPath = path.join(homeDir, CONFIG_FILENAME);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return configPath;
}
