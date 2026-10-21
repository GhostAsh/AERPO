type TableSkeletonProps = {
  columns?: number;
  rows?: number;
};

export function MetricGridSkeleton() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <article
          className="rounded-lg border border-[#dbe3e1] bg-white p-5 shadow-sm"
          key={index}
        >
          <SkeletonLine className="h-4 w-28" />
          <SkeletonLine className="mt-4 h-8 w-36" />
          <SkeletonLine className="mt-3 h-4 w-40" />
        </article>
      ))}
    </section>
  );
}

export function TableSkeleton({ columns = 5, rows = 5 }: TableSkeletonProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#dbe3e1] bg-white">
      <div
        className="grid place-items-center bg-[#f4f7f6] [&>*]:flex [&>*]:h-full [&>*]:w-full [&>*]:items-center [&>*]:justify-center [&>*]:px-4 [&>*]:py-3 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-[#dbe3e1]"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columns }).map((_, index) => (
          <div key={index}>
            <SkeletonLine className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="divide-y divide-[#dbe3e1]">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div
            className="grid place-items-center [&>*]:h-full [&>*]:w-full [&>*]:content-center [&>*]:px-4 [&>*]:py-4 [&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:border-[#e2e8e6]"
            key={rowIndex}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((_, columnIndex) => (
              <div className="w-full text-center" key={columnIndex}>
                <SkeletonLine
                  className={
                    columnIndex === 1 ? "mx-auto h-4 w-full" : "mx-auto h-4 w-24"
                  }
                />
                {columnIndex === 1 ? (
                  <SkeletonLine className="mx-auto mt-2 h-3 w-3/4" />
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BarsSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-5">
      {[82, 64, 46, 30].map((width, index) => (
        <div key={width}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <SkeletonLine className="h-4 w-28" />
            <SkeletonLine className="h-4 w-20" />
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-[#edf2f1]">
            <div
              className="h-full rounded-full bg-[#c8d3d1]"
              style={{ width: `${width - index * 4}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TelemetryGridSkeleton() {
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <article
          className="rounded-lg border border-white/12 bg-white/[0.06] p-4"
          key={index}
        >
          <div className="flex items-center justify-between gap-3">
            <SkeletonLine className="h-3 w-20 bg-white/12" />
            <SkeletonLine className="h-3 w-14 bg-white/12" />
          </div>
          <SkeletonLine className="mt-5 h-4 w-4/5 bg-white/12" />
          <SkeletonLine className="mt-3 h-4 w-full bg-white/12" />
          <SkeletonLine className="mt-2 h-4 w-2/3 bg-white/12" />
          <div className="mt-5 flex items-center justify-between">
            <SkeletonLine className="h-7 w-36 rounded-full bg-white/12" />
            <SkeletonLine className="h-4 w-10 bg-white/12" />
          </div>
        </article>
      ))}
    </div>
  );
}

export function SkeletonLine({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[#dbe3e1] shadow-sm ${className}`}
    />
  );
}
