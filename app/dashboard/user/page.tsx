import { getSession } from "@/lib/auth";
import { UserSetting } from "@/components/dashboard/user-setting";

export default async function UserPage() {
    const session = await getSession();

    return (
        <UserSetting
            user={{
                name: session.user.name,
                email: session.user.email,
                image: session.user.image ?? null,
                emailVerified: session.user.emailVerified,
            }}
        />
    );
}
