import { CatalogGroupCategoriesManager } from "@/components/cs/catalog-group-categories-manager";
import { requireUser } from "@/lib/auth";
import type { CreditCatalogGroupCategory, CreditCatalogGroupCategoryLink } from "@/lib/onboarding";

export default async function CatalogGroupCategoriesPage() {
  const { supabase } = await requireUser();

  const [{ data: categoryRows, error: categoriesError }, { data: categoryLinkRows, error: categoryLinksError }] =
    await Promise.all([
      supabase.from("credit_catalog_group_categories").select("*").order("sort_order").order("name"),
      supabase.from("credit_catalog_group_category_links").select("*").order("category_id").order("sort_order").order("created_at"),
    ]);

  if (categoriesError) {
    throw new Error("No pudimos cargar las categorias de grupos.");
  }

  if (categoryLinksError) {
    throw new Error("No pudimos cargar los casos de uso para el conteo por categoria.");
  }

  return (
    <CatalogGroupCategoriesManager
      initialCategories={(categoryRows ?? []) as CreditCatalogGroupCategory[]}
      initialCategoryLinks={(categoryLinkRows ?? []) as CreditCatalogGroupCategoryLink[]}
    />
  );
}
