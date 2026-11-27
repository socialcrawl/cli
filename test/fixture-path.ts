// Tests run from .test-build/ (compiled) or from test/ (Node with type stripping), so a
// fixture is found from the package root, not from the test file's own folder.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function packageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(dir, "package.json"))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error("package.json not found above the test files");
    dir = up;
  }
  return dir;
}

export const ROOT = packageRoot();

/** The path of a file under test/fixtures/. */
export const fixturePath = (...parts: string[]) => path.join(ROOT, "test", "fixtures", ...parts);
