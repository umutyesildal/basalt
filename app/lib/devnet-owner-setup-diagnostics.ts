import type { OwnerSetupProgress, OwnerSetupReceipt } from "./devnet-owner-setup";

export type OwnerSetupAttemptKind = "handoff" | "setup";
export type OwnerSetupAttemptStatus = "in-progress" | "failed";
export interface OwnerSetupDiagnostic {
  version: 1;
  kind: OwnerSetupAttemptKind;
  stage: OwnerSetupProgress;
  status: OwnerSetupAttemptStatus;
  at: string;
  message: string;
}
interface DiagnosticStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const stages = ["checking", "simulating", "signing", "confirming"] as const;
const MAX_BYTES = 1_024;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const OWNER_SETUP_PENDING_MESSAGE = "A transaction may have been submitted. Refresh its saved signature; no automatic resend will occur.";
const finalizedFailure = "The transaction finalized with an error. Refresh and review the remaining actions.";
const progressMessages: Record<OwnerSetupProgress, string> = {
  checking: "The last attempt reached finalized account verification. Refresh finalized status before reviewing another transaction.",
  simulating: "The last attempt reached transaction simulation. Refresh finalized status before reviewing another transaction.",
  signing: "The last attempt reached the wallet signature step. Refresh the saved transaction status before starting again.",
  confirming: OWNER_SETUP_PENDING_MESSAGE,
};
const fallbackMessages: Record<OwnerSetupProgress, string> = {
  checking: "Setup stopped while verifying finalized accounts. Nothing was broadcast. Refresh and review the current setup.",
  simulating: "Setup stopped while simulating the transaction. Nothing was broadcast. Refresh and review the current setup.",
  signing: "Setup stopped while requesting your wallet signature. Nothing was broadcast. Refresh and review the current setup.",
  confirming: "Setup stopped while preparing the broadcast. Nothing was broadcast. Refresh and review the current setup.",
};
// Only fixed source-authored public text is stored. Wallet/RPC payloads, arbitrary
// Error.message values, transaction bytes and signatures never enter this record.
const publicFailures = new Set([
  ...Object.values(fallbackMessages), OWNER_SETUP_PENDING_MESSAGE, finalizedFailure,
  "The devnet setup does not match the reviewed public identities.",
  "Invalid public identity.",
  "Devnet verification timed out. Refresh the finalized status.",
  "Deployed program slot or padding changed. Stop for a fresh code review.",
  "Deployed program bytes differ from the reviewed release.",
  "Connect the designated owner wallet to review devnet setup.",
  "Review this devnet setup step again before signing.",
  "Owner setup is available on Solana devnet only.",
  "The public handoff file is too large.",
  "Choose the public handoff JSON file.",
  "Unexpected fields in the public handoff file.",
  "The handoff transaction contains an unreviewed instruction or account.",
  "The bootstrap signature is missing or invalid.",
  "The public transaction encoding is not canonical.",
  "Program ownership already changed. Refresh finalized status; do not resend the package.",
  "The handoff nonce account is not initialized in its current format.",
  "This handoff nonce changed or was already used. Obtain a freshly reviewed package.",
  "The bootstrap fee payer needs devnet SOL.",
  "The three program authorities disagree. Setup requires manual review.",
  "Unexpected whitelist ownership. Setup requires manual review.",
  "Factory authority or treasury differs from the owner-first setup.",
  "A fixed devnet test mint changed. Review its configuration before admission.",
  "A test-token admission differs from the fixed setup.",
  "Whitelist count differs from the four reviewed test-token admissions.",
  "The treasury recipient has not been recorded in reviewed source yet.",
  "Only the four reviewed test tokens may be admitted.",
  "Accept ownership of all three programs first.",
  "The bootstrap administrator must propose the existing whitelist handoff first.",
  "The reviewed setup does not fit a bounded transaction.",
  "The setup rent or network fee exceeds the reviewed limit.",
  "The owner wallet needs more devnet SOL for account rent and fees.",
  "The setup transaction expired before it was sent. Review the current setup to prepare a fresh transaction.",
  "Devnet is busy. The setup was not sent. Refresh the finalized status before reviewing again.",
  "The wallet request was declined. The setup was not sent.",
  "The devnet connection did not respond. The setup was not sent.",
  "The reviewed devnet transaction did not pass simulation. No transaction was sent.",
  "The wallet did not return a serialized transaction. Nothing was broadcast.",
  "The wallet did not return transaction bytes. Nothing was broadcast.",
  "The wallet returned an invalid transaction size. Nothing was broadcast.",
  "The wallet transaction could not be serialized. Nothing was broadcast.",
  "The wallet returned noncanonical transaction bytes. Nothing was broadcast.",
  "The wallet did not return a valid legacy transaction. Nothing was broadcast.",
  "The wallet changed the reviewed compute budget. Nothing was broadcast.",
  "The wallet changed the reviewed blockhash. Nothing was broadcast.",
  "The wallet changed the reviewed fee payer. Nothing was broadcast.",
  "The wallet changed the reviewed transaction accounts. Nothing was broadcast.",
  "The wallet changed the reviewed program instructions. Nothing was broadcast.",
  "The wallet did not provide the exact required signatures.",
  "The bootstrap signature changed. Nothing was broadcast.",
  "The wallet mutated the reviewed transaction.",
  "RPC returned an unexpected signature. Reconcile the saved transaction.",
  "The checked handoff network fee exceeds its reviewed limit.",
  "Finalized setup changed. Refresh and review the remaining actions.",
  "The reviewed setup actions or spending changed. Review the updated costs before signing.",
  "The reviewed devnet setup is already complete.",
]);
const fields = ["at", "kind", "message", "stage", "status", "version"];
export const ownerSetupDiagnosticStorageKey = (owner: string) => `basalt:devnet-owner-diagnostic:v1:${owner}`;

export function createOwnerSetupDiagnostic(kind: OwnerSetupAttemptKind, stage: OwnerSetupProgress, status: OwnerSetupAttemptStatus, message?: unknown, now = Date.now()): OwnerSetupDiagnostic {
  if (!["handoff", "setup"].includes(kind) || !stages.includes(stage) || !["in-progress", "failed"].includes(status) || !Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error("Invalid public setup diagnostic metadata.");
  return { version: 1, kind, stage, status, at: new Date(now).toISOString(), message: status === "in-progress" ? progressMessages[stage] : typeof message === "string" && publicFailures.has(message) ? message : fallbackMessages[stage] };
}
function valid(value: unknown, now: number): value is OwnerSetupDiagnostic {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== fields.join()) return false;
  const entry = value as OwnerSetupDiagnostic;
  if (entry.version !== 1 || !["handoff", "setup"].includes(entry.kind) || !stages.includes(entry.stage) || !["in-progress", "failed"].includes(entry.status) || typeof entry.at !== "string" || typeof entry.message !== "string" || entry.message.length > 256) return false;
  const at = Date.parse(entry.at);
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(at) || at < 0 || at > now + 60_000 || at < now - MAX_AGE_MS || new Date(at).toISOString() !== entry.at) return false;
  return entry.status === "in-progress" ? entry.message === progressMessages[entry.stage] : publicFailures.has(entry.message);
}
export function readOwnerSetupDiagnostic(storage: Pick<DiagnosticStorage, "getItem">, key: string, now = Date.now()): OwnerSetupDiagnostic | null {
  try {
    const raw = storage.getItem(key);
    if (!raw || raw.length > MAX_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value, now) ? value : null;
  } catch { return null; }
}
export function saveOwnerSetupDiagnostic(storage: Pick<DiagnosticStorage, "setItem">, key: string, diagnostic: OwnerSetupDiagnostic, now = Date.now()): boolean {
  try {
    if (!valid(diagnostic, now)) return false;
    const raw = JSON.stringify(diagnostic);
    if (raw.length > MAX_BYTES) return false;
    storage.setItem(key, raw);
    return true;
  } catch { return false; }
}
export function clearOwnerSetupDiagnostic(storage: Pick<DiagnosticStorage, "removeItem">, key: string): boolean {
  try { storage.removeItem(key); return true; } catch { return false; }
}
/** Pending/finalized receipts dominate; terminal errors apply only after onPrepared. */
export function ownerSetupDiagnosticMessage(diagnostic: OwnerSetupDiagnostic, receipt?: Pick<OwnerSetupReceipt, "status">): string | null {
  if (receipt?.status === "prepared") return OWNER_SETUP_PENDING_MESSAGE;
  if (receipt?.status === "finalized") return null;
  if (diagnostic.stage === "confirming" && receipt?.status === "failed") return finalizedFailure;
  if (diagnostic.stage === "confirming" && receipt?.status === "expired") return "The saved transaction expired. Refresh finalized status and review the remaining actions.";
  return diagnostic.message;
}
