import { test as nodeTest } from "node:test";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isTestSelected, runInTestContext } from "./test-context.js";

/**
 * A small node:test adapter that attributes authorization decisions to tests
 * and lets the runner skip unrelated tests during mutation runs.
 */
export function authfaultTest(name, optionsOrFunction, maybeFunction) {
  const hasOptions = typeof optionsOrFunction !== "function";
  const options = hasOptions ? optionsOrFunction ?? {} : {};
  const testFunction = hasOptions ? maybeFunction : optionsOrFunction;

  if (typeof testFunction !== "function") {
    throw new TypeError("authfaultTest requires a test function");
  }

  const callerFile = findCallerFile();

  return nodeTest(name, options, (context) => {
    const testId = `${callerFile}::${context.fullName}`;
    if (!isTestSelected(testId)) {
      context.skip("not selected for this authfault mutation");
      return;
    }

    return runInTestContext(testId, () => testFunction(context));
  });
}

function findCallerFile() {
  const stack = new Error().stack?.split("\n").slice(2) ?? [];
  const frame = stack.find(
    (line) => !line.includes("/src/node-test.js") && !line.includes("node:internal")
  );

  if (!frame) {
    return "unknown-test-file";
  }

  const match = frame.match(/(?:\(|\s)(file:\/\/[^):]+|\/[^):]+):(\d+):(\d+)\)?$/);
  if (!match) {
    return "unknown-test-file";
  }

  const absolutePath = match[1].startsWith("file:")
    ? fileURLToPath(match[1])
    : match[1];
  return relative(process.cwd(), absolutePath) || absolutePath;
}
