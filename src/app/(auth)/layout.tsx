export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_right,_rgba(251,122,66,0.18),_transparent_28%),radial-gradient(circle_at_left,_rgba(12,170,148,0.16),_transparent_24%),linear-gradient(180deg,#f8fbfa_0%,#eef5f3_100%)] px-4 py-12">
      {children}
    </div>
  );
}
