// =============================================================================
// create-menu.dto.spec.ts — unit validation (TD-BS Sub-1, sessione 18)
// =============================================================================
// Copre i constraint class-validator del DTO senza il harness E2E (vedi
// ADR-0019 §TD-BS sessione 18). plainToInstance applica @Type, validate()
// esegue i decorator. I `message` dei decorator sono gli errorCode E_*.
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateMenuDto } from './create-menu.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateMenuDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateMenuDto validation', () => {
  it('accepts a valid minimal payload', async () => {
    expect(await messagesFor({ name: 'Menu Pranzo' })).toHaveLength(0);
  });

  it('accepts a valid full payload', async () => {
    const msgs = await messagesFor({
      name: 'Menu Pranzo',
      description: 'Descrizione del menu',
      isActive: true,
      sortOrder: 3,
    });
    expect(msgs).toHaveLength(0);
  });

  it('rejects name too short → E_MENU_NAME_TOO_SHORT', async () => {
    expect(await messagesFor({ name: 'a' })).toContain('E_MENU_NAME_TOO_SHORT');
  });

  it('rejects name too long → E_MENU_NAME_TOO_LONG', async () => {
    expect(await messagesFor({ name: 'x'.repeat(101) })).toContain('E_MENU_NAME_TOO_LONG');
  });

  it('rejects missing name', async () => {
    expect((await messagesFor({})).length).toBeGreaterThan(0);
  });

  it('rejects description too long → E_MENU_DESCRIPTION_TOO_LONG', async () => {
    const msgs = await messagesFor({ name: 'Menu', description: 'x'.repeat(501) });
    expect(msgs).toContain('E_MENU_DESCRIPTION_TOO_LONG');
  });

  it('rejects negative sortOrder → E_MENU_SORT_ORDER_INVALID', async () => {
    const msgs = await messagesFor({ name: 'Menu', sortOrder: -1 });
    expect(msgs).toContain('E_MENU_SORT_ORDER_INVALID');
  });

  it('rejects non-boolean isActive → E_MENU_IS_ACTIVE_INVALID', async () => {
    const msgs = await messagesFor({ name: 'Menu', isActive: 'yes' });
    expect(msgs).toContain('E_MENU_IS_ACTIVE_INVALID');
  });
});
