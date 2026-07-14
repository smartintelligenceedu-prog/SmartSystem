import Image from "next/image";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Image src="/logo.png" alt="Smart Intelligence Edu" width={295} height={100} className="h-auto w-full" priority />
    </div>
  );
}
