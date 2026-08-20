import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage();
let operationSequence = 0;

export function authfaultOperation(name, callback) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new TypeError("authfaultOperation requires a non-empty string name");
  }
  if (typeof callback !== "function") {
    throw new TypeError("authfaultOperation requires a callback");
  }

  operationSequence += 1;
  return storage.run(
    {
      operationName: name.trim(),
      operationId: `${process.pid}:${operationSequence}`
    },
    callback
  );
}

export function currentOperation() {
  return storage.getStore() ?? null;
}
