import { CatalogGroupsManager } from "@/components/cs/catalog-groups-manager";
import { requireUser } from "@/lib/auth";
import type {
  CreditCatalogGroup,
  CreditCatalogGroupCategory,
  CreditCatalogGroupCategoryLink,
  CreditCatalogGroupCluster,
  CreditCatalogGroupClusterLink,
  CreditCatalogGroupItem,
  CreditCatalogUseCaseCategory,
  CreditCatalogItem,
} from "@/lib/onboarding";

export default async function CatalogGroupsPage() {
  const { supabase } = await requireUser();

  const [
    { data: groupRows, error: groupsError },
    { data: clusterRows, error: clustersError },
    { data: clusterLinkRows, error: clusterLinksError },
    { data: categoryRows, error: categoriesError },
    { data: categoryLinkRows, error: categoryLinksError },
    { data: useCaseCategoryRows, error: useCaseCategoriesError },
    { data: itemRows, error: itemsError },
    { data: membershipRows, error: membershipsError },
  ] = await Promise.all([
    supabase.from("credit_catalog_groups").select("*").order("sort_order").order("name"),
    supabase
      .from("credit_catalog_group_clusters")
      .select("*")
      .order("sort_order")
      .order("label"),
    supabase
      .from("credit_catalog_group_cluster_links")
      .select("*")
      .order("group_id")
      .order("sort_order"),
    supabase.from("credit_catalog_group_categories").select("*").order("sort_order").order("name"),
    supabase.from("credit_catalog_group_category_links").select("*").order("category_id").order("sort_order").order("created_at"),
    supabase.from("credit_catalog_use_case_categories").select("*").order("name"),
    supabase.from("credit_catalog_items").select("*").order("category").order("sort_order").order("label"),
    supabase.from("credit_catalog_group_items").select("*").order("sort_order").order("created_at"),
  ]);

  if (groupsError) {
    throw new Error("No pudimos cargar los grupos de casos de uso.");
  }

  if (itemsError) {
    throw new Error("No pudimos cargar el catalogo de tareas.");
  }

  if (clustersError) {
    throw new Error("No pudimos cargar el catalogo de clusters.");
  }

  if (clusterLinksError) {
    throw new Error("No pudimos cargar los clusters asignados.");
  }

  if (categoriesError) {
    throw new Error("No pudimos cargar las categorias visuales de los grupos.");
  }

  if (categoryLinksError) {
    throw new Error("No pudimos cargar la relacion entre casos de uso y categorias.");
  }

  if (useCaseCategoriesError) {
    throw new Error("No pudimos cargar las categorias de casos de uso.");
  }

  if (membershipsError) {
    throw new Error("No pudimos cargar la composicion de los grupos.");
  }

  return (
    <CatalogGroupsManager
      initialGroups={(groupRows ?? []) as CreditCatalogGroup[]}
      initialClusters={(clusterRows ?? []) as CreditCatalogGroupCluster[]}
      initialClusterLinks={(clusterLinkRows ?? []) as CreditCatalogGroupClusterLink[]}
      initialGroupCategories={(categoryRows ?? []) as CreditCatalogGroupCategory[]}
      initialGroupCategoryLinks={(categoryLinkRows ?? []) as CreditCatalogGroupCategoryLink[]}
      initialUseCaseCategories={(useCaseCategoryRows ?? []) as CreditCatalogUseCaseCategory[]}
      initialItems={(itemRows ?? []) as CreditCatalogItem[]}
      initialMemberships={(membershipRows ?? []) as CreditCatalogGroupItem[]}
    />
  );
}
