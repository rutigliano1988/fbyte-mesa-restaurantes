'use client';

import { useState } from 'react';

/** El iframe de Google Maps solo se carga si el comensal lo pide (sin cookies de terceros por defecto). */
export function MapEmbed({ src, title, buttonLabel, notice }: { src: string; title: string; buttonLabel: string; notice: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border-2 border-neutral-300 px-4 py-2 font-semibold hover:border-neutral-500"
        >
          {buttonLabel}
        </button>
        <p className="mt-2 text-xs text-neutral-500">{notice}</p>
      </div>
    );
  }
  return (
    <iframe
      src={src}
      title={title}
      className="h-72 w-full rounded-lg border-0"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
    />
  );
}
