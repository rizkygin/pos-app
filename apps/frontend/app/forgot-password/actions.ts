import { authClient } from "@/lib/auth-client";
import {
    EMAIL_COOLDOWN_SECONDS,
    rateLimitMessage,
    readRetryAfter,
    type EmailSendResult,
} from "@/lib/auth-email-cooldown";

export async function requestResetLinkAction(email: string): Promise<EmailSendResult> {
    let retryAfter = 0;
    // No redirectTo: the backend pins the link's landing page to the frontend
    // /reset-password itself, since a relative one resolves against the API host.
    const { error } = await authClient.requestPasswordReset(
        { email },
        { onError: (ctx) => { retryAfter = readRetryAfter(ctx.response); } }
    );

    if (error) {
        if (error.status === 429) {
            return { success: false, message: rateLimitMessage(retryAfter), cooldown: retryAfter };
        }
        const msg = `${error.message ?? ""} ${error.code ?? ""}`;
        if (msg.includes("RESET_PASSWORD_DISABLED")) {
            return { success: false, message: "Password reset is not configured yet.", cooldown: 0 };
        }
        return { success: false, message: "Could not send the link. Try again in a moment.", cooldown: 0 };
    }

    // Answers identically for addresses that don't exist, so the wording can't
    // be used to confirm whether someone has an account here.
    return {
        success: true,
        message: "If an account uses that address, a reset link is on its way.",
        cooldown: EMAIL_COOLDOWN_SECONDS,
    };
}
