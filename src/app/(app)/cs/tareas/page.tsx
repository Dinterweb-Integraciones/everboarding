import { CatalogItemsManager } from "@/components/cs/catalog-items-manager";
import { requireUser } from "@/lib/auth";
import type {
  CreditCatalogCategory,
  CreditCatalogGroup,
  CreditCatalogGroupItem,
  CreditCatalogItem,
} from "@/lib/onboarding";

export default async function CatalogTasksPage() {
  const { supabase } = await requireUser();

  const [
    { data: itemRows, error: itemsError },
    { data: groupRows, error: groupsError },
    { data: membershipRows, error: membershipsError },
    { data: categoryRows, error: categoriesError },
  ] = await Promise.all([
    supabase.from("credit_catalog_items").select("*").order("category").order("sort_order").order("label"),
    supabase.from("credit_catalog_groups").select("*").order("sort_order").order("name"),
    supabase.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
    supabase.from("credit_catalog_categories").select("*").eq("is_active", true).order("sort_order").order("name"),
  ]);

  if (itemsError) {
    throw new Error("No pudimos cargar el catalogo de actividades.");
  }

  if (groupsError) {
    throw new Error("No pudimos cargar los grupos del catalogo.");
  }

  if (membershipsError) {
    throw new Error("No pudimos cargar la relacion entre grupos y actividades.");
  }

  if (categoriesError) {
    throw new Error("No pudimos cargar las categorias de actividades.");
  }

  return (
    <CatalogItemsManager
      initialItems={(itemRows ?? []) as CreditCatalogItem[]}
      groups={(groupRows ?? []) as CreditCatalogGroup[]}
      memberships={(membershipRows ?? []) as CreditCatalogGroupItem[]}
      categories={(categoryRows ?? []) as CreditCatalogCategory[]}
    />
  );
}
