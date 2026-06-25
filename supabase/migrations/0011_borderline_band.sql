-- 0011 — Borderline (marginal) flagging band: server-side validation
--
-- P6/B adds a configurable borderline band (the symmetric ±% window around a grade
-- boundary used to flag "marginal" students). It is a grade-bearing input, so the
-- value must NOT be trusted from the client. It rides the existing workspace_settings
-- blob under the key 'borderline' (value shape: { "bandPct": <number> }), written via
-- the SECURITY DEFINER RPC `set_workspace_setting`.
--
-- This migration replaces that RPC so it validates the 'borderline' key server-side:
-- bandPct must be a JSON number within [0, 20] percentage points. All other keys keep
-- the prior behaviour (auth check + upsert + audit). Idempotent: CREATE OR REPLACE.

create or replace function public.set_workspace_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public, app as $$
declare
  v_band numeric;
begin
  if not app.is_workspace_admin() then
    raise exception 'not authorized';
  end if;

  -- Server-side validation for the grade-bearing borderline band. Keep the bounds
  -- in sync with BORDERLINE_BAND_MIN/MAX in lib/data/grading.ts.
  if p_key = 'borderline' then
    if jsonb_typeof(p_value -> 'bandPct') is distinct from 'number' then
      raise exception 'borderline.bandPct must be a number';
    end if;
    v_band := (p_value ->> 'bandPct')::numeric;
    if v_band < 0 or v_band > 20 then
      raise exception 'borderline.bandPct must be between 0 and 20';
    end if;
  end if;

  insert into workspace_settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform app.audit(null, 'set_workspace_setting', 'workspace', p_key, null, p_value);
end $$;
