alter table public.onboarding_initiatives
add column if not exists completion_outcome text,
add column if not exists success_milestone text;
