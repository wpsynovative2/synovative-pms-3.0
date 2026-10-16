-- A monthly repeat used to fall on the start date's own day of the month and
-- nothing else. It can now name its day: rule ->> 'monthDay', 1-31, chosen
-- freely. A month too short for it uses its last day (31 -> 30 Nov, 28 Feb).
--
-- With a named day the start date is only where counting begins - it does not
-- fire unless it is that day - so the first copy is made on the first such
-- day on or after the start. Rules without monthDay behave exactly as before.
-- Mirrors matchesRule in lib/recurrence.ts.

create or replace function recurrence_matches(rule jsonb, anchor date, d date)
 returns boolean
 language plpgsql
 immutable
as $function$
declare
  n       integer := greatest(1, coalesce((rule ->> 'interval')::integer, 1));
  mode    text    := coalesce(rule ->> 'monthlyMode', 'monthday');
  months  integer;
  days    integer[];
  v_day   integer;
begin
  if d < anchor then return false; end if;

  -- The day a monthly rule was told to fall on, when it names one.
  if rule ->> 'freq' = 'monthly' and mode = 'monthday'
     and jsonb_typeof(rule -> 'monthDay') = 'number' then
    v_day := floor((rule ->> 'monthDay')::numeric)::integer;
    if v_day < 1 or v_day > 31 then
      v_day := null;
    end if;
  end if;

  if d = anchor and v_day is null then return true; end if;

  case rule ->> 'freq'
    when 'daily' then
      return (d - anchor) % n = 0;

    when 'weekly' then
      if jsonb_typeof(rule -> 'weekdays') = 'array'
         and jsonb_array_length(rule -> 'weekdays') > 0 then
        select array_agg(value::integer) into days
          from jsonb_array_elements_text(rule -> 'weekdays');
      else
        days := array[extract(dow from anchor)::integer];
      end if;
      if not (extract(dow from d)::integer = any (days)) then
        return false;
      end if;
      return ((date_trunc('week', d::timestamp)::date
               - date_trunc('week', anchor::timestamp)::date) / 7) % n = 0;

    when 'monthly' then
      months := (extract(year from d)::integer - extract(year from anchor)::integer) * 12
              + (extract(month from d)::integer - extract(month from anchor)::integer);
      if months % n <> 0 then return false; end if;
      if v_day is not null then
        return extract(day from d)::integer = least(
          v_day,
          extract(day from (date_trunc('month', d::timestamp) + interval '1 month - 1 day'))::integer
        );
      end if;
      if mode = 'monthday' then
        return extract(day from d) = extract(day from anchor);
      end if;
      if extract(dow from d) <> extract(dow from anchor) then return false; end if;
      if mode = 'nthWeekday' then
        return (extract(day from d)::integer - 1) / 7
             = (extract(day from anchor)::integer - 1) / 7;
      end if;
      -- lastWeekday: a week later is already next month.
      return extract(month from d + 7) <> extract(month from d);

    when 'yearly' then
      return (extract(year from d)::integer - extract(year from anchor)::integer) % n = 0
         and extract(month from d) = extract(month from anchor)
         and extract(day from d)   = extract(day from anchor);

    else
      return false;
  end case;
end;
$function$;
