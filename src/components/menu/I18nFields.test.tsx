import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nFields } from './I18nFields';

describe('campos por idioma', () => {
  it('cada campo lleva el idioma de su texto (lang), también en las descripciones', () => {
    for (const multiline of [false, true]) {
      const html = renderToStaticMarkup(
        <I18nFields prefix="name" label="Nombre" enabled={['es', 'en', 'ca']} values={{ es: 'Croquetas' }} maxLength={120} multiline={multiline} idPrefix="p" />,
      );
      const tag = multiline ? 'textarea' : 'input';
      for (const locale of ['es', 'en', 'ca']) {
        expect(html, `${tag} ${locale}`).toMatch(new RegExp(`<${tag}[^>]*name="name_${locale}"[^>]*lang="${locale}"|<${tag}[^>]*lang="${locale}"[^>]*name="name_${locale}"`));
      }
    }
  });
});
