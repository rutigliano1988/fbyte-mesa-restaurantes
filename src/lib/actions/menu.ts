'use server';

import { redirect } from 'next/navigation';
import { mapDbError } from '@/lib/db-errors';
import { fieldErrorsFrom, formStrings, type FormState } from '@/lib/forms';
import {
  confirmSchema,
  inlineItemSchema,
  menuFormSchema,
  readInlineItemForm,
  readMenuForm,
  readSectionForm,
  sectionFormSchema,
  unavailableModeSchema,
  type MenuFormValues,
} from '@/lib/menu/validation';
import { uuidSchema } from '@/lib/validation/schemas';
import { runPanelAction, throwIfError, type SupabaseServerClient } from './run';

type Table = 'menus' | 'menu_sections' | 'menu_items';

const isUuid = (value: unknown): value is string => typeof value === 'string' && uuidSchema.safeParse(value).success;

function field(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === 'string' ? value : '';
}

/** Siguiente posición libre (al final) de una lista. */
async function nextPosition(supabase: SupabaseServerClient, table: Table, column: string, value: string): Promise<number> {
  const { data } = await supabase.from(table).select('position').eq(column, value).order('position', { ascending: false }).limit(1).maybeSingle();
  return ((data as { position: number } | null)?.position ?? -1) + 1;
}

/** UPDATE de una fila del restaurante con la sesión del usuario; 0 filas → sin permiso. */
async function updateOne(
  supabase: SupabaseServerClient,
  table: Table,
  id: string,
  restaurantId: string,
  values: Record<string, unknown>,
  success: string,
): Promise<FormState> {
  const { data, error } = await supabase.from(table).update(values).eq('id', id).eq('restaurant_id', restaurantId).select('id');
  if (error) return { error: mapDbError(error.message) };
  if (!data?.length) return { error: mapDbError('FORBIDDEN') };
  return { success };
}

async function deleteOne(supabase: SupabaseServerClient, table: Table, id: string, restaurantId: string, success: string): Promise<FormState> {
  const { data, error } = await supabase.from(table).delete().eq('id', id).eq('restaurant_id', restaurantId).select('id');
  if (error) return { error: mapDbError(error.message) };
  if (!data?.length) return { error: mapDbError('FORBIDDEN') };
  return { success };
}

/** Columnas de la carta (el tipo no cambia después de crearla). */
function menuColumns(v: MenuFormValues) {
  return {
    names: v.names,
    active: v.active,
    price_cents: v.priceCents,
    includes: v.includes,
    weekdays: v.weekdays,
    start_minute: v.startMinute,
    end_minute: v.endMinute,
    date_from: v.dateFrom,
    date_to: v.dateTo,
  };
}

// Cartas ----------------------------------------------------------------------------------------------------
export async function createMenu(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = menuFormSchema.safeParse(readMenuForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  const created = { id: '' };
  const result = await runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const position = await nextPosition(supabase, 'menus', 'restaurant_id', restaurantId);
    const { data, error } = await supabase
      .from('menus')
      .insert({ restaurant_id: restaurantId, kind: parsed.data.kind, position, ...menuColumns(parsed.data) })
      .select('id')
      .single();
    if (error) return { error: mapDbError(error.message) };
    created.id = (data as { id: string }).id;
    return { success: 'Carta creada.' };
  });
  if (created.id) redirect(`/panel/${restaurantId}/menu/${created.id}`);
  return result;
}

export async function updateMenu(_prev: FormState, fd: FormData): Promise<FormState> {
  const menuId = field(fd, 'menuId');
  if (!isUuid(menuId)) return { error: mapDbError(undefined) };
  const parsed = menuFormSchema.safeParse(readMenuForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', (supabase) =>
    updateOne(supabase, 'menus', menuId, restaurantId, menuColumns(parsed.data), 'Carta guardada.'),
  );
}

/** Botón «Mostrar en la web» / «Ocultar de la web» de la lista de cartas. */
export async function setMenuActive(fd: FormData): Promise<void> {
  const menuId = field(fd, 'menuId');
  if (!isUuid(menuId)) return;
  const restaurantId = field(fd, 'restaurantId');
  const active = field(fd, 'active') === '1';
  const result = await runPanelAction(restaurantId, 'menu.edit', (supabase) =>
    updateOne(supabase, 'menus', menuId, restaurantId, { active }, active ? 'Carta visible.' : 'Carta oculta.'),
  );
  throwIfError(result);
}

export async function deleteMenu(_prev: FormState, fd: FormData): Promise<FormState> {
  const confirm = confirmSchema.safeParse(formStrings(fd, ['confirm']));
  if (!confirm.success) return { fieldErrors: fieldErrorsFrom(confirm.error) };
  const menuId = field(fd, 'menuId');
  if (!isUuid(menuId)) return { error: mapDbError(undefined) };
  const restaurantId = field(fd, 'restaurantId');
  const result = await runPanelAction(restaurantId, 'menu.edit', (supabase) =>
    deleteOne(supabase, 'menus', menuId, restaurantId, 'Carta borrada.'),
  );
  if (!result.error) redirect(`/panel/${restaurantId}/menu`);
  return result;
}

// Secciones -------------------------------------------------------------------------------------------------
export async function addSection(_prev: FormState, fd: FormData): Promise<FormState> {
  const menuId = field(fd, 'menuId');
  if (!isUuid(menuId)) return { error: mapDbError(undefined) };
  const parsed = sectionFormSchema.safeParse(readSectionForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const position = await nextPosition(supabase, 'menu_sections', 'menu_id', menuId);
    const { error } = await supabase
      .from('menu_sections')
      .insert({ restaurant_id: restaurantId, menu_id: menuId, names: parsed.data.names, position });
    return error ? { error: mapDbError(error.message) } : { success: 'Sección añadida.' };
  });
}

export async function renameSection(_prev: FormState, fd: FormData): Promise<FormState> {
  const sectionId = field(fd, 'sectionId');
  if (!isUuid(sectionId)) return { error: mapDbError(undefined) };
  const parsed = sectionFormSchema.safeParse(readSectionForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', (supabase) =>
    updateOne(supabase, 'menu_sections', sectionId, restaurantId, { names: parsed.data.names }, 'Sección guardada.'),
  );
}

export async function deleteSection(_prev: FormState, fd: FormData): Promise<FormState> {
  const confirm = confirmSchema.safeParse(formStrings(fd, ['confirm']));
  if (!confirm.success) return { fieldErrors: fieldErrorsFrom(confirm.error) };
  const sectionId = field(fd, 'sectionId');
  if (!isUuid(sectionId)) return { error: mapDbError(undefined) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', (supabase) =>
    deleteOne(supabase, 'menu_sections', sectionId, restaurantId, 'Sección borrada. Los platos siguen en tu lista de platos.'),
  );
}

// Elementos de una sección ----------------------------------------------------------------------------------
export async function addExistingDish(_prev: FormState, fd: FormData): Promise<FormState> {
  const sectionId = field(fd, 'sectionId');
  if (!isUuid(sectionId)) return { error: mapDbError(undefined) };
  const dishId = field(fd, 'dishId');
  if (!isUuid(dishId)) return { fieldErrors: { dishId: 'Elige un plato.' } };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const position = await nextPosition(supabase, 'menu_items', 'section_id', sectionId);
    const { error } = await supabase
      .from('menu_items')
      .insert({ restaurant_id: restaurantId, section_id: sectionId, dish_id: dishId, position });
    return error ? { error: mapDbError(error.message) } : { success: 'Plato añadido.' };
  });
}

export async function addInlineItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const sectionId = field(fd, 'sectionId');
  if (!isUuid(sectionId)) return { error: mapDbError(undefined) };
  const parsed = inlineItemSchema.safeParse(readInlineItemForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const position = await nextPosition(supabase, 'menu_items', 'section_id', sectionId);
    const { error } = await supabase.from('menu_items').insert({
      restaurant_id: restaurantId,
      section_id: sectionId,
      inline_names: parsed.data.names,
      inline_allergens: parsed.data.allergens,
      position,
    });
    return error ? { error: mapDbError(error.message) } : { success: 'Plato añadido a este menú.' };
  });
}

export async function updateInlineItem(_prev: FormState, fd: FormData): Promise<FormState> {
  const itemId = field(fd, 'itemId');
  if (!isUuid(itemId)) return { error: mapDbError(undefined) };
  const parsed = inlineItemSchema.safeParse(readInlineItemForm(fd));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', (supabase) =>
    updateOne(
      supabase,
      'menu_items',
      itemId,
      restaurantId,
      { inline_names: parsed.data.names, inline_allergens: parsed.data.allergens },
      'Plato guardado.',
    ),
  );
}

/** Quita el plato de la sección (el plato sigue en la lista de platos). */
export async function removeItem(fd: FormData): Promise<void> {
  const itemId = field(fd, 'itemId');
  if (!isUuid(itemId)) return;
  const restaurantId = field(fd, 'restaurantId');
  const result = await runPanelAction(restaurantId, 'menu.edit', (supabase) =>
    deleteOne(supabase, 'menu_items', itemId, restaurantId, 'Quitado de la sección.'),
  );
  throwIfError(result);
}

// Orden (arrastrar o Subir/Bajar) -----------------------------------------------------------------------------
export type ReorderEntity = 'menus' | 'sections' | 'items';

const REORDER = {
  menus: { fn: 'reorder_menus', param: 'p_restaurant_id' },
  sections: { fn: 'reorder_sections', param: 'p_menu_id' },
  items: { fn: 'reorder_items', param: 'p_section_id' },
} as const;

/** Guarda el orden completo de una lista. parentId: el restaurante, la carta o la sección. */
export async function reorderMenuEntries(
  restaurantId: string,
  entity: ReorderEntity,
  parentId: string,
  ids: string[],
): Promise<FormState> {
  if (!(entity in REORDER) || !isUuid(parentId) || !Array.isArray(ids) || !ids.every(isUuid)) {
    return { error: mapDbError('INVALID_INPUT') };
  }
  const { fn, param } = REORDER[entity];
  return runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const { error } = await supabase.rpc(fn, { [param]: parentId, p_ids: ids });
    return error ? { error: mapDbError(error.message) } : { success: 'Orden guardado.' };
  });
}

// Ajustes ---------------------------------------------------------------------------------------------------
export async function saveUnavailableMode(_prev: FormState, fd: FormData): Promise<FormState> {
  const parsed = unavailableModeSchema.safeParse(field(fd, 'mode'));
  if (!parsed.success) return { fieldErrors: { mode: 'Elige cómo se ven los platos agotados.' } };
  const restaurantId = field(fd, 'restaurantId');
  return runPanelAction(restaurantId, 'menu.edit', async (supabase) => {
    const { error } = await supabase.rpc('set_menu_unavailable_mode', { p_restaurant_id: restaurantId, p_mode: parsed.data });
    return error ? { error: mapDbError(error.message) } : { success: 'Guardado.' };
  });
}
