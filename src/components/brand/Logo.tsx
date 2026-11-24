import Image from 'next/image';
import { BRAND } from '@/config/brand';

type Props = { onDark?: boolean; showCompany?: boolean };

export function Logo({ onDark = false, showCompany = true }: Props) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Image
        src={onDark ? '/brand/globo-sobre-oscuro.svg' : '/brand/globo-sobre-claro.svg'}
        alt=""
        width={34}
        height={32}
        unoptimized
        priority
      />
      <span className="flex flex-col leading-none">
        <span
          className={`text-xl font-black tracking-tight ${onDark ? 'text-white' : 'text-ink'}`}
          style={{ fontStretch: '112%' }}
        >
          {BRAND.productName}
        </span>
        {showCompany && (
          <span className={`text-[11px] font-medium ${onDark ? 'text-on-ink' : 'text-muted'}`}>
            de {BRAND.company}
          </span>
        )}
      </span>
    </span>
  );
}
