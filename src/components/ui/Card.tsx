export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[6px_18px_18px_18px] border-[3px] border-ink bg-white p-6 shadow-hard ${className}`}>
      {children}
    </div>
  );
}
