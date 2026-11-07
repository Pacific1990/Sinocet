-- Manager closes anomalous transfers only after physical re-verification.
-- Missing devices remain HOLD and are never silently released.
ALTER TABLE transfers DROP CHECK ck_transfers_status;
ALTER TABLE transfers ADD CONSTRAINT ck_transfers_status CHECK (
  status IN ('IN_TRANSIT','RECEIVED','DISCREPANCY','RETURNED','CLOSED_WITH_DISCREPANCY')
);
