const TONES = {
  error: 'border-red-700 bg-red-50 text-red-800',
  success: 'border-navy bg-on-navy-soft text-ink',
  info: 'border-ink bg-peach-soft text-ink',
} as const;

export function Notice({ tone = 'info', children }: { tone?: keyof typeof TONES; children: React.ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-[6px] border-2 px-4 py-3 text-sm font-medium ${TONES[tone]}`}>
      {children}
    </div>
  );
}
