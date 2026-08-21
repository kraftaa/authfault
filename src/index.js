import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  currentTestId,
  nextDecisionOccurrence,
  selectedTestsEnvironmentVariable
} from "./test-context.js";
import { authfaultOperation, currentOperation } from "./operation-context.js";

const MUTATION_ENV = "AUTHFAULT_MUTATION";
const TRACE_ENV = "AUTHFAULT_TRACE_FILE";
const TRACE_DIR_ENV = "AUTHFAULT_TRACE_DIR";
const ALLOW_PRODUCTION_ENV = "AUTHFAULT_ALLOW_PRODUCTION";

export { authfaultOperation };

export const decisionCodecs = Object.freeze({
  cedar: Object.freeze({
    read(result, { id }) {
      assertObjectResult(result, id, "a Cedar authorization result");
      if (result.type === "allow") return true;
      if (result.type === "deny") return false;
      if (result.type === "error") return undefined;
      throw new TypeError(
        `Authorizer ${JSON.stringify(id)} returned an unknown Cedar result type`
      );
    },
    write(_result, allowed, { args, id }) {
      if (!allowed) return { type: "deny" };

      const principalUid = args[0]?.principal;
      if (
        principalUid === null ||
        typeof principalUid !== "object" ||
        typeof principalUid.type !== "string" ||
        typeof principalUid.id !== "string"
      ) {
        throw new TypeError(
          `Cedar authorizer ${JSON.stringify(id)} requires request.principal to inject an allow result`
        );
      }

      return {
        type: "allow",
        authorizerInfo: {
          principalUid,
          determiningPolicies: []
        }
      };
    }
  }),
  verifiedPermissions: Object.freeze({
    read(result, { id }) {
      assertObjectResult(result, id, "a Verified Permissions result");
      if (result.decision === "ALLOW") return true;
      if (result.decision === "DENY") return false;
      throw new TypeError(
        `Authorizer ${JSON.stringify(id)} must return decision ALLOW or DENY`
      );
    },
    write(result, allowed) {
      return {
        ...result,
        decision: allowed ? "ALLOW" : "DENY",
        determiningPolicies: []
      };
    }
  })
});

/**
 * Instrument an authorization function so authfault can trace and mutate its
 * decisions during test runs.
 *
 * By default, the wrapped function returns a boolean or an object containing
 * an `allowed` boolean. Structured results use a decision codec; throw-on-deny
 * guards use explicit denial error classification.
 */
export function instrumentAuthorizer({
  id,
  authorize,
  denialErrors,
  decisionCodec
}) {
  if (typeof id !== "string" || id.trim() === "") {
    throw new TypeError("instrumentAuthorizer requires a non-empty string id");
  }

  if (typeof authorize !== "function") {
    throw new TypeError("instrumentAuthorizer requires an authorize function");
  }

  validateDenialErrors(denialErrors);
  validateDecisionCodec(decisionCodec);
  if (denialErrors && decisionCodec) {
    throw new TypeError(
      "instrumentAuthorizer cannot combine denialErrors with decisionCodec"
    );
  }

  const pointId = id.trim();
  const codec = decisionCodec ?? defaultDecisionCodec;

  return async function instrumentedAuthorizer(...args) {
    const mutation = readMutation();
    const occurrence = nextDecisionOccurrence(pointId);
    const applies =
      mutation?.id === pointId &&
      (mutation.occurrence === undefined || mutation.occurrence === occurrence);

    let originalResult;
    try {
      originalResult = await authorize(...args);
    } catch (error) {
      if (!denialErrors?.isDenied(error)) {
        throw error;
      }

      const effectiveAllowed = applies
        ? mutation.decision === "allow"
        : false;

      recordDecision({
        id: pointId,
        originalAllowed: false,
        effectiveAllowed,
        mutation: applies ? mutation.decision : null,
        occurrence
      });

      if (effectiveAllowed) {
        return undefined;
      }
      throw error;
    }

    const guardStyle = originalResult === undefined && denialErrors;
    const codecContext = { id: pointId, args };
    const originalAllowed = guardStyle
      ? true
      : readCodecDecision(codec, originalResult, codecContext);
    if (originalAllowed === undefined) {
      return originalResult;
    }
    const effectiveAllowed = applies
      ? mutation.decision === "allow"
      : originalAllowed;

    recordDecision({
      id: pointId,
      originalAllowed,
      effectiveAllowed,
      mutation: applies ? mutation.decision : null,
      occurrence
    });

    if (guardStyle) {
      if (!effectiveAllowed) {
        const error = denialErrors.createDenied();
        if (!(error instanceof Error)) {
          throw new TypeError("denialErrors.createDenied must return an Error");
        }
        throw error;
      }
      return undefined;
    }

    return applies
      ? codec.write(originalResult, effectiveAllowed, codecContext)
      : originalResult;
  };
}

/**
 * Instrument one reusable OpenFGA client without changing its check call sites.
 * Only `check` is wrapped; every other method is forwarded to the original
 * client with its receiver preserved.
 */
export function instrumentOpenFgaClient({ client, id }) {
  if (
    client === null ||
    (typeof client !== "object" && typeof client !== "function") ||
    typeof client.check !== "function"
  ) {
    throw new TypeError(
      "instrumentOpenFgaClient requires a client with a check function"
    );
  }
  if (id !== undefined && typeof id !== "string" && typeof id !== "function") {
    throw new TypeError(
      "instrumentOpenFgaClient id must be a non-empty string or a request resolver"
    );
  }
  if (typeof id === "string" && id.trim() === "") {
    throw new TypeError(
      "instrumentOpenFgaClient id must be a non-empty string or a request resolver"
    );
  }

  const originalCheck = client.check;
  const instrumentedChecks = new Map();
  const boundMethods = new Map();
  const resolveId = typeof id === "function"
    ? id
    : typeof id === "string"
      ? () => id.trim()
      : defaultOpenFgaPointId;

  const check = async (...args) => {
    const pointId = resolveId(args[0]);
    if (typeof pointId !== "string" || pointId.trim() === "") {
      throw new TypeError(
        "instrumentOpenFgaClient id resolver must return a non-empty string"
      );
    }

    const normalizedId = pointId.trim();
    let instrumented = instrumentedChecks.get(normalizedId);
    if (!instrumented) {
      instrumented = instrumentAuthorizer({
        id: normalizedId,
        authorize: (...checkArgs) => Reflect.apply(originalCheck, client, checkArgs)
      });
      instrumentedChecks.set(normalizedId, instrumented);
    }
    return instrumented(...args);
  };

  return new Proxy(client, {
    get(target, property) {
      if (property === "check") return check;

      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (!boundMethods.has(property)) {
        boundMethods.set(property, value.bind(target));
      }
      return boundMethods.get(property);
    }
  });
}

function defaultOpenFgaPointId(request) {
  if (
    request === null ||
    typeof request !== "object" ||
    typeof request.object !== "string" ||
    request.object.trim() === "" ||
    typeof request.relation !== "string" ||
    request.relation.trim() === ""
  ) {
    throw new TypeError(
      "OpenFGA check requests require non-empty object and relation strings"
    );
  }

  const objectType = request.object.split(":", 1)[0];
  return `openfga.${sanitizePointIdPart(objectType)}.${sanitizePointIdPart(request.relation)}`;
}

function sanitizePointIdPart(value) {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

const defaultDecisionCodec = Object.freeze({
  read: (result, { id }) => readAllowed(result, id),
  write: writeAllowed
});

function validateDenialErrors(denialErrors) {
  if (denialErrors === undefined) {
    return;
  }

  if (
    denialErrors === null ||
    typeof denialErrors !== "object" ||
    typeof denialErrors.isDenied !== "function" ||
    typeof denialErrors.createDenied !== "function"
  ) {
    throw new TypeError(
      "denialErrors must provide isDenied(error) and createDenied() functions"
    );
  }
}

function validateDecisionCodec(decisionCodec) {
  if (decisionCodec === undefined) return;
  if (
    decisionCodec === null ||
    typeof decisionCodec !== "object" ||
    typeof decisionCodec.read !== "function" ||
    typeof decisionCodec.write !== "function"
  ) {
    throw new TypeError(
      "decisionCodec must provide read(result, context) and write(result, allowed, context) functions"
    );
  }
}

function readCodecDecision(codec, result, context) {
  const decision = codec.read(result, context);
  if (decision === true || decision === false || decision === undefined) {
    return decision;
  }
  throw new TypeError(
    `Decision codec for ${JSON.stringify(context.id)} must return true, false, or undefined`
  );
}

function assertObjectResult(result, id, expected) {
  if (result === null || typeof result !== "object") {
    throw new TypeError(
      `Authorizer ${JSON.stringify(id)} must return ${expected}`
    );
  }
}

function readAllowed(result, id) {
  if (typeof result === "boolean") {
    return result;
  }

  if (
    result !== null &&
    typeof result === "object" &&
    typeof result.allowed === "boolean"
  ) {
    return result.allowed;
  }

  throw new TypeError(
    `Authorizer ${JSON.stringify(id)} must return a boolean or { allowed: boolean }`
  );
}

function writeAllowed(result, allowed) {
  if (typeof result === "boolean") {
    return allowed;
  }

  return { ...result, allowed };
}

function readMutation() {
  const value = process.env[MUTATION_ENV];
  if (!value) {
    return null;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env[ALLOW_PRODUCTION_ENV] !== "1"
  ) {
    throw new Error(
      "authfault refuses to apply mutations with NODE_ENV=production"
    );
  }

  let mutation;
  try {
    mutation = JSON.parse(value);
  } catch (error) {
    throw new Error(`${MUTATION_ENV} must contain valid JSON`, { cause: error });
  }

  if (
    mutation === null ||
    typeof mutation !== "object" ||
    typeof mutation.id !== "string" ||
    !["allow", "deny"].includes(mutation.decision) ||
    (
      mutation.occurrence !== undefined &&
      (!Number.isInteger(mutation.occurrence) || mutation.occurrence < 1)
    )
  ) {
    throw new Error(
      `${MUTATION_ENV} must contain id, allow|deny decision, and an optional positive occurrence`
    );
  }

  return mutation;
}

function recordDecision(event) {
  const traceDirectory = process.env[TRACE_DIR_ENV];
  const traceFile = traceDirectory
    ? join(traceDirectory, `${process.pid}.jsonl`)
    : process.env[TRACE_ENV];
  if (!traceFile) {
    return;
  }

  mkdirSync(dirname(traceFile), { recursive: true });
  const operation = currentOperation();
  appendFileSync(
    traceFile,
    `${JSON.stringify({
      version: 1,
      pid: process.pid,
      testId: currentTestId(),
      operationName: operation?.operationName ?? null,
      operationId: operation?.operationId ?? null,
      ...event
    })}\n`,
    "utf8"
  );
}

export const environment = Object.freeze({
  mutation: MUTATION_ENV,
  traceFile: TRACE_ENV,
  traceDirectory: TRACE_DIR_ENV,
  allowProduction: ALLOW_PRODUCTION_ENV,
  selectedTests: selectedTestsEnvironmentVariable
});
