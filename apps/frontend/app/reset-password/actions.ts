import { authClient } from "@/lib/auth-client";

export async function resetPasswordAction(token: string, newPassword: string) {
    const { error } = await authClient.resetPassword({ token, newPassword });
    if (error) {
        const msg = `${error.message ?? ""} ${error.code ?? ""}`.toLowerCase();
        if (msg.includes("expired") || msg.includes("invalid")) {
            return { success: false, message: "This link has expired or is invalid. Request a new one." };
        }
        return { success: false, message: "Failed to reset password. Try again." };
    }
    return { success: true, message: "Password reset successfully. You can now sign in." };
}
