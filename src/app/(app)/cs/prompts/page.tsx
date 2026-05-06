import { ManagedPromptsManager } from "@/components/cs/managed-prompts-manager";
import { requireUser } from "@/lib/auth";
import type { ManagedPrompt } from "@/lib/onboarding";
import { isMissingSupabaseTable } from "@/lib/utils";

export default async function ManagedPromptsPage() {
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from("managed_prompts")
    .select("*")
    .eq("singleton_key", "default")
    .maybeSingle();

  const storageMessage = error
    ? isMissingSupabaseTable(error, "managed_prompts")
      ? "La tabla de prompts aun no existe en Supabase. Ejecuta la migracion pendiente para activar esta seccion."
      : "No pudimos cargar los prompts administrables en este momento."
    : null;

  if (error) {
    console.error("managed_prompts_load_failed", error);
  }

  return (
    <ManagedPromptsManager
      initialPrompt={(data ?? null) as ManagedPrompt | null}
      isStorageReady={!storageMessage}
      storageMessage={storageMessage}
    />
  );
}
