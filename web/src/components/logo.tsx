// Text wordmark placeholder — swap for an <Image src="/logo.svg" .../> once
// there's a real brand asset. Kept as one shared component so that swap only
// has to happen in one place.
export function Logo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="text-xl font-bold tracking-tight">TQC</span>
    </div>
  );
}
