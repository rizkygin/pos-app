// Shared bits for the two flows that mail a link out (verify email, reset
// password). The backend rate-limits both at 3 per 5 minutes per IP and answers
// 429 + X-Retry-After; this keeps the client's own lockout well inside that
// budget so an honest user never actually sees the error.

export const EMAIL_COOLDOWN_SECONDS = 60;

export type EmailSendResult = {
    success: boolean;
    message: string;
    /** Seconds to keep the submit button locked. */
    cooldown: number;
};

/**
 * Seconds the backend says to wait. Readable only because CORS exposes
 * X-Retry-After (see apps/backend/src/server.ts); falls back to the local
 * cooldown if the header is missing.
 */
export function readRetryAfter(response: Response) {
    const seconds = Number(response.headers.get("X-Retry-After"));
    return seconds > 0 ? seconds : EMAIL_COOLDOWN_SECONDS;
}

export function rateLimitMessage(seconds: number) {
    return `Too many requests. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}
