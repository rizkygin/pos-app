"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export async function updateUserNameAction(name: string) {
    try {
        await auth.api.updateUser({
            headers: await headers(),
            body: { name },
        });
        revalidatePath("/dashboard/user");
        return { success: true, message: "Profile updated successfully." };
    } catch {
        return { success: false, message: "Failed to update profile." };
    }
}

export async function changePasswordAction(currentPassword: string, newPassword: string) {
    try {
        await auth.api.changePassword({
            headers: await headers(),
            body: { currentPassword, newPassword },
        });
        return { success: true, message: "Password changed successfully." };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("incorrect")) {
            return { success: false, message: "Current password is incorrect." };
        }
        return { success: false, message: "Failed to change password." };
    }
}

// Requires emailVerification.sendVerificationEmail to be configured in lib/auth.ts
export async function sendVerificationEmailAction(email: string) {
    try {
        await auth.api.sendVerificationEmail({
            headers: await headers(),
            body: { email },
        });
        return { success: true, message: "Verification email sent. Check your inbox." };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("VERIFICATION_EMAIL_NOT_ENABLED")) {
            return { success: false, message: "Email verification is not configured yet." };
        }
        return { success: false, message: "Failed to send verification email." };
    }
}

// Requires emailAndPassword.sendResetPassword to be configured in lib/auth.ts
export async function requestPasswordResetAction(email: string) {
    try {
        await auth.api.requestPasswordReset({
            headers: await headers(),
            body: { email, redirectTo: "/reset-password" },
        });
        return { success: true, message: "Password reset link sent. Check your inbox." };
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("RESET_PASSWORD_DISABLED")) {
            return { success: false, message: "Password reset is not configured yet." };
        }
        return { success: false, message: "Failed to send reset link." };
    }
}
