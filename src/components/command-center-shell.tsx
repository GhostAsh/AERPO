import Link from "next/link";

type CommandCenterShellProps = {
  activePage:
    | "scorecard"
    | "ledger-review"
    | "telemetry"
    | "corrections"
    | "approvals";
  children: React.ReactNode;
  eyebrow: string;
  title: string;
};

const navItems = [
  { label: "Scorecard", code: "SC", href: "/dashboard", page: "scorecard" },
  {
    label: "Ledger Review",
    code: "LR",
    href: "/dashboard/ledger-review",
    page: "ledger-review",
  },
  { label: "Telemetry", code: "TM", href: "/dashboard/telemetry", page: "telemetry" },
  {
    label: "Corrections",
    code: "CR",
    href: "/dashboard/corrections",
    page: "corrections",
  },
  {
    label: "Approvals",
    code: "AP",
    href: "/dashboard/approvals",
    page: "approvals",
  },
];

export function CommandCenterShell({
  activePage,
  children,
  eyebrow,
  title,
}: CommandCenterShellProps) {
  return (
    <main className="h-screen overflow-hidden bg-[#eef2f3] text-[#14211f]">
      <div className="grid h-screen grid-rows-[auto_1fr] lg:grid-cols-[280px_1fr] lg:grid-rows-none">
        <aside className="border-b border-[#c8d3d1] bg-[#102522] px-5 py-5 text-white lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-lg bg-teal-300 text-sm font-black text-[#102522]">
              AE
            </div>
            <div>
              <p className="text-lg font-semibold">AERPO</p>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#a7bfba]">
                Command Center
              </p>
            </div>
          </div>

          <nav className="mt-8 flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {navItems.map((item) => {
              const isActive = item.page === activePage;

              return (
                <Link
                  className={`flex min-w-fit items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-semibold transition ${
                    isActive
                      ? "bg-white text-[#102522]"
                      : "text-[#d2dfdc] hover:bg-white/10 hover:text-white"
                  }`}
                  href={item.href}
                  key={item.label}
                >
                  <span
                    className={`grid size-8 place-items-center rounded-md text-xs ${
                      isActive ? "bg-teal-100" : "bg-white/10"
                    }`}
                  >
                    {item.code}
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-8 hidden rounded-lg border border-white/12 bg-white/[0.06] p-4 lg:block">
            <p className="text-sm font-semibold text-white">System posture</p>
            <div className="mt-4 space-y-3 text-sm text-[#c7d8d4]">
              <StatusLine label="Supabase" value="Connected" />
              <StatusLine label="Realtime" value="Standing by" />
              <StatusLine label="Model" value="Token pending" />
            </div>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <header className="shrink-0 border-b border-[#c8d3d1] bg-white/82 px-5 py-4 backdrop-blur sm:px-8 lg:px-10">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-700">
                  {eyebrow}
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[#102522] sm:text-4xl">
                  {title}
                </h1>
              </div>
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <HeaderBadge label="Environment" value="Supabase dev" />
                <HeaderBadge label="Review SLA" value="14 open min" />
                <HeaderBadge label="Today" value="Oct 9, 2026" />
              </div>
            </div>
          </header>

          <section className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-8 lg:px-10">
            <div className="mx-auto flex w-full max-w-[100rem] flex-col gap-6">
              {children}
            </div>
          </section>

          <footer className="shrink-0 border-t border-[#c8d3d1] bg-white px-5 py-4 text-sm text-[#63716f] sm:px-8 lg:px-10">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p>AERPO telemetry shell prepared for Supabase Realtime.</p>
              <p>Human approval required before ledger mutation.</p>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}

function HeaderBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#c8d3d1] bg-[#f8fbfa] px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#63716f]">
        {label}
      </p>
      <p className="mt-1 font-semibold text-[#102522]">{value}</p>
    </div>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}
