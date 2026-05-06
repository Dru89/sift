import { mkdtemp, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures", "vault");

export interface TestVault {
  /** Absolute path to the temporary vault root */
  path: string;
  /** Clean up the temporary vault */
  cleanup: () => Promise<void>;
}

/**
 * Creates a temporary copy of the fixture vault for isolated test use.
 * Call `cleanup()` when done to remove the temp directory.
 */
export async function createTestVault(): Promise<TestVault> {
  const path = await mkdtemp(join(tmpdir(), "sift-test-"));
  await cp(FIXTURES_DIR, path, { recursive: true });
  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  };
}

/**
 * Returns a SiftConfig-compatible object pointing at the test vault.
 */
export function testConfig(vaultPath: string) {
  return {
    vaultPath,
    dailyNotesPath: "Daily Notes",
    dailyNotesFormat: "YYYY-MM-DD",
    excludeFolders: ["Templates"],
    projectsPath: "Projects",
    areasPath: "Areas",
    projectTemplatePath: "Templates/Project.md",
    areaTemplatePath: "Templates/Area.md",
  };
}
