-- Per-merchant employee quota, set by an admin on the subscription.
--
-- features.maxEmployees on the PLAN is the catalog rule (Basic 1, Pro 3, Max
-- 5) and stays that way: editing the seed to sell one merchant a sixth staff
-- account would hand it to every merchant on that tier. This column is the
-- exception granted to one account — a warung that pays for extra seats, a
-- client kept whole while they decide on an upgrade — and it wins over the
-- plan's cap for as long as the subscription is alive.
--
-- NULL (the default, and every existing row) = follow the plan, which is also
-- what clearing the override in the admin form writes back. Lowering it never
-- deactivates anybody: the cap is only consulted when an employee is added or
-- reactivated, so an owner already over a new limit keeps their staff and
-- simply cannot add more.

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "max_employees_override" integer;
