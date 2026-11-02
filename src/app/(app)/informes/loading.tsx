// Se muestra al entrar a Informes mientras el servidor arma los paneles.
export default function ReportsLoading() {
  return (
    <div className="min-h-[calc(100vh-116px)] bg-[#f5f8fb] px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex w-full flex-col gap-5">
        <div className="border-b border-[#dfe3eb] pb-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00a4bd]">Informes</p>
          <h1 className="mt-2 text-2xl font-black text-[#213343]">Paneles</h1>
          <p className="mt-2 text-xs font-semibold text-[#516f90]">Cargando informes...</p>
        </div>
        <section className="animate-pulse border border-[#dfe3eb] bg-white p-4">
          <div className="h-6 w-48 rounded bg-[#edf3f7]" />
          <div className="mt-3 h-4 w-72 rounded bg-[#edf3f7]" />
          <div className="mt-6 space-y-3">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-10 rounded bg-[#f5f8fa]" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
