/** Mosaé wordmark: Fraunces SemiBold, tight tracking (matches the marketing site). */
export function Logo({ className = "" }: { className?: string }) {
  return <span className={`font-display text-2xl font-semibold tracking-[-0.6px] text-ink ${className}`}>Mosaé</span>;
}
