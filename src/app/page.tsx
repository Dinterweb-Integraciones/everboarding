import { redirect } from "next/navigation";

import { getOptionalUser } from "@/lib/auth";

export default async function HomePage() {
  const { user } = await getOptionalUser();

  redirect(user ? "/dashboard" : "/login");
}
