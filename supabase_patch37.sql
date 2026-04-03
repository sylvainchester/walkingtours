-- One-time migration for the new paid_amount semantics:
-- participants.paid_amount is now stored as the total amount for the participant row,
-- not as a per-person unit price.
--
-- Run this patch only once, and only if historical paid_amount values were still stored
-- as per-person prices.

update public.participants
set paid_amount = round(paid_amount * greatest(coalesce(group_size, 1), 1), 2)
where paid_amount is not null
  and coalesce(group_size, 1) > 1;
