import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MenuWeekdays } from './MenuWeekdays';

const HINT = 'En un menú especial, marca todos los días en que se sirve.';
const checked = (html: string) => (html.match(/checked=""/g) ?? []).length;

describe('días de un menú', () => {
  it('al crear un menú especial salen marcados los 7 días, con la pista', () => {
    const html = renderToStaticMarkup(<MenuWeekdays kind="special" saved={null} />);
    expect(checked(html)).toBe(7);
    expect(html).toContain(HINT);
  });

  it('al crear un menú del día, de lunes a viernes y sin la pista', () => {
    const html = renderToStaticMarkup(<MenuWeekdays kind="daily" saved={null} />);
    expect(checked(html)).toBe(5);
    expect(html).not.toContain(HINT);
  });

  it('al editar, los días guardados', () => {
    expect(checked(renderToStaticMarkup(<MenuWeekdays kind="special" saved={[4, 5]} />))).toBe(2);
  });
});
