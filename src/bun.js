import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test as bunTest } from "bun:test";
import { isTestSelected, runInTestContext } from "./test-context.js";

/**
 * Bun test adapter that attributes decisions to stable source locations and
 * skips unrelated tests during targeted authfault runs.
 *
 * Bun does not expose the complete describe/test name to the callback, so the
 * declaration line is part of the ID. This also keeps repeated test names in
 * different describe blocks distinct.
 */
export function authfaultTest(name, testFunction, timeout) {
  if (typeof testFunction !== "function") {
    throw new TypeError("authfaultTest requires a test function");
  }

  const { callerFile, callerLine } = findCallerLocation();
  const testId = `${callerFile}:${callerLine}::${name}`;
  const register = isTestSelected(testId) ? bunTest : bunTest.skip;

  // Bun treats callbacks that declare an argument as done-callback tests.
  // Preserve the original callback's arity so async and callback-style tests
  // continue to behave exactly as they do with bun:test.
  const wrappedTest = testFunction.length > 0
    ? function wrappedCallbackTest(done) {
        return runInTestContext(testId, () => testFunction(done));
      }
    : function wrappedTestWithoutCallback() {
        return runInTestContext(testId, () => testFunction());
      };

  return register(name, wrappedTest, timeout);
}

function findCallerLocation() {
  const stack = new Error().stack?.split("\n").slice(2) ?? [];
  const frame = stack.find(
    (line) => !line.includes("/src/bun.js") && !line.includes("node:internal")
  );

  if (!frame) {
    return { callerFile: "unknown-test-file", callerLine: 0 };
  }

  const match = frame.match(/(?:\(|\s)(file:\/\/[^):]+|\/[^):]+):(\d+):(\d+)\)?$/);
  if (!match) {
    return { callerFile: "unknown-test-file", callerLine: 0 };
  }

  const absolutePath = match[1].startsWith("file:")
    ? fileURLToPath(match[1])
    : match[1];
  return {
    callerFile: relative(process.cwd(), absolutePath) || absolutePath,
    callerLine: Number(match[2])
  };
}
