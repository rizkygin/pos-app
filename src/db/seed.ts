import { auth } from '@/lib/auth';
import { db } from './index';
import {
  customersTable,
  outletsTable,
  couriersTable,
  productsTable,
  adminsTable,
  productAdsTable,
} from './schema';
import { eq, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  cashInCategoryTable,
  cashOutCategoryTable,
  scheduleProductAdsTable,
} from './schema';
import { CATEGORY_IN, CATEGORY_OUT } from '@/lib/cashflow-categories';
import { email } from 'zod';

const main = async () => {
  // Load env variables
  const hashPassword = '12345678';

  const usersToSeed = [
    {
      name: 'Admin',
      email: 'rizkygin@gmail.com',
      password: hashPassword,
    },
    {
      name: 'Pelanggan Offline',
      email: 'rizkygin1@gmail.com',
      password: hashPassword,
    },
    {
      name: 'owner_test',
      email: 'rizkygin2@gmail.com',
      password: hashPassword,
    },
    {
      name: 'courier_test',
      email: 'rizkygin3@gmail.com',
      password: hashPassword,
    },
    {
      name: 'Rizky Online',
      email: 'rizkygin4@gmail.com',
      password: hashPassword,
    },
  ];

  // let outlet: typeof outletsTable.$inferSelect;
  for (const user of usersToSeed) {
    console.log(`Seeding ${user.name}...`);
    try {
      const res = await auth.api.signUpEmail({
        body: {
          email: user.email,
          password: user.password,
          name: user.name,
        },
      });
      if (user.name === 'Admin') {
        await db.insert(adminsTable).values({
          user_id: res.user.id,
          email: user.email,
          name: 'Admin Rizky',
        });
      }

      if (user.name === 'Pelanggan Offline' || user.name === 'Rizky Online') {
        await db.insert(customersTable).values({
          user_id: res.user.id,
        });
      } else if (user.name === 'owner_test') {
        await db.insert(outletsTable).values({
          name: `${user.name}'s Resto`,
          avatar:
            'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&auto=format&fit=crop&q=60',
          phone: '08123456789',
          email: res.user.email,
          address: 'Jakarta, Indonesia',
          user_id: res.user.id,
          lat: '-3.3199',
          lon: '114.5907',
        });
        await addProductstoOutlets(res.user.id);
      } else if (user.name === 'courier_test') {
        await db.insert(couriersTable).values({
          user_id: res.user.id,
          vehicle_plate: 'B 1234 CDE',
          vehicle_type: 'motorcycle',
        });
      }

      console.log(`Successfully seeded ${user.name}`);
    } catch (e: any) {
      if (e.message?.includes('already exists') || e.status === 422) {
        console.log(`User ${user.name} already exists, skipping.`);
      } else {
        console.error(`Failed to seed ${user.name}:`, e);
      }
    }
  }

  seedCategories();
  await seedScheduleProductAds();
};

const addProductstoOutlets = async (user_id: string) => {
  const outlet = await db.query.outletsTable.findFirst({
    where: eq(outletsTable.user_id, user_id),
  });
  if (!outlet) {
    throw new Error(`Outlet not found for user ${user_id}`);
  }

  const productsToSeed = [
    {
      id: crypto.randomUUID(),
      product_name: 'Cappuccino',
      price: '250000',
      price_mark_down: '10000',
      outlet_id: outlet.id,
      description:
        'A classic coffee drink made with espresso and steamed milk.',
      unit: 'pcs',
      category: 'minuman',
    },
    {
      id: crypto.randomUUID(),
      product_name: 'Latte',
      price: '250000',
      price_mark_down: '10000',
      outlet_id: outlet.id,
      description:
        'A classic coffee drink made with espresso and steamed milk.',
      unit: 'pcs',
      category: 'minuman',
    },
    {
      id: crypto.randomUUID(),
      product_name: 'Espresso',
      price: '250000',
      price_mark_down: '10000',
      outlet_id: outlet.id,
      description:
        'A classic coffee drink made with espresso and steamed milk.',
      unit: 'pcs',
      category: 'minuman',
    },
    {
      id: crypto.randomUUID(),
      product_name: 'Americano',
      price: '250000',
      price_mark_down: '10000',
      outlet_id: outlet.id,
      description:
        'A classic coffee drink made with espresso and steamed milk.',
      unit: 'pcs',
      category: 'minuman',
    },
    {
      id: crypto.randomUUID(),
      product_name: 'Flat White',
      price: '250000',
      price_mark_down: '10000',
      outlet_id: outlet.id,
      description:
        'A classic coffee drink made with espresso and steamed milk.',
      unit: 'pcs',
      category: 'minuman',
    },
    {
      id: crypto.randomUUID(),
      product_name: 'Mix Platter',
      price: '250000',
      price_mark_down: '10000',
      outlet_id: outlet.id,
      description: 'combined snack of all in 1 plate',
      unit: 'pcs',
      category: 'makanan',
    },
  ];

  for (const product of productsToSeed) {
    try {
      console.log(`seeding products ${product.product_name}`);
      await db.insert(productsTable).values(product);
    } catch (error: any) {
      if (error.message?.includes('already exists') || error.status === 422) {
        console.log(
          `Product ${product.product_name} already exists, skipping.`,
        );
      } else {
        console.error(`Failed to seed product ${product.product_name}:`, error);
      }
    }
  }
};

const seedCategories = async () => {
  const [cashInCategory] = await db
    .select({ count: count(cashInCategoryTable.id) })
    .from(cashInCategoryTable);
  const [cashOutCategory] = await db
    .select({ count: count(cashOutCategoryTable.id) })
    .from(cashOutCategoryTable);

  if (cashInCategory.count > 0) {
    CATEGORY_IN.forEach(async (category) => {
      await db.insert(cashInCategoryTable).values({
        category: category,
      });
    });
  }

  if (cashOutCategory.count > 0) {
    CATEGORY_OUT.forEach(async (category) => {
      await db.insert(cashOutCategoryTable).values({
        category: category,
      });
    });
  }
};

const seedScheduleProductAds = async () => {
  const seeder = [
    { day: 'sunday', hour: '01' },
    { day: 'sunday', hour: '02' },
    { day: 'sunday', hour: '03' },
    { day: 'sunday', hour: '04' },
    { day: 'sunday', hour: '05' },
    { day: 'sunday', hour: '06' },
    { day: 'sunday', hour: '07' },
    { day: 'sunday', hour: '08' },
    { day: 'sunday', hour: '09' },
    { day: 'sunday', hour: '10' },
    { day: 'sunday', hour: '11' },
    { day: 'sunday', hour: '12' },
    { day: 'sunday', hour: '13' },
    { day: 'sunday', hour: '14' },
    { day: 'sunday', hour: '15' },
    { day: 'sunday', hour: '16' },
    { day: 'sunday', hour: '17' },
    { day: 'sunday', hour: '18' },
    { day: 'sunday', hour: '19' },
    { day: 'sunday', hour: '20' },
    { day: 'sunday', hour: '21' },
    { day: 'sunday', hour: '22' },
    { day: 'sunday', hour: '23' },
    { day: 'sunday', hour: '24' },
    { day: 'monday', hour: '01' },
    { day: 'monday', hour: '02' },
    { day: 'monday', hour: '03' },
    { day: 'monday', hour: '04' },
    { day: 'monday', hour: '05' },
    { day: 'monday', hour: '06' },
    { day: 'monday', hour: '07' },
    { day: 'monday', hour: '08' },
    { day: 'monday', hour: '09' },
    { day: 'monday', hour: '10' },
    { day: 'monday', hour: '11' },
    { day: 'monday', hour: '12' },
    { day: 'monday', hour: '13' },
    { day: 'monday', hour: '14' },
    { day: 'monday', hour: '15' },
    { day: 'monday', hour: '16' },
    { day: 'monday', hour: '17' },
    { day: 'monday', hour: '18' },
    { day: 'monday', hour: '19' },
    { day: 'monday', hour: '20' },
    { day: 'monday', hour: '21' },
    { day: 'monday', hour: '22' },
    { day: 'monday', hour: '23' },
    { day: 'monday', hour: '24' },
    { day: 'tuesday', hour: '01' },
    { day: 'tuesday', hour: '02' },
    { day: 'tuesday', hour: '03' },
    { day: 'tuesday', hour: '04' },
    { day: 'tuesday', hour: '05' },
    { day: 'tuesday', hour: '06' },
    { day: 'tuesday', hour: '07' },
    { day: 'tuesday', hour: '08' },
    { day: 'tuesday', hour: '09' },
    { day: 'tuesday', hour: '10' },
    { day: 'tuesday', hour: '11' },
    { day: 'tuesday', hour: '12' },
    { day: 'tuesday', hour: '13' },
    { day: 'tuesday', hour: '14' },
    { day: 'tuesday', hour: '15' },
    { day: 'tuesday', hour: '16' },
    { day: 'tuesday', hour: '17' },
    { day: 'tuesday', hour: '18' },
    { day: 'tuesday', hour: '19' },
    { day: 'tuesday', hour: '20' },
    { day: 'tuesday', hour: '21' },
    { day: 'tuesday', hour: '22' },
    { day: 'tuesday', hour: '23' },
    { day: 'tuesday', hour: '24' },
    { day: 'wednesday', hour: '01' },
    { day: 'wednesday', hour: '02' },
    { day: 'wednesday', hour: '03' },
    { day: 'wednesday', hour: '04' },
    { day: 'wednesday', hour: '05' },
    { day: 'wednesday', hour: '06' },
    { day: 'wednesday', hour: '07' },
    { day: 'wednesday', hour: '08' },
    { day: 'wednesday', hour: '09' },
    { day: 'wednesday', hour: '10' },
    { day: 'wednesday', hour: '11' },
    { day: 'wednesday', hour: '12' },
    { day: 'wednesday', hour: '13' },
    { day: 'wednesday', hour: '14' },
    { day: 'wednesday', hour: '15' },
    { day: 'wednesday', hour: '16' },
    { day: 'wednesday', hour: '17' },
    { day: 'wednesday', hour: '18' },
    { day: 'wednesday', hour: '19' },
    { day: 'wednesday', hour: '20' },
    { day: 'wednesday', hour: '21' },
    { day: 'wednesday', hour: '22' },
    { day: 'wednesday', hour: '23' },
    { day: 'wednesday', hour: '24' },
    { day: 'thursday', hour: '01' },
    { day: 'thursday', hour: '02' },
    { day: 'thursday', hour: '03' },
    { day: 'thursday', hour: '04' },
    { day: 'thursday', hour: '05' },
    { day: 'thursday', hour: '06' },
    { day: 'thursday', hour: '07' },
    { day: 'thursday', hour: '08' },
    { day: 'thursday', hour: '09' },
    { day: 'thursday', hour: '10' },
    { day: 'thursday', hour: '11' },
    { day: 'thursday', hour: '12' },
    { day: 'thursday', hour: '13' },
    { day: 'thursday', hour: '14' },
    { day: 'thursday', hour: '15' },
    { day: 'thursday', hour: '16' },
    { day: 'thursday', hour: '17' },
    { day: 'thursday', hour: '18' },
    { day: 'thursday', hour: '19' },
    { day: 'thursday', hour: '20' },
    { day: 'thursday', hour: '21' },
    { day: 'thursday', hour: '22' },
    { day: 'thursday', hour: '23' },
    { day: 'thursday', hour: '24' },
    { day: 'friday', hour: '01' },
    { day: 'friday', hour: '02' },
    { day: 'friday', hour: '03' },
    { day: 'friday', hour: '04' },
    { day: 'friday', hour: '05' },
    { day: 'friday', hour: '06' },
    { day: 'friday', hour: '07' },
    { day: 'friday', hour: '08' },
    { day: 'friday', hour: '09' },
    { day: 'friday', hour: '10' },
    { day: 'friday', hour: '11' },
    { day: 'friday', hour: '12' },
    { day: 'friday', hour: '13' },
    { day: 'friday', hour: '14' },
    { day: 'friday', hour: '15' },
    { day: 'friday', hour: '16' },
    { day: 'friday', hour: '17' },
    { day: 'friday', hour: '18' },
    { day: 'friday', hour: '19' },
    { day: 'friday', hour: '20' },
    { day: 'friday', hour: '21' },
    { day: 'friday', hour: '22' },
    { day: 'friday', hour: '23' },
    { day: 'friday', hour: '24' },
    { day: 'saturday', hour: '01' },
    { day: 'saturday', hour: '02' },
    { day: 'saturday', hour: '03' },
    { day: 'saturday', hour: '04' },
    { day: 'saturday', hour: '05' },
    { day: 'saturday', hour: '06' },
    { day: 'saturday', hour: '07' },
    { day: 'saturday', hour: '08' },
    { day: 'saturday', hour: '09' },
    { day: 'saturday', hour: '10' },
    { day: 'saturday', hour: '11' },
    { day: 'saturday', hour: '12' },
    { day: 'saturday', hour: '13' },
    { day: 'saturday', hour: '14' },
    { day: 'saturday', hour: '15' },
    { day: 'saturday', hour: '16' },
    { day: 'saturday', hour: '17' },
    { day: 'saturday', hour: '18' },
    { day: 'saturday', hour: '19' },
    { day: 'saturday', hour: '20' },
    { day: 'saturday', hour: '21' },
    { day: 'saturday', hour: '22' },
    { day: 'saturday', hour: '23' },
    { day: 'saturday', hour: '24' },
  ];
  const [existing] = await db
    .select({ count: count(scheduleProductAdsTable.id) })
    .from(scheduleProductAdsTable);

  if (existing.count > 0) {
    console.log('Schedule product ads already seeded, skipping.');
    return;
  }

  await db
    .insert(scheduleProductAdsTable)
    .values(seeder.map((e, i) => ({ id: i + 1, time: e })));
};

main();
