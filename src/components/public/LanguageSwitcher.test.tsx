import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LanguageSwitcher } from './LanguageSwitcher';

describe('selector de idioma', () => {
  it('enlaza la misma página en cada idioma con ?lang=', () => {
    const html = renderToStaticMarkup(<LanguageSwitcher enabled={['es', 'en']} locale="es" path="/la-taberna" label="Idioma" />);
    expect(html).toContain('href="/la-taberna?lang=es"');
    expect(html).toContain('href="/la-taberna?lang=en"');
  });

  it('conserva la consulta extra (la carta elegida)', () => {
    const html = renderToStaticMarkup(
      <LanguageSwitcher enabled={['es', 'en']} locale="es" path="/la-taberna/menu" label="Idioma" query={{ carta: 'a b' }} />,
    );
    expect(html).toContain('href="/la-taberna/menu?lang=en&amp;carta=a%20b"');
  });
});
