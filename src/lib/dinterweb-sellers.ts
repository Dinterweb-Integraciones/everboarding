import type { User } from "@supabase/supabase-js";

export type DinterwebSellerIdentity = {
  name: string;
  email: string;
  company: string;
};

function resolveUserDisplayName(user: User) {
  const metadata = user.user_metadata as Record<string, unknown> | undefined;
  const fullName = typeof metadata?.full_name === "string" ? metadata.full_name : null;
  const name = typeof metadata?.name === "string" ? metadata.name : null;

  return (fullName || name || user.email?.split("@")[0] || "Vendedor").trim();
}

export function getDinterwebSellerIdentity(user: User): DinterwebSellerIdentity {
  return {
    name: resolveUserDisplayName(user),
    email: user.email?.trim().toLowerCase() || "",
    company: "Dinterweb",
  };
}
