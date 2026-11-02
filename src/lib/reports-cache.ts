import { revalidateTag } from "next/cache";

// Etiqueta de la caché de datos de /informes. Las rutas que editan datos que se ven en Informes la
// invalidan para que el cambio aparezca al recargar, sin esperar a que la caché venza.
export const REPORTS_CACHE_TAG = "informes";

export function invalidateReportsCache() {
  revalidateTag(REPORTS_CACHE_TAG, { expire: 0 });
}
