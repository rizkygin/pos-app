import { getSession } from '@/lib/auth';
import { db } from '@/src/db';
import { adminsTable } from '@/src/db/schema';
import { eq } from 'drizzle-orm';
import Forbidden from '@/lib/forbidden';
import { Bike } from 'lucide-react';
import { CouriersTable } from './couriers-table';

const Page = async () => {
  const session = await getSession();
  if (!session) return <Forbidden />;

  const [admin] = await db
    .select({ id: adminsTable.id })
    .from(adminsTable)
    .where(eq(adminsTable.user_id, session.user.id))
    .limit(1);

  if (!admin) return <Forbidden />;

  return (
    <main className="px-4 mx-2 md:mx-6 pb-12 space-y-6">
      <div>
        <h1 className="text-2xl font-black flex items-center gap-2">
          <Bike className="h-6 w-6 text-orange-500" />
          Manage Courier
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Semua kurir yang terdaftar. Reset rating, jumlah ulasan, edit ulasan terakhir, atau hapus akun kurir.
        </p>
      </div>

      <CouriersTable />
    </main>
  );
};

export default Page;
