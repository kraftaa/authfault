import { appendFileSync } from "node:fs";

const counterFile = process.env.AUTHFAULT_RESET_COUNTER;
if (!counterFile) {
  throw new Error("AUTHFAULT_RESET_COUNTER is required");
}

appendFileSync(
  counterFile,
  `${JSON.stringify({
    phase: process.env.AUTHFAULT_PHASE ?? null,
    pointId: process.env.AUTHFAULT_POINT_ID ?? null,
    decision: process.env.AUTHFAULT_DECISION ?? null
  })}\n`,
  "utf8"
);
