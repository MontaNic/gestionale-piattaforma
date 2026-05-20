// =============================================================================
// create-article.dto.spec.ts — unit validation (TD-BS Sub-1, sessione 18)
// =============================================================================
// Caso enum critico: @IsEnum(Allergen|DietaryTag|PrintDepartment|Channel).
// Gli enum sono importati da @gestionale/db (re-export Prisma). Se questo
// spec passa → conferma che gli enum si caricano correttamente nel project
// `unit` (il problema TD-BS era SOLO il harness E2E SWC, non il codice DTO).
// =============================================================================

import { Allergen, Channel, DietaryTag, PrintDepartment } from '@gestionale/db';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreateArticleDto } from './create-article.dto';

const VALID_UUID = '019e1e40-8e25-709a-8952-25ff44e60526';

const VALID_PAYLOAD: Record<string, unknown> = {
  categoryId: VALID_UUID,
  name: 'Bruschetta al pomodoro',
  descriptionShort: 'Pane tostato, pomodoro, basilico',
  basePrice: 6.5,
  vatPercent: 10,
  printDepartment: PrintDepartment.cucina,
};

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreateArticleDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateArticleDto validation', () => {
  it('enum import sanity — Allergen/Channel/DietaryTag/PrintDepartment defined', () => {
    // Discrimine TD-BS: se gli enum fossero undefined (come nel harness E2E SWC)
    // questo test fallirebbe. Conferma che il problema e' SOLO l'harness E2E.
    expect(Allergen).toBeDefined();
    expect(Channel).toBeDefined();
    expect(DietaryTag).toBeDefined();
    expect(PrintDepartment).toBeDefined();
  });

  it('accepts a valid minimal payload', async () => {
    expect(await messagesFor(VALID_PAYLOAD)).toHaveLength(0);
  });

  it('accepts a valid full payload with enum arrays', async () => {
    const msgs = await messagesFor({
      ...VALID_PAYLOAD,
      descriptionLong: 'Descrizione estesa',
      allergens: [Allergen.cereali_glutine],
      dietaryTags: [DietaryTag.vegano, DietaryTag.vegetariano],
      channelVisibility: [Channel.cassa, Channel.menu_online],
      preparationTimeMinutes: 5,
      sortOrder: 1,
    });
    expect(msgs).toHaveLength(0);
  });

  it('rejects name too short → E_ARTICLE_NAME_TOO_SHORT', async () => {
    expect(await messagesFor({ ...VALID_PAYLOAD, name: 'a' })).toContain(
      'E_ARTICLE_NAME_TOO_SHORT',
    );
  });

  it('rejects missing descriptionShort', async () => {
    const { descriptionShort: _omit, ...rest } = VALID_PAYLOAD;
    void _omit;
    expect((await messagesFor(rest)).length).toBeGreaterThan(0);
  });

  it('rejects negative basePrice → E_ARTICLE_BASE_PRICE_INVALID', async () => {
    expect(await messagesFor({ ...VALID_PAYLOAD, basePrice: -1 })).toContain(
      'E_ARTICLE_BASE_PRICE_INVALID',
    );
  });

  it('rejects VAT not in [4,10,22] → E_ARTICLE_VAT_INVALID', async () => {
    expect(await messagesFor({ ...VALID_PAYLOAD, vatPercent: 15 })).toContain(
      'E_ARTICLE_VAT_INVALID',
    );
  });

  it('accepts each valid VAT rate (4, 10, 22)', async () => {
    for (const vat of [4, 10, 22]) {
      expect(await messagesFor({ ...VALID_PAYLOAD, vatPercent: vat })).toHaveLength(0);
    }
  });

  it('rejects invalid categoryId (not UUID) → E_ARTICLE_CATEGORY_ID_INVALID', async () => {
    expect(await messagesFor({ ...VALID_PAYLOAD, categoryId: 'not-a-uuid' })).toContain(
      'E_ARTICLE_CATEGORY_ID_INVALID',
    );
  });

  it('rejects invalid allergen enum value → E_ARTICLE_ALLERGENS_INVALID', async () => {
    expect(await messagesFor({ ...VALID_PAYLOAD, allergens: ['not_an_allergen'] })).toContain(
      'E_ARTICLE_ALLERGENS_INVALID',
    );
  });

  it('rejects invalid printDepartment enum → E_ARTICLE_PRINT_DEPARTMENT_INVALID', async () => {
    expect(await messagesFor({ ...VALID_PAYLOAD, printDepartment: 'forno_a_legna' })).toContain(
      'E_ARTICLE_PRINT_DEPARTMENT_INVALID',
    );
  });

  it('rejects missing printDepartment (required)', async () => {
    const { printDepartment: _omit, ...rest } = VALID_PAYLOAD;
    void _omit;
    expect((await messagesFor(rest)).length).toBeGreaterThan(0);
  });

  it('rejects invalid channelVisibility enum → E_ARTICLE_CHANNEL_VISIBILITY_INVALID', async () => {
    expect(await messagesFor({ ...VALID_PAYLOAD, channelVisibility: ['carrozza'] })).toContain(
      'E_ARTICLE_CHANNEL_VISIBILITY_INVALID',
    );
  });
});
