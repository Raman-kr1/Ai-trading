export default function Skeleton({ className = '', height = 'h-4', width = 'w-full' }) {
  return (
    <div
      className={`bg-bg-raised animate-pulse rounded ${height} ${width} ${className}`}
      aria-hidden
    />
  );
}
