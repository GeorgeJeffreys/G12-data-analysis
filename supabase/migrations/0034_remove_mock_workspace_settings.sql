-- 0034 — remove mock workspace settings that no code reads any more.
-- 'retention' and 'branding' were persisted by the removed Settings › Configuration
-- cards. The 'safeguard' blob may still carry a legacy distinctionThreshold; it is
-- ignored on hydrate after the type was narrowed, so it needs no change here.
delete from workspace_settings where key in ('retention', 'branding');
