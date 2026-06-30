import { getSession } from "@/lib/auth";
import { getRole } from "@/lib/utils/get-role";
import Forbidden from "@/lib/forbidden";

// Owner-only gate for the whole /dashboard/invoice/* group. getSession() already
// redirects to "/" when there's no session; here we additionally require the
// owner role so couriers/customers/admins can't reach invoicing & stock.
export default async function InvoiceLayout({
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
