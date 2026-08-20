import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function readEvents(traceDirectory) {
  const files = readdirSync(traceDirectory)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const events = [];
  for (const file of files) {
    const contents = readFileSync(join(traceDirectory, file), "utf8");
    for (const line of contents.split("\n").filter(Boolean)) {
      events.push(JSON.parse(line));
    }
  }
  return events;
}
