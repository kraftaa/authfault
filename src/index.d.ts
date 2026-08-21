export type Awaitable<T> = T | PromiseLike<T>;

export interface DecisionCodecContext {
  readonly id: string;
  readonly args: readonly unknown[];
}

export interface DecisionCodec<Result> {
  read(
    result: Result,
    context: DecisionCodecContext
  ): boolean | undefined;
  write(
    result: Result,
    allowed: boolean,
    context: DecisionCodecContext
  ): Result;
}

export interface CedarEntityUid {
  type: string;
  id: string;
}

export interface CedarAuthorizationRequest {
  principal: CedarEntityUid;
  action?: CedarEntityUid;
  resource?: CedarEntityUid;
  context?: Record<string, unknown>;
}

export type CedarAuthorizationResult =
  | { type: "deny" }
  | {
      type: "allow";
      authorizerInfo: {
        principalUid: CedarEntityUid;
        determiningPolicies: string[];
      };
    }
  | { type: "error"; message: string };

export interface VerifiedPermissionsResult {
  decision: "ALLOW" | "DENY";
  determiningPolicies: Array<{ policyId: string }>;
  errors: Array<{ errorDescription: string }>;
  $metadata?: unknown;
}

export const decisionCodecs: Readonly<{
  cedar: Readonly<DecisionCodec<CedarAuthorizationResult>>;
  verifiedPermissions: Readonly<DecisionCodec<VerifiedPermissionsResult>>;
}>;

export interface DenialErrors {
  isDenied(error: unknown): boolean;
  createDenied(): Error;
}

export function instrumentAuthorizer<
  Args extends unknown[],
  Result extends boolean | { allowed: boolean }
>(options: {
  id: string;
  authorize(...args: Args): Awaitable<Result>;
  decisionCodec?: undefined;
  denialErrors?: undefined;
}): (...args: Args) => Promise<Result>;

export function instrumentAuthorizer<Args extends unknown[]>(options: {
  id: string;
  authorize(...args: Args): Awaitable<void>;
  denialErrors: DenialErrors;
  decisionCodec?: undefined;
}): (...args: Args) => Promise<void>;

export function instrumentAuthorizer<Args extends unknown[], Result>(options: {
  id: string;
  authorize(...args: Args): Awaitable<Result>;
  decisionCodec: DecisionCodec<Result>;
  denialErrors?: undefined;
}): (...args: Args) => Promise<Result>;

export interface OpenFgaCheckRequest {
  user: string;
  relation: string;
  object: string;
  context?: Record<string, unknown>;
  contextualTuples?: unknown;
}

export interface OpenFgaCheckResult {
  allowed: boolean;
  [key: string]: unknown;
}

export function instrumentOpenFgaClient<
  Client extends {
    check(...args: any[]): Awaitable<{ allowed: boolean }>;
  }
>(options: {
  client: Client;
  id?: string | ((request: Parameters<Client["check"]>[0]) => string);
}): Client;

export function authfaultOperation<Result>(
  name: string,
  callback: () => Result
): Result;

export const environment: Readonly<{
  mutation: "AUTHFAULT_MUTATION";
  traceFile: "AUTHFAULT_TRACE_FILE";
  traceDirectory: "AUTHFAULT_TRACE_DIR";
  allowProduction: "AUTHFAULT_ALLOW_PRODUCTION";
  selectedTests: "AUTHFAULT_SELECTED_TESTS";
}>;
