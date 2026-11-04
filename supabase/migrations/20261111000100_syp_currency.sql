-- Commit this enum addition before any migration or fixture uses the new value.
-- Existing USD cents and whole-LBP amounts are deliberately unchanged.
alter type public.currency add value if not exists 'SYP';
