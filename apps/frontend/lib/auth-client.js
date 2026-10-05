import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
    baseURL: process.env.NEXT_PUBLIC_API_URL,
    fetchOptions: {
        credentials: "include",
    },
    // authClient.twoFactor.*. No onTwoFactorRedirect: the login page reads
    // `data.twoFactorRedirect` itself and asks for the code in place.
    plugins: [twoFactorClient()],
})

export const {
    signIn,
    signUp,
    signOut,
    useSession,
    useUser,
    useAuth
} = authClient

