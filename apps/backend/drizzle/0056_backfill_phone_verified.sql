-- ---------------------------------------------------------------------------
-- Grandfather the customers who were already here.
--
-- 0055 added users.phone_verified with DEFAULT false, and routes/orders.ts +
-- routes/errands.ts both refuse to create an order without it. Shipping those
-- two together and nothing else would lock every existing customer out of
-- ordering at their next visit — not a migration decision, a business one, and
-- the wrong default for an account that has been ordering here for months.
--
-- MUST run after 0052 (which canonicalises the numbers to 628… and nulls the
-- shared placeholder). Running it before would stamp `verified` on the
-- placeholder literal that 0052 is about to throw away, certifying a number
-- nobody owns.
--
-- What this trusts: the number was self-entered at signup and has never been
-- proven reachable on WhatsApp. That is a deliberate trade — an existing
-- customer keeps ordering uninterrupted, and the proof requirement starts
-- applying from here forward. Anyone whose placeholder 0052 nulled is NOT
-- covered (phone IS NULL fails the predicate) and still goes through the real
-- flow, which is correct: there is nothing about them to grandfather.
--
-- Scoped to customers only, matching the gate itself — dashboard/layout.tsx
-- renders PhoneVerificationGate on `role.role === 'customer'`, and
-- /api/orders/create is the customer lane. Owners and couriers carry the
-- placeholder in bulk and are never gated, so widening this would hand out a
-- verified flag that certifies nothing and buys nothing.
-- ---------------------------------------------------------------------------

UPDATE "users" u
SET "phone_verified" = true
WHERE u."phone" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "customers" c WHERE c."user_id" = u."id"
  );
