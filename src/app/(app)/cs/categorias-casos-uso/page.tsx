import { CatalogGroupCategoriesManager } from "@/components/cs/catalog-group-categories-manager";
import { requireUser } from "@/lib/auth";
import type { CreditCatalogUseCaseCategory } from "@/lib/onboarding";

export default async function CatalogUseCaseCategoriesPage() {
  const { supabase } = await requireUser();

  const [
    { data: categoryRows, error: categoriesError },
    { data: groupRows, error: groupsError },
  ] = await Promise.all([
    supabase.from("credit_catalog_use_case_categories").select("*").order("name"),
    supabase.from("credit_catalog_groups").select("id, use_case_category_id"),
  ]);

  if (categoriesError) {
    throw new Error("No pudimos cargar las categorías de casos de uso.");
  }

  if (groupsError) {
    throw new Error("No pudimos cargar los casos de uso para el conteo por categoría.");
  }

  const usageCounts = (groupRows ?? []).reduce<Record<string, number>>((counts, group) => {
    if (group.use_case_category_id) {
      counts[group.use_case_category_id] = (counts[group.use_case_category_id] ?? 0) + 1;
    }
    return counts;
  }, {});

  return (
    <CatalogGroupCategoriesManager
      initialCategories={(categoryRows ?? []) as CreditCatalogUseCaseCategory[]}
      initialUsageCounts={usageCounts}
      catalogType="use-case"
    />
  );
}
