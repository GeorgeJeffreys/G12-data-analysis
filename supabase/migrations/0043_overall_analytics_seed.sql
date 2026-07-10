-- G12++ — Overall analytics visualisation seed (SYNTHETIC, fully reversible)
-- Migration 0043_overall_analytics_seed.sql
-- ----------------------------------------------------------------------------
-- PURPOSE. The "Overall" analytics page is a bird's-eye view of programme
-- performance over time across partner centres. Until real multi-year /
-- multi-centre data has accrued, this seed populates the PERSISTED-OUTPUT grain
-- the read-model consumes (`participant_scores` + `grades`) so all four sections
-- of the page render meaningfully against live Supabase.
--
-- NAMESPACED + REVERSIBLE. Every synthetic row hangs off test centres whose
-- `slug` begins `seed-ov-` (and whose names carry a "△ Sample" marker), so it can
-- never be mistaken for real cohort data and is removed in full by the companion
-- `0043_overall_analytics_seed.rollback.sql` (deletes by that slug prefix and
-- cascades through the cycle FKs).
--
-- DOES NOT DISTURB REAL DATA. New centres / years / cycles only; the real live
-- cycle is never touched. Synthetic cycles are stamped with PAST created_at
-- timestamps so they can never out-sort the real live cycle in the single-cycle
-- hydrate (which picks the newest cycle as "live").
--
-- RUN AS SERVICE ROLE in the Supabase SQL editor (the score/grade columns are
-- definer-only for clients; the service role bypasses RLS). Seeding at the
-- persisted-output grain is sufficient — no raw responses or engine re-run.
--
-- IDEMPOTENCY. Run the rollback first if re-seeding; the centre `slug`/`code`
-- unique constraints make a bare re-run without rollback fail loudly rather than
-- duplicate.
-- ----------------------------------------------------------------------------

do $seed$
declare
  v_owner        uuid;
  v_centre_id    uuid;
  v_year_id      uuid;
  v_cycle_id     uuid;
  v_assess_ids   uuid[];
  v_run_ids      uuid[];
  v_part_id      uuid;
  v_tmp          uuid;
  v_tmp2         uuid;
  v_year         int;
  v_sitting      text;
  v_bias         int;
  v_centre_bias  int;
  v_base_h       int;
  v_base_rank    int;
  v_rank         int;
  v_level        text;
  v_upper        numeric;
  v_lower        numeric;
  v_mid          numeric;
  v_jh           int;
  v_jitter       numeric;
  v_pct          numeric;
  v_raw          numeric;
  v_award        text;
  v_out_cnt      int;
  v_exc_or_cnt   int;
  v_meets_cnt    int;
  v_p_from       int;
  v_p_to         int;
  v_created      timestamptz;
  v_slug         text;
  v_qm           text;
  i int; s int; k int;

  -- Engine vocabulary — must match lib/engine/config.ts EXACTLY so the app ranks
  -- these labels (best → lowest).
  c_levels  constant text[] := array[
    'Outstanding performance',
    'Exceeds expectations',
    'Meets expectations',
    'Doesn''t yet meet expectations'
  ];
  c_awards  constant text[] := array[
    'Distinction award',
    'Advanced achievement award',
    'Secondary achievement award',
    'No Award'
  ];
  -- Default performance cuts (Outstanding / Exceeds / Meets), for representative %.
  c_cuts    constant numeric[] := array[78, 58, 40];

  -- Five subjects — names chosen so the app's subject classifier maps them to the
  -- canonical keys (am / st / esl / afl / ls).
  c_subjects constant text[] := array[
    'Applicable Mathematics',
    'Scientific Thinking',
    'English 2nd Language',
    'Arabic 1st Language',
    'Life Skills'
  ];

  -- Synthetic partner centres: name, code, slug, centreBias (0 weakest … 2 best).
  -- The bias plus the year/sitting bias below drives the centre spread + the
  -- year-on-year and February→May improvement the four sections visualise.
  c_centres constant text[][] := array[
    array['△ Sample — North Beacon', 'SOVNB', 'seed-ov-north-beacon', '2'],
    array['△ Sample — Cedar Valley', 'SOVCV', 'seed-ov-cedar-valley', '1'],
    array['△ Sample — Harbour East', 'SOVHE', 'seed-ov-harbour-east', '0']
  ];

  c_years   constant int[] := array[2025, 2026];
begin
  -- An owner for the created_by / signed_off_by columns (the definer-only defaults
  -- to auth.uid(), which is NULL under the service role).
  select id into v_owner from auth.users order by created_at asc limit 1;
  if v_owner is null then
    raise exception 'No auth.users row found — create at least one user before seeding.';
  end if;

  for i in 1 .. array_length(c_centres, 1) loop
    v_slug := c_centres[i][3];
    v_centre_bias := c_centres[i][4]::int;

    insert into test_centres (name, code, slug, region, active, created_by, created_at, updated_at)
    values (c_centres[i][1], c_centres[i][2], v_slug, 'eu-west', true, v_owner,
            timestamptz '2025-01-01', timestamptz '2025-01-01')
    returning id into v_centre_id;

    foreach v_year in array c_years loop
      insert into exam_years (name, region, test_centre_id, created_by, created_at)
      values (v_year::text, 'eu-west', v_centre_id, v_owner, make_timestamptz(v_year, 1, 1, 0, 0, 0))
      returning id into v_year_id;

      foreach v_sitting in array array['february', 'may'] loop
        -- February is weaker than May; 2026 stronger than 2025; centres differ.
        v_bias := v_centre_bias + (v_year - 2025) + (case when v_sitting = 'may' then 0 else -1 end);
        v_created := case when v_sitting = 'may'
                       then make_timestamptz(v_year, 5, 15, 0, 0, 0)
                       else make_timestamptz(v_year, 2, 15, 0, 0, 0) end;

        insert into exam_cycles (name, status, region, year_id, sitting, sitting_date,
                                 created_by, created_at, updated_at)
        values (format('△ Sample %s %s %s', c_centres[i][2], v_year, initcap(v_sitting)),
                'locked', 'eu-west', v_year_id, v_sitting::sitting_period, v_created::date,
                v_owner, v_created, v_created)
        returning id into v_cycle_id;

        -- 5 assessments + one score_run each (capture ids in parallel arrays).
        v_assess_ids := array[]::uuid[];
        v_run_ids := array[]::uuid[];
        for s in 1 .. array_length(c_subjects, 1) loop
          insert into assessments (cycle_id, name, item_count, status, created_at)
          values (v_cycle_id, c_subjects[s], 40, 'scored', v_created)
          returning id into v_tmp;
          v_assess_ids := array_append(v_assess_ids, v_tmp);

          insert into score_runs (cycle_id, assessment_id, excluded_item_ids, engine_version, computed_at)
          values (v_cycle_id, v_tmp, '{}', 'seed-synthetic', v_created)
          returning id into v_tmp2;
          v_run_ids := array_append(v_run_ids, v_tmp2);
        end loop;

        -- Roster: some students sit both sittings, some only one (so satFeb/satMay
        -- exceed `both`). February = 1..15, May = 2..16 → overlap 2..15.
        if v_sitting = 'february' then v_p_from := 1; v_p_to := 15;
        else v_p_from := 2; v_p_to := 16; end if;

        for k in v_p_from .. v_p_to loop
          -- Stable natural key shared across the two sittings of THIS (centre, year),
          -- so best-of-two + February→May movement match the same student.
          v_qm := format('SEED-%s-%s-P%s', v_slug, v_year, lpad(k::text, 2, '0'));
          insert into participants (cycle_id, qm_participant_id, pseudonym_id, full_name, created_at)
          values (v_cycle_id, v_qm, v_qm, format('Sample Student %s', lpad(k::text, 2, '0')), v_created)
          returning id into v_part_id;

          v_out_cnt := 0; v_exc_or_cnt := 0; v_meets_cnt := 0;

          for s in 1 .. array_length(c_subjects, 1) loop
            -- Base level from a hash WITHOUT the sitting (same student × subject has a
            -- stable base), then shifted by the sitting/year/centre bias so May and
            -- later years read better and centres spread.
            v_base_h := abs(hashtext(format('%s|%s|%s|%s', v_slug, v_year, k, s))) % 100;
            v_base_rank := case when v_base_h < 15 then 0
                                when v_base_h < 40 then 1
                                when v_base_h < 75 then 2
                                else 3 end;
            v_rank := greatest(0, least(3, v_base_rank - v_bias));
            v_level := c_levels[v_rank + 1];

            if v_rank = 0 then v_out_cnt := v_out_cnt + 1; end if;
            if v_rank <= 1 then v_exc_or_cnt := v_exc_or_cnt + 1; end if;
            if v_rank <= 2 then v_meets_cnt := v_meets_cnt + 1; end if;

            -- Representative % within the level's band + deterministic jitter.
            v_upper := case when v_rank = 0 then 100 else c_cuts[v_rank] end;
            v_lower := case when v_rank < 3 then c_cuts[v_rank + 1] else 0 end;
            v_mid := (v_upper + v_lower) / 2.0;
            v_jh := abs(hashtext(format('%s|%s|%s|%s|%s', v_slug, v_year, v_sitting, k, s))) % 100;
            v_jitter := ((v_jh / 100.0) - 0.5) * (v_upper - v_lower) * 0.6;
            v_pct := round(greatest(0, least(100, v_mid + v_jitter)), 1);
            v_raw := round(v_pct / 100.0 * 40, 1);

            insert into participant_scores (score_run_id, participant_id, assessment_id, raw, pct, items_seen)
            values (v_run_ids[s], v_part_id, v_assess_ids[s], v_raw, v_pct, 40);

            insert into grades (cycle_id, participant_id, scope, grade_label, score,
                                locked, signed_off_by, signed_off_at)
            values (v_cycle_id, v_part_id, v_assess_ids[s]::text, v_level, v_pct,
                    true, v_owner, v_created);
          end loop;

          -- Overall award from the five subject levels (the deterministic Layer-2
          -- rule; mirrors lib/engine/award.ts deriveAward with d3Pass = true).
          if v_out_cnt >= 3 and v_meets_cnt = 5 then v_award := c_awards[1];
          elsif v_exc_or_cnt >= 3 then v_award := c_awards[2];
          elsif v_meets_cnt >= 4 then v_award := c_awards[3];
          else v_award := c_awards[4]; end if;

          insert into grades (cycle_id, participant_id, scope, grade_label, score,
                              locked, signed_off_by, signed_off_at)
          values (v_cycle_id, v_part_id, 'overall', v_award, null,
                  true, v_owner, v_created);
        end loop;

        raise notice 'seeded cycle % % %', c_centres[i][2], v_year, v_sitting;
      end loop;
    end loop;
  end loop;
end
$seed$;
