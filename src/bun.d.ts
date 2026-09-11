import type { Awaitable } from "./index.js";

type DoneCallback = (error?: unknown) => void;

export function authfaultTest(
  name: string,
  testFunction: (() => Awaitable<unknown>) | ((done: DoneCallback) => void),
  timeout?: number
): void;
