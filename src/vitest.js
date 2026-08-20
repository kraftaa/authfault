import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test as vitestTest } from "vitest";
import { isTestSelected, runInTestContext } from "./test-context.js";

/**
 * Vitest adapter that attributes decisions to stable file/suite/test IDs and
 * skips unrelated tests during targeted authfault runs.
 */
export function authfaultTest(name, optionsOrFunction, maybeFunction) {
  const hasOptions = typeof optionsOrFunction !== "function";
  const testFunction = hasOptions ? maybeFunction : optionsOrFunction;

  if (typeof testFunction !== "function") {
    throw new TypeError("authfaultTest requires a test function");
  }

  const callerFile = findCallerFile();
  const wrappedTest = (context) => {
    const fullTestName = context.task.fullTestName ?? context.task.name;
    const testId = `${callerFile}::${fullTestName}`;

    if (!isTestSelected(testId)) {
      context.skip("not selected for this authfault mutation");
    }

    return runInTestContext(testId, () => testFunction(context));
  };

  if (hasOptions) {
    return vitestTest(name, optionsOrFunction ?? {}, wrappedTest);
  }

  return vitestTest(name, wrappedTest, maybeFunction);
}

function findCallerFile() {
  const stack = new Error().stack?.split("\n").slice(2) ?? [];
  const frame = stack.find(
    (line) => !line.includes("/src/vitest.js") && !line.includes("node:internal")
  );

  if (!frame) return "unknown-test-file";

  const match = frame.match(/(?:\(|\s)(file:\/\/[^):]+|\/[^):]+):(\d+):(\d+)\)?$/);
  if (!match) return "unknown-test-file";

  const absolutePath = match[1].startsWith("file:")
    ? fileURLToPath(match[1])
    : match[1];
  return relative(process.cwd(), absolutePath) || absolutePath;
}
