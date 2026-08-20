import { spawnSync } from "node:child_process";

export function run(command, environment, timeout) {
  const cleanedEnvironment = Object.fromEntries(
    Object.entries(environment).filter(([, value]) => value != null)
  );
  return spawnSync(command[0], command.slice(1), {
    env: cleanedEnvironment,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout
  });
}

export function executionProblem(result) {
  return !result || Boolean(result.error) || result.status === null;
}

export function describeExecutionProblem(result, phase) {
  if (result?.error?.code === "ETIMEDOUT") return `${phase} run timed out`;
  if (result?.signal) return `${phase} run terminated by ${result.signal}`;
  return `${phase} run could not be executed`;
}

export function processAttempt(kind, result) {
  return {
    kind,
    exitCode: result?.status ?? null,
    signal: result?.signal ?? null,
    error: result?.error?.code ?? null
  };
}

export function printProcessOutput(result) {
  if (result?.stdout) process.stderr.write(result.stdout);
  if (result?.stderr) process.stderr.write(result.stderr);
  if (result?.error) process.stderr.write(`${result.error.stack ?? result.error}\n`);
}
