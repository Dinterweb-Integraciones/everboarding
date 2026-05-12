import { CatalogGroupCategoriesManager } from "@/components/cs/catalog-group-categories-manager";
import { requireUser } from "@/lib/auth";
import type { CreditCatalogGroup, CreditCatalogGroupCategory } from "@/lib/onboarding";

export default async function CatalogGroupCategoriesPage() {
  const { supabase } = await requireUser();

  const [{ data: categoryRows, error: categoriesError }, { data: groupRows, error: groupsError }] =
    await Promise.all([
      supabase.from("credit_catalog_group_categories").select("*").order("sort_order").order("name"),
      supabase.from("credit_catalog_groups").select("*").order("sort_order").order("name"),
    ]);

  if (categoriesError) {
    throw new Error("No pudimos cargar las categorias de grupos.");
  }

  if (groupsError) {
    throw new Error("No pudimos cargar los grupos para el conteo por categoria.");
  }

  return (
    <CatalogGroupCategoriesManager
      initialCategories={(categoryRows ?? []) as CreditCatalogGroupCategory[]}
      initialGroups={(groupRows ?? []) as CreditCatalogGroup[]}
    />
  );
}
