import type http from "node:http";

export const MAX_JSON_BODY_BYTES = 64 * 1024;
export const JSON_BODY_TIMEOUT_MS = 10_000;

export class JsonBodyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "JsonBodyError";
  }
}

/** Bound bytes before decoding UTF-8; a declared length never replaces the streaming check. */
export function readJsonBody(req: http.IncomingMessage, options: { maxBytes?: number; timeoutMs?: number } = {}): Promise<Record<string, unknown> | null> {
  const maxBytes = options.maxBytes ?? MAX_JSON_BODY_BYTES;
  const timeoutMs = options.timeoutMs ?? JSON_BODY_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_JSON_BODY_BYTES ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > JSON_BODY_TIMEOUT_MS) throw new Error("Invalid JSON body limits");
  return new Promise((resolve, reject) => {
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAborted);
      req.off("close", onClose);
      // Keep the error listener until close: a peer may reset after a 413.
    };
    const fail = (error: JsonBodyError): void => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.pause();
      cleanup();
      reject(error);
    };
    const onError = (): void => fail(new JsonBodyError(400, "REQUEST_ABORTED", "request body was interrupted"));
    const onAborted = (): void => onError();
    const onClose = (): void => {
      if (!settled) onError();
      req.off("error", onError);
    };
    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
      bytes += buffer.length;
      if (bytes > maxBytes) {
        fail(new JsonBodyError(413, "BODY_TOO_LARGE", `JSON body must not exceed ${maxBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      req.off("error", onError);
      try {
        const body = Buffer.concat(chunks, bytes).toString("utf8");
        const parsed: unknown = JSON.parse(body || "{}");
        resolve(typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? parsed as Record<string, unknown> : null);
      } catch {
        resolve(null);
      } finally {
        chunks.length = 0;
      }
    };

    req.on("error", onError);
    req.once("close", () => req.off("error", onError));
    const declared = req.headers["content-length"];
    if (typeof declared === "string" && /^\d+$/.test(declared) && BigInt(declared) > BigInt(maxBytes)) {
      fail(new JsonBodyError(413, "BODY_TOO_LARGE", `JSON body must not exceed ${maxBytes} bytes`));
      return;
    }
    if (req.aborted || req.destroyed) {
      onError();
      return;
    }
    req.on("data", onData);
    req.once("end", onEnd);
    req.once("aborted", onAborted);
    req.once("close", onClose);
    timer = setTimeout(() => fail(new JsonBodyError(408, "BODY_TIMEOUT", "request body timed out")), timeoutMs);
    timer.unref();
  });
}
