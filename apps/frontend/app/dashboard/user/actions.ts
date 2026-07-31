import { authClient } from "@/lib/auth-client";
import { rateLimitMessage, readRetryAfter } from "@/lib/auth-email-cooldown";
import { API_URL } from "@/lib/api-url";

export type PhoneState = {
    phoneDisplay: string | null;
    canChange: boolean;
    nextChangeAt: string | null;
};

// Current number + whether the once-a-month change is available. Eligibility is
// decided by the backend, not recomputed here — the client shouldn't be the one
// deciding whether a rate limit has expired.
export async function getPhoneStateAction(): Promise<PhoneState | null> {
    try {
        const res = await fetch(`${API_URL}/api/me/phone`, { credentials: "include" });
        const json = await res.json();
        if (!res.ok || !json?.success) return null;
        return {
            phoneDisplay: json.phoneDisplay ?? null,
            canChange: Boolean(json.canChange),
            nextChangeAt: json.nextChangeAt ?? null,
        };
    } catch {
        return null;
    }
}

export async function updatePhoneAction(phone: string) {
    try {
        const res = await fetch(`${API_URL}/api/me/phone`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
            return {
                success: false,
                message: json?.error ?? "Gagal memperbarui nomor WhatsApp.",
                nextChangeAt: json?.nextChangeAt ?? null,
            };
        }
        return {
            success: true,
            message: "Nomor WhatsApp berhasil diperbarui.",
            phoneDisplay: json.phoneDisplay as string,
            nextChangeAt: json.nextChangeAt ?? null,
        };
    } catch {
        return { success: false, message: "Gagal terhubung ke server.", nextChangeAt: null };
    }
}

// These call the backend's better-auth endpoints via the shared auth client
// (baseURL = NEXT_PUBLIC_API_URL, credentials included). The client returns
// { data, error } rather than throwing.

export async function updateUserNameAction(name: string) {
    const { error } = await authClient.updateUser({ name });
    if (error) return { success: false, message: "Failed to update profile." };
    return { success: true, message: "Profile updated successfully." };
}

export async function changePasswordAction(currentPassword: string, newPassword: string) {
    const { error } = await authClient.changePassword({ currentPassword, newPassword });
    if (error) {
        const msg = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
        if (msg.includes("invalid") || msg.includes("incorrect")) {
            return { success: false, message: "Current password is incorrect." };
        }
        return { success: false, message: "Failed to change password." };
    }
    return { success: true, message: "Password changed successfully." };
}

// Requires emailVerification.sendVerificationEmail to be configured in the backend auth
export async function sendVerificationEmailAction(email: string) {
    let retryAfter = 0;
    const { error } = await authClient.sendVerificationEmail(
        { email },
        { onError: (ctx) => { retryAfter = readRetryAfter(ctx.response); } }
    );
    if (error) {
        if (error.status === 429) return { success: false, message: rateLimitMessage(retryAfter) };
        const code = `${error.message ?? ""} ${error.code ?? ""}`;
        if (code.includes("VERIFICATION_EMAIL_NOT_ENABLED")) {
            return { success: false, message: "Email verification is not configured yet." };
        }
        return { success: false, message: "Failed to send verification email." };
    }
    return { success: true, message: "Verification email sent. Check your inbox." };
}

// Requires emailAndPassword.sendResetPassword to be configured in the backend auth.
// No redirectTo — the backend pins the link's landing page to the frontend.
export async function requestPasswordResetAction(email: string) {
    let retryAfter = 0;
    const { error } = await authClient.requestPasswordReset(
        { email },
        { onError: (ctx) => { retryAfter = readRetryAfter(ctx.response); } }
    );
    if (error) {
        if (error.status === 429) return { success: false, message: rateLimitMessage(retryAfter) };
        const code = `${error.message ?? ""} ${error.code ?? ""}`;
        if (code.includes("RESET_PASSWORD_DISABLED")) {
            return { success: false, message: "Password reset is not configured yet." };
        }
        return { success: false, message: "Failed to send reset link." };
    }
    return { success: true, message: "Password reset link sent. Check your inbox." };
}
