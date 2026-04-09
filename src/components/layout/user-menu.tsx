"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type UserMenuProps = {
  email: string;
};

export function UserMenu({ email }: UserMenuProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [isLoading, setIsLoading] = useState(false);

  async function handleSignOut() {
    setIsLoading(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-sm font-semibold text-slate-900">{email}</p>
        <p className="text-xs text-slate-500">Sesion activa</p>
      </div>
      <Button variant="secondary" onClick={handleSignOut} disabled={isLoading}>
        <LogOut className="mr-2 h-4 w-4" />
        {isLoading ? "Saliendo..." : "Salir"}
      </Button>
    </div>
  );
}
