import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getOptionalUser } from "@/lib/auth";

export default async function LoginPage() {
  const { user } = await getOptionalUser();

  if (user) {
    redirect("/dashboard");
  }

  return <AuthForm mode="login" />;
}
