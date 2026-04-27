import { CatalogCategoriesManager } from "@/components/cs/catalog-categories-manager";
import { requireUser } from "@/lib/auth";
import type { CreditCatalogCategory, CreditCatalogItem } from "@/lib/onboarding";

export default async function CatalogCategoriesPage() {
  const { supabase } = await requireUser();

  const [{ data: categoryRows, error: categoriesError }, { data: itemRows, error: itemsError }] =
    await Promise.all([
      supabase.from("credit_catalog_categories").select("*").order("sort_order").order("name"),
      supabase.from("credit_catalog_items").select("*").order("category").order("sort_order").order("label"),
    ]);

  if (categoriesError) {
    throw new Error("No pudimos cargar las categorías del catálogo.");
  }

  if (itemsError) {
    throw new Error("No pudimos cargar las tareas para el conteo por categoría.");
  }

  return (
    <CatalogCategoriesManager
      initialCategories={(categoryRows ?? []) as CreditCatalogCategory[]}
      initialItems={(itemRows ?? []) as CreditCatalogItem[]}
    />
  );
}
