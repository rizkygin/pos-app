import { redirect } from "next/navigation";

// /dashboard/invoice has no page of its own — land on Purchase (Phase 1 focus).
export default function InvoiceIndexPage() {
  redirect("/dashboard/invoice/purchase");
}
