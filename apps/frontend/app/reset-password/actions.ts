"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function resetPasswordAction(token: string, newPassword: string) {
    try {
        await auth.api.resetPassword({
            headers: await headers(),
            body: { token, newPassword },
        });
        return { success: true, message: "Password reset successfully. You can now sign in." };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("invalid")) {
            return { success: false, message: "This link has expired or is invalid. Request a new one." };
        }
        return { success: false, message: "Failed to reset password. Try again." };
    }
}
