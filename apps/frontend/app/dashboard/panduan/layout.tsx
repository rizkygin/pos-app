import { getSession } from "@/lib/auth";
import { getRole } from "@/lib/utils/get-role";
import Forbidden from "@/lib/forbidden";

// Gate for /dashboard/panduan/*: owners only, for now. Both current guides are
// about owner-only screens (the reports' HPP basis and the duplicate-order
// audit, which an employee must never reach), so an employee would only read
// about pages they cannot open. Widen this per guide when employee-facing ones
// are written, rather than all at once.
export default async function PanduanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await getSession();
  const role = await getRole();
  if (!role || role.role !== "owner") {
    return <Forbidden />;
  }

  return <>{children}</>;
}
