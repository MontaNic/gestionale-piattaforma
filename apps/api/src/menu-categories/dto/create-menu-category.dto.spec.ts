// =============================================================================
// create-menu-category.dto.spec.ts — unit validation (TD-BS Sub-1, sessione 18)
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateMenuCategoryDto } from './create-menu-category.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateMenuCategoryDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateMenuCategoryDto validation', () => {
  it('accepts a valid minimal payload', async () => {
    expect(await messagesFor({ name: 'Antipasti' })).toHaveLength(0);
  });

  it('accepts a valid full payload', async () => {
    expect(await messagesFor({ name: 'Antipasti', sortOrder: 2 })).toHaveLength(0);
  });

  it('rejects name too short → E_MENU_CATEGORY_NAME_TOO_SHORT', async () => {
    expect(await messagesFor({ name: 'a' })).toContain('E_MENU_CATEGORY_NAME_TOO_SHORT');
  });

  it('rejects name too long → E_MENU_CATEGORY_NAME_TOO_LONG', async () => {
    expect(await messagesFor({ name: 'x'.repeat(101) })).toContain('E_MENU_CATEGORY_NAME_TOO_LONG');
  });

  it('rejects missing name', async () => {
    expect((await messagesFor({})).length).toBeGreaterThan(0);
  });

  it('rejects negative sortOrder → E_MENU_CATEGORY_SORT_ORDER_INVALID', async () => {
    expect(await messagesFor({ name: 'Antipasti', sortOrder: -1 })).toContain(
      'E_MENU_CATEGORY_SORT_ORDER_INVALID',
    );
  });
});
