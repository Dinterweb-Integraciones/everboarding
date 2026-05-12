create or replace function public.get_public_onboarding_snapshot(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_client public.clients;
  target_config public.onboarding_configs;
  payment_email text;
begin
  select *
  into target_client
  from public.clients
  where id = public.resolve_public_client_id(p_slug)
  limit 1;

  if target_client.id is null then
    return null;
  end if;

  select *
  into target_config
  from public.onboarding_configs
  where client_id = target_client.id
  limit 1;

  select p.email
  into payment_email
  from public.profiles p
  where p.id = coalesce(target_client.seller_user_id, target_client.owner_user_id)
  limit 1;

  return jsonb_build_object(
    'client',
    jsonb_build_object(
      'id', target_client.id,
      'slug', target_client.slug,
      'name', target_client.name,
      'description', target_client.description,
      'seller_user_id', target_client.seller_user_id,
      'csm_user_id', target_client.csm_user_id
    ),
    'config',
    coalesce(
      to_jsonb(target_config),
      jsonb_build_object(
        'client_id', target_client.id,
        'start_date', current_date,
        'base_capacity', 80,
        'extra_capacity', 0,
        'lost_credits', 0,
        'custom_plan_credits', null,
        'custom_plan_price', null,
        'custom_plan_type', null,
        'custom_plan_billing_mode', 'subscription',
        'custom_plan_period_months', 1,
        'current_stage', 'cs',
        'credit_validity_days', 60,
        'show_all_completed', false,
        'sales_cleared', false,
        'created_at', timezone('utc', now()),
        'updated_at', timezone('utc', now()),
        'updated_by_user_id', null
      )
    ),
    'billing',
    public.get_client_billing_status(target_client.id),
    'catalog',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'category', item.category,
            'label', item.label,
            'credits', item.credits,
            'sort_order', item.sort_order,
            'created_at', item.created_at,
            'updated_at', item.updated_at
          )
          order by item.category, item.sort_order, item.label
        )
        from public.credit_catalog_items item
        where item.is_active = true
      ),
      '[]'::jsonb
    ),
    'catalog_categories',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', category.id,
            'name', category.name,
            'description', category.description,
            'sort_order', category.sort_order,
            'is_active', category.is_active,
            'created_at', category.created_at,
            'updated_at', category.updated_at
          )
          order by category.sort_order, category.name
        )
        from public.credit_catalog_categories category
        where category.is_active = true
      ),
      '[]'::jsonb
    ),
    'catalog_groups',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', group_item.id,
            'name', group_item.name,
            'description', group_item.description,
            'credits', group_item.credits,
            'sort_order', group_item.sort_order,
            'is_active', group_item.is_active,
            'modal_category', group_item.modal_category,
            'modal_category_id', group_item.modal_category_id,
            'priority_status', group_item.priority_status,
            'created_at', group_item.created_at,
            'updated_at', group_item.updated_at
          )
          order by group_item.sort_order, group_item.name
        )
        from public.credit_catalog_groups group_item
        where group_item.is_active = true
      ),
      '[]'::jsonb
    ),
    'catalog_group_categories',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', category.id,
            'name', category.name,
            'description', category.description,
            'sort_order', category.sort_order,
            'is_active', category.is_active,
            'created_at', category.created_at,
            'updated_at', category.updated_at
          )
          order by category.sort_order, category.name
        )
        from public.credit_catalog_group_categories category
        where category.is_active = true
      ),
      '[]'::jsonb
    ),
    'catalog_group_memberships',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'group_id', membership.group_id,
            'catalog_item_id', membership.catalog_item_id,
            'sort_order', membership.sort_order,
            'created_at', membership.created_at
          )
          order by membership.sort_order, membership.created_at
        )
        from public.credit_catalog_group_items membership
        join public.credit_catalog_groups group_item
          on group_item.id = membership.group_id
        where group_item.is_active = true
      ),
      '[]'::jsonb
    ),
    'payment_email',
    payment_email,
    'initiatives',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'client_id', i.client_id,
            'title', i.title,
            'type', i.type,
            'labels', i.labels,
            'status', i.status,
            'description', i.description,
            'owner_client', i.owner_client,
            'owner_csm', i.owner_csm,
            'est_start_date', i.est_start_date,
            'est_end_date', i.est_end_date,
            'date_planned', i.date_planned,
            'last_activity', i.last_activity,
            'is_blocked', i.is_blocked,
            'sort_order', i.sort_order,
            'created_at', i.created_at,
            'updated_at', i.updated_at,
            'created_by_user_id', i.created_by_user_id,
            'updated_by_user_id', i.updated_by_user_id,
            'subitems',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', s.id,
                    'initiative_id', s.initiative_id,
                    'catalog_item_id', s.catalog_item_id,
                    'name', s.name,
                    'status', s.status,
                    'target_date', s.target_date,
                    'unit_credits', s.unit_credits,
                    'quantity', s.quantity,
                    'sort_order', s.sort_order,
                    'created_at', s.created_at,
                    'updated_at', s.updated_at
                  )
                  order by s.sort_order, s.created_at
                )
                from public.onboarding_initiative_subitems s
                where s.initiative_id = i.id
              ),
              '[]'::jsonb
            ),
            'logs',
            coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'id', l.id,
                    'initiative_id', l.initiative_id,
                    'entry', l.entry,
                    'created_by_user_id', l.created_by_user_id,
                    'created_at', l.created_at
                  )
                  order by l.created_at desc
                )
                from public.onboarding_activity_logs l
                where l.initiative_id = i.id
              ),
              '[]'::jsonb
            )
          )
          order by i.sort_order, i.created_at
        )
        from public.onboarding_initiatives i
        where i.client_id = target_client.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;
