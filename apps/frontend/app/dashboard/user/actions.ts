import { authClient } from "@/lib/auth-client";

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
    const { error } = await authClient.sendVerificationEmail({ email });
    if (error) {
        const code = `${error.message ?? ""} ${error.code ?? ""}`;
        if (code.includes("VERIFICATION_EMAIL_NOT_ENABLED")) {
            return { success: false, message: "Email verification is not configured yet." };
        }
        return { success: false, message: "Failed to send verification email." };
    }
    return { success: true, message: "Verification email sent. Check your inbox." };
}

// Requires emailAndPassword.sendResetPassword to be configured in the backend auth
export async function requestPasswordResetAction(email: string) {
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    if (error) {
        const code = `${error.message ?? ""} ${error.code ?? ""}`;
        if (code.includes("RESET_PASSWORD_DISABLED")) {
            return { success: false, message: "Password reset is not configured yet." };
        }
        return { success: false, message: "Failed to send reset link." };
    }
    return { success: true, message: "Password reset link sent. Check your inbox." };
}
