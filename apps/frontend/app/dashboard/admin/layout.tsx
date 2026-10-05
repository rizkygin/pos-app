import { AdminStepUpGuard } from '@/components/dashboard/admin-step-up-guard';

// Every admin page gets the password re-check prompt for risky actions (see
// AdminStepUpGuard). Access itself is decided by proxy.ts and the backend.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AdminStepUpGuard />
    </>
  );
}
