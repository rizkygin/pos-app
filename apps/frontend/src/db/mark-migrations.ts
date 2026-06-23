import 'dotenv/config';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { Pool } from 'pg';

// All migrations applied to DB via drizzle-kit push (no history was tracked).
// This script backfills __drizzle_migrations so future `npm run db:migrate` only runs new ones.
const APPLIED = [
  { tag: '0000_typical_spectrum', when: 1778210581285 },
  { tag: '0001_handy_pandemic', when: 1778470969967 },
  { tag: '0002_mighty_oracle', when: 1778630989815 },
  { tag: '0003_lush_wallow', when: 1778731804758 },
  { tag: '0004_chunky_deathbird', when: 1779071716045 },
  { tag: '0005_goofy_night_nurse', when: 1779075335086 },
  { tag: '0006_mature_sumo', when: 1779162420359 },
  { tag: '0007_lying_vivisector', when: 1779354291432 },
  { tag: '0008_cynical_wrecking_crew', when: 1779417392217 },
  { tag: '0009_lonely_black_panther', when: 1779420516810 },
  { tag: '0010_mute_lyja', when: 1779722989013 },
  { tag: '0011_friendly_thunderbird', when: 1780023545493 },
  { tag: '0012_modern_gabe_jones', when: 1780027140174 },
  { tag: '0013_daily_thena', when: 1780028169523 },
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  for (const m of APPLIED) {
    const content = readFileSync(`./drizzle/${m.tag}.sql`).toString();
    const hash = createHash('sha256').update(content).digest('hex');

    const existing = await pool.query(
      'SELECT id FROM public.__drizzle_migrations WHERE hash = $1',
      [hash],
    );
    if (existing.rowCount === 0) {
      await pool.query(
        'INSERT INTO public.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
        [hash, m.when],
      );
      console.log(`Marked ${m.tag}`);
    } else {
      console.log(`Already tracked ${m.tag}`);
    }
  }

  await pool.end();
  console.log('Done — now run: npm run db:migrate');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
