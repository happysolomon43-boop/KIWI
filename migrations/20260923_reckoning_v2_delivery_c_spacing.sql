-- Reckoning V2 Delivery C: generic revisit-spacing persistence.
-- Additive only. Existing legacy/shadow rows remain valid.

ALTER TABLE public.reckoning_evidence
  ADD COLUMN IF NOT EXISTS next_eligible_question integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reckoning_evidence_next_eligible_question_ck'
  ) THEN
    ALTER TABLE public.reckoning_evidence
      ADD CONSTRAINT reckoning_evidence_next_eligible_question_ck
      CHECK (
        next_eligible_question IS NULL
        OR next_eligible_question >= 0
      );
  END IF;
END $$;

COMMENT ON COLUMN public.reckoning_evidence.next_eligible_question IS
  'Earliest adaptive question ordinal at which this evidence unit may be revisited after corrective exposure.';
