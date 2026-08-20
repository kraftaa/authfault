import type { TestContext, TestOptions } from "node:test";
import type { Awaitable } from "./index.js";

export function authfaultTest(
  name: string,
  testFunction: (context: TestContext) => Awaitable<unknown>
): Promise<void>;

export function authfaultTest(
  name: string,
  options: TestOptions,
  testFunction: (context: TestContext) => Awaitable<unknown>
): Promise<void>;
