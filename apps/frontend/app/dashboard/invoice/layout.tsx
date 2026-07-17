import { getSession } from "@/lib/auth";
import { getRole } from "@/lib/utils/get-role";
import Forbidden from "@/lib/forbidden";

// Gate for the whole /dashboard/invoice/* group: the owner, or an employee
// holding at least one invoice-suite permission (each page's API still
// enforces its own specific permission). getSession() already redirects to
// /login when there's no session.
export default async function InvoiceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await getSession();
  const role = await getRole();
  const employeePerms =
    role && role.role === "employee"
      ? ((role.data?.permissions as Record<string, boolean>) ?? {})
      : null;
  const employeeAllowed =
    !!employeePerms &&
    ["salesInvoice", "purchaseInvoice", "stock", "reports"].some(
      (p) => employeePerms[p] === true,
    );
  if (!role || (role.role !== "owner" && !employeeAllowed)) {
    return <Forbidden />;
  }

  return <>{children}</>;
}
