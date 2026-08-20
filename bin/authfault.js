#!/usr/bin/env node

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySurvivorBaseline,
  readSurvivorBaseline,
  writeSurvivorBaseline
} from "../src/runner/baseline.js";
import {
  findPossibleCompensatingControls,
  planMutations,
  summarizePoints
} from "../src/runner/mutation.js";
import {
  describeExecutionProblem,
  executionProblem,
  printProcessOutput,
  processAttempt,
  run
} from "../src/runner/process.js";
import {
  formatGitHubAnnotations,
  formatGitHubSummary,
  printReport
} from "../src/runner/report.js";
import { readEvents } from "../src/runner/trace.js";

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}

if (args[0] === "init") {
  printSetupGuide();
  process.exit(0);
}

if (args[0] === "doctor") {
  process.exit(runDoctor());
}

const separator = args.indexOf("--");
if (separator === args.length - 1) {
  printHelp();
  process.exit(2);
}

let options;
try {
  options = parseOptions(separator === -1 ? args : args.slice(0, separator));
} catch (error) {
  console.error(`authfault: ${error.message}`);
  process.exit(2);
}

if (
  options.writeBaseline &&
  !options.baseline &&
  existsSync(options.writeBaseline)
) {
  console.error(
    "authfault: refusing to overwrite an existing survivor baseline without --baseline; pass the existing file with --baseline to preserve its review metadata."
  );
  process.exit(2);
}

let survivorBaseline;
try {
  survivorBaseline = options.baseline
    ? readSurvivorBaseline(options.baseline)
    : [];
} catch (error) {
  console.error(`authfault: ${error.message}`);
  process.exit(2);
}

if (process.env.NODE_ENV === "production" && !options.allowProduction) {
  console.error(
    "authfault: refusing to inject authorization faults with NODE_ENV=production. Use --allow-production only for an intentionally isolated test environment."
  );
  process.exit(2);
}

const command = separator === -1 ? defaultTestCommand() : args.slice(separator + 1);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "authfault-"));
let traceSequence = 0;

try {
  const baselineExecution = executeRun({
    command,
    environment: baseEnvironment(),
    label: "baseline",
    options,
    trace: true
  });
  const baseline = baselineExecution.result;

  if (baselineExecution.resetFailed) {
    failBaseline("the reset command failed before the baseline run", baselineExecution.reset);
  } else if (executionProblem(baseline) || baseline.status !== 0) {
    failBaseline("the baseline test command failed; mutations were not run", baseline);
  } else {
    const points = summarizePoints(baselineExecution.events);

    if (points.length === 0) {
      console.error("authfault: no instrumented authorization decisions were observed.");
      process.exitCode = 2;
    } else {
      const mutations = planMutations(
        points,
        baselineExecution.events,
        options.granularity
      ).slice(0, options.maxMutants);
      const results = [];
      const controls = new Map();

      for (const mutation of mutations) {
        const controlKey = mutation.targeted
          ? JSON.stringify(mutation.tests)
          : "__full_command__";
        let controlExecution = controls.get(controlKey);
        if (!controlExecution) {
          controlExecution = executeRun({
            command,
            environment: mutationEnvironment(mutation, null),
            label: `control-${mutation.id}`,
            options,
            trace: false,
            context: { phase: "control", pointId: mutation.id }
          });
          controls.set(controlKey, controlExecution);
        }

        const control = controlExecution.result;
        if (controlExecution.resetFailed) {
          results.push(inconclusiveResult(
            mutation,
            "the reset command failed before the control run",
            controlExecution.reset
          ));
          continue;
        }
        if (executionProblem(control)) {
          results.push(inconclusiveResult(
            mutation,
            describeExecutionProblem(control, "control"),
            control
          ));
          continue;
        }
        if (control.status !== 0) {
          results.push({
            ...mutation,
            outcome: "inconclusive",
            reason: "the isolated control run failed",
            attempts: [{ kind: "control", exitCode: control.status }]
          });
          if (options.verbose) printProcessOutput(control);
          continue;
        }

        const attempts = [];
        let outcome = "survived";
        let reason = null;
        let survivorEvents = [];

        for (let attempt = 0; attempt < options.confirmKills; attempt += 1) {
          const execution = executeRun({
            command,
            environment: mutationEnvironment(mutation, mutation.decision),
            label: `mutation-${mutation.id}-${attempt + 1}`,
            options,
            trace: true,
            context: {
              phase: "mutation",
              pointId: mutation.id,
              decision: mutation.decision,
              occurrence: mutation.occurrence
            }
          });
          const result = execution.result;

          if (execution.resetFailed) {
            outcome = "inconclusive";
            reason = "the reset command failed before a mutation run";
            attempts.push(processAttempt("reset", execution.reset));
            if (options.verbose) printProcessOutput(execution.reset);
            break;
          }
          if (executionProblem(result)) {
            outcome = "inconclusive";
            reason = describeExecutionProblem(result, "mutation");
            attempts.push(processAttempt("mutation", result));
            if (options.verbose) printProcessOutput(result);
            break;
          }

          attempts.push(processAttempt("mutation", result));
          if (result.status === 0) {
            outcome = attempts.some((item) => item.exitCode !== 0)
              ? "flaky"
              : "survived";
            survivorEvents = execution.events;
            break;
          }

          outcome = "killed";
          if (options.verbose) printProcessOutput(result);
        }

        results.push({
          ...mutation,
          outcome,
          reason,
          attempts,
          controlExitCode: control.status,
          possibleCompensatingControls:
            outcome === "survived"
              ? findPossibleCompensatingControls(survivorEvents, mutation)
              : []
        });
      }

      const baselineSummary = applySurvivorBaseline(
        results,
        survivorBaseline,
        options.baseline
      );
      printReport(points, results, options.confirmKills, baselineSummary);

      if (options.reporter === "github") {
        writeGitHubReport(points, results);
      }

      if (options.writeBaseline) {
        const incomplete = results.filter(
          (result) => ["inconclusive", "flaky"].includes(result.outcome)
        );
        if (incomplete.length > 0) {
          console.error(
            "authfault: survivor baseline was not written because the run contained inconclusive or flaky faults."
          );
          process.exitCode = 2;
        } else {
          writeSurvivorBaseline(
            options.writeBaseline,
            results,
            survivorBaseline
          );
          console.log(`\nWrote survivor baseline to ${options.writeBaseline}`);
        }
      }

      if (options.json) {
        writeFileSync(
          options.json,
          `${JSON.stringify({
            version: 1,
            configuration: { granularity: options.granularity },
            points,
            results,
            baseline: baselineSummary
          }, null, 2)}\n`,
          "utf8"
        );
      }

      if (
        process.exitCode !== 2 &&
        options.failOnSurvivor &&
        results.some(
          (result) => result.outcome === "survived" && !result.reviewed
        )
      ) {
        process.exitCode = 1;
      }
    }
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function failBaseline(message, result) {
  console.error(`authfault: ${message}.\n`);
  printProcessOutput(result);
  process.exitCode = 2;
}

function executeRun({ command, environment, label, options, trace, context = {} }) {
  const runEnvironment = {
    ...environment,
    AUTHFAULT_TRACE_FILE: undefined,
    AUTHFAULT_TRACE_DIR: undefined,
    AUTHFAULT_ALLOW_PRODUCTION: options.allowProduction ? "1" : undefined,
    AUTHFAULT_PHASE: context.phase ?? "baseline",
    AUTHFAULT_POINT_ID: context.pointId,
    AUTHFAULT_DECISION: context.decision,
    AUTHFAULT_OCCURRENCE: context.occurrence
  };

  let reset = null;
  if (options.resetCommand) {
    reset = run(options.resetCommand, runEnvironment, options.timeout);
    if (executionProblem(reset) || reset.status !== 0) {
      return { resetFailed: true, reset, result: null, events: [] };
    }
  }

  const traceDirectory = trace ? createTraceDirectory(label) : null;
  const result = run(
    command,
    {
      ...runEnvironment,
      AUTHFAULT_TRACE_DIR: traceDirectory
    },
    options.timeout
  );

  return {
    resetFailed: false,
    reset,
    result,
    events: traceDirectory ? readEvents(traceDirectory) : []
  };
}

function createTraceDirectory(label) {
  traceSequence += 1;
  const safeLabel = label.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const directory = join(temporaryDirectory, `${traceSequence}-${safeLabel}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function baseEnvironment() {
  return {
    ...process.env,
    AUTHFAULT_MUTATION: undefined,
    AUTHFAULT_SELECTED_TESTS: undefined,
    NODE_TEST_CONTEXT: undefined
  };
}

function mutationEnvironment(mutation, decision) {
  return {
    ...process.env,
    AUTHFAULT_MUTATION: decision
      ? JSON.stringify({
          id: mutation.id,
          decision,
          ...(mutation.occurrence
            ? { occurrence: mutation.occurrence }
            : {})
        })
      : undefined,
    AUTHFAULT_SELECTED_TESTS: mutation.targeted
      ? JSON.stringify(mutation.tests)
      : undefined,
    NODE_TEST_CONTEXT: undefined
  };
}

function parseOptions(optionArgs) {
  const parsed = {
    allowProduction: false,
    baseline: null,
    failOnSurvivor: false,
    confirmKills: 2,
    granularity: "point",
    json: null,
    maxMutants: Number.POSITIVE_INFINITY,
    resetCommand: null,
    reporter: "console",
    timeout: 30_000,
    verbose: false,
    writeBaseline: null
  };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    if (option === "--allow-production") {
      parsed.allowProduction = true;
    } else if (option === "--baseline") {
      parsed.baseline = requiredValue(optionArgs[++index], "--baseline");
    } else if (["--fail-on-survivor", "--fail-on-gap"].includes(option)) {
      parsed.failOnSurvivor = true;
    } else if (option === "--granularity") {
      parsed.granularity = requiredValue(optionArgs[++index], "--granularity");
      if (!["point", "occurrence"].includes(parsed.granularity)) {
        throw new Error("--granularity must be point or occurrence");
      }
    } else if (option === "--verbose") {
      parsed.verbose = true;
    } else if (option === "--confirm-kills") {
      parsed.confirmKills = positiveInteger(optionArgs[++index], "--confirm-kills");
    } else if (option === "--timeout") {
      parsed.timeout = positiveInteger(optionArgs[++index], "--timeout");
    } else if (option === "--json") {
      parsed.json = requiredValue(optionArgs[++index], "--json");
    } else if (option === "--max-mutants") {
      parsed.maxMutants = positiveInteger(optionArgs[++index], "--max-mutants");
    } else if (option === "--reset-command") {
      const encoded = requiredValue(optionArgs[++index], "--reset-command");
      try {
        parsed.resetCommand = JSON.parse(encoded);
      } catch (error) {
        throw new Error("--reset-command requires a JSON array of command arguments", {
          cause: error
        });
      }
      if (
        !Array.isArray(parsed.resetCommand) ||
        parsed.resetCommand.length === 0 ||
        parsed.resetCommand.some((item) => typeof item !== "string" || item === "")
      ) {
        throw new Error("--reset-command requires a non-empty JSON array of strings");
      }
    } else if (option === "--reporter") {
      parsed.reporter = requiredValue(optionArgs[++index], "--reporter");
      if (!["console", "github"].includes(parsed.reporter)) {
        throw new Error("--reporter must be console or github");
      }
    } else if (option === "--write-baseline") {
      parsed.writeBaseline = requiredValue(
        optionArgs[++index],
        "--write-baseline"
      );
    } else {
      throw new Error(`Unknown option: ${option}`);
    }
  }

  if (
    Number.isFinite(parsed.maxMutants) &&
    (parsed.baseline || parsed.writeBaseline)
  ) {
    throw new Error(
      "--max-mutants cannot be combined with survivor baseline options"
    );
  }

  return parsed;
}

function requiredValue(value, option) {
  if (!value) throw new Error(`${option} requires a value`);
  return value;
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return parsed;
}

function inconclusiveResult(mutation, reason, result) {
  return {
    ...mutation,
    outcome: "inconclusive",
    reason,
    attempts: [processAttempt("control", result)],
    possibleCompensatingControls: []
  };
}

function defaultTestCommand() {
  return [process.platform === "win32" ? "npm.cmd" : "npm", "test"];
}

function runDoctor() {
  console.log("AuthFault doctor\n");
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync("package.json", "utf8"));
    console.log("✓ package.json found");
  } catch {
    console.log("✗ package.json was not found or is invalid");
    return 1;
  }

  if (!packageJson.scripts?.test) {
    console.log("✗ package.json has no test script");
    return 1;
  }
  console.log(`✓ test command found: ${packageJson.scripts.test}`);

  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  const runner = dependencies.vitest
    ? "Vitest"
    : packageJson.scripts.test.includes("node --test")
      ? "node:test"
      : "custom test runner";
  console.log(`✓ test runner detected: ${runner}`);

  if (process.env.NODE_ENV === "production") {
    console.log("✗ refusing to run project tests with NODE_ENV=production");
    return 1;
  }

  const directory = mkdtempSync(join(tmpdir(), "authfault-doctor-"));
  try {
    const result = run(
      defaultTestCommand(),
      {
        ...baseEnvironment(),
        AUTHFAULT_TRACE_DIR: directory,
        AUTHFAULT_PHASE: "doctor"
      },
      30_000
    );

    if (executionProblem(result) || result.status !== 0) {
      console.log("✗ the existing test command did not pass");
      printProcessOutput(result);
      return 1;
    }
    console.log("✓ existing tests pass");

    const events = readEvents(directory);
    if (events.length === 0) {
      console.log("✗ no instrumented authorization decisions were observed");
      console.log("  Run npx authfault init for the wrapper example.");
      return 1;
    }

    const points = [...new Set(events.map((event) => event.id))];
    const attributed = events.filter((event) => event.testId).length;
    console.log(`✓ observed ${events.length} authorization decision(s) at ${points.length} point(s)`);
    if (attributed === events.length) {
      console.log("✓ every decision is attributed to a test");
    } else {
      console.log(`△ ${events.length - attributed} decision(s) are not attributed to a test; mutation runs may rerun the full suite`);
    }
    console.log("\nReady: run npx authfault");
    return 0;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function writeGitHubReport(points, results) {
  const summary = formatGitHubSummary(points, results);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
    console.log(`\nGitHub Actions summary written`);
  } else {
    console.log("\nauthfault: GITHUB_STEP_SUMMARY is not set; printing the GitHub summary locally.\n");
    console.log(summary);
  }
  for (const annotation of formatGitHubAnnotations(results)) {
    console.log(annotation);
  }
}

function printSetupGuide() {
  let packageJson = {};
  try {
    packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  } catch {
    // The guide remains useful before a package.json exists.
  }

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies
  };
  const runner = dependencies.vitest
    ? "Vitest"
    : packageJson.scripts?.test?.includes("node --test")
      ? "node:test"
      : "your existing test command";

  console.log(`AuthFault setup

Detected: ${runner}

1. Wrap the function that returns an authorization decision:

   import { instrumentAuthorizer } from "authfault";

   export const authorize = instrumentAuthorizer({
     id: "project.delete",
     authorize: realAuthorize
   });

2. Run your existing tests with authorization faults:

   npx authfault

AuthFault uses npm test by default. For another command, use:

   npx authfault -- <test command>`);
}

function printHelp() {
  console.log(`Usage:
  authfault
  authfault init
  authfault doctor
  authfault [options] -- <test command> [arguments]

With no command, AuthFault runs npm test.

Options:
  --fail-on-survivor    Exit 1 when one or more unreviewed faults survive
  --fail-on-gap         Alias for --fail-on-survivor
  --baseline <path>     Accept reviewed survivors from a baseline JSON file
  --write-baseline <path>
                        Write current survivors to a baseline JSON file
  --granularity <mode>  Mutation scope: point or occurrence (default: point)
  --confirm-kills <n>   Require n failing mutation runs (default: 2)
  --timeout <ms>        Timeout for each reset, control, or mutation run
  --reset-command <json-array>
                        Run a command before every test execution
  --allow-production    Override the NODE_ENV=production safety refusal
  --reporter <name>     Reporter: console or github (default: console)
  --json <path>         Write the machine-readable report to a JSON file
  --max-mutants <n>     Limit the number of mutation runs
  --verbose             Show output from failing runs
  --help                Show this help

Example:
  authfault
  authfault init
  authfault doctor
  authfault --reset-command '["npm","run","test:reset"]' -- node --test`);
}
