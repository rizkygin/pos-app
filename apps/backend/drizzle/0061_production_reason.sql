-- Multi-level recipes, part 1 of 2: the new stock movement reason.
--
-- This file contains ONLY the enum value, on purpose. drizzle's migrator runs
-- each migration file inside a transaction, and while PostgreSQL 12+ does allow
-- ALTER TYPE ... ADD VALUE inside one, the newly added label cannot be USED by
-- any other statement in that same transaction. Keeping the label alone in its
-- own migration means 0062 (and every later migration, and the app) is free to
-- reference 'production' without tripping that rule.
--
-- 'production' = a batch was made in-house: the batch's ingredients go OUT and
-- the batch product itself comes IN. It is deliberately NOT 'purchase' (no cash
-- left the business — the cash left when the ingredients were bought, and
-- counting it again would double the HPP) and not 'adjustment' (nothing was
-- recounted; this is a real, intended conversion of stock into other stock).

ALTER TYPE "stock_movement_reason" ADD VALUE IF NOT EXISTS 'production';
