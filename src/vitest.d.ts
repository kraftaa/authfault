import type { TestContext, TestOptions } from "vitest";
import type { Awaitable } from "./index.js";

export function authfaultTest(
  name: string,
  testFunction: (context: TestContext) => Awaitable<unknown>,
  timeout?: number
): void;

export function authfaultTest(
  name: string,
  options: TestOptions,
  testFunction: (context: TestContext) => Awaitable<unknown>
): void;
