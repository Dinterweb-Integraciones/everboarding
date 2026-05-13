import { requireUser } from "@/lib/auth";

export default async function DinterwebSalesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireUser("/sales/dinterweb");

  return children;
}
