import { authClient } from "@/lib/auth-client";
import {
    EMAIL_COOLDOWN_SECONDS,
    rateLimitMessage,
    readRetryAfter,
    type EmailSendResult,
} from "@/lib/auth-email-cooldown";

export async function resendVerificationAction(email: string): Promise<EmailSendResult> {
    let retryAfter = 0;
    const { error } = await authClient.sendVerificationEmail(
        { email },
        { onError: (ctx) => { retryAfter = readRetryAfter(ctx.response); } }
    );

    if (error) {
        if (error.status === 429) {
            return { success: false, message: rateLimitMessage(retryAfter), cooldown: retryAfter };
        }
        const msg = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
        if (msg.includes("already verified")) {
            return { success: false, message: "This email is already verified. You can sign in.", cooldown: 0 };
        }
        return { success: false, message: "Could not send the email. Try again in a moment.", cooldown: 0 };
    }

    // The endpoint answers the same way for unknown / already-verified addresses
    // (deliberately, so it can't be used to probe which emails exist), so the
    // copy stays vague about whether anything was actually sent.
    return {
        success: true,
        message: "If that address needs verifying, a new link is on its way.",
        cooldown: EMAIL_COOLDOWN_SECONDS,
    };
}
