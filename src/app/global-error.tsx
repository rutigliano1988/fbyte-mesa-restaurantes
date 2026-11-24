'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es">
      <body style={{ margin: 0, background: '#F8F5EF', color: '#0A1330', fontFamily: 'system-ui, sans-serif' }}>
        <main style={{ maxWidth: 420, margin: '0 auto', padding: '15vh 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Algo ha fallado</h1>
          <p style={{ margin: 0, color: '#3A4157' }}>
            Vuelve a intentarlo en un momento. Si sigue pasando, escríbenos y lo miramos.
          </p>
          <div>
            <button
              type="button"
              onClick={() => reset()}
              style={{ background: '#FF7A1A', color: '#0A1330', border: '3px solid #0A1330', borderRadius: 12, padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }}
            >
              Reintentar
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
