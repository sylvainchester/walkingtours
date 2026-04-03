-- Patch 36: backfill per-platform default price inside tour_types.platforms

update public.tour_types
set platforms = coalesce((
  select jsonb_agg(
    case
      when platform ? 'default_price' then platform
      else platform || jsonb_build_object(
        'default_price',
        case
          when payment_type = 'free' then coalesce((platform->>'commission_percent')::numeric, fee_per_participant, 0)
          else coalesce(ticket_price, 0)
        end
      )
    end
    order by ordinality
  )
  from jsonb_array_elements(coalesce(platforms, '[]'::jsonb)) with ordinality as item(platform, ordinality)
), '[]'::jsonb);
