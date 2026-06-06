// =============================================================================
// set-article-price.dto.spec.ts — unit validation (TD-BS Sub-1, sessione 18)
// =============================================================================

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { SetArticlePriceDto, UpdateArticlePriceDto } from './set-article-price.dto';

const VALID_UUID = '019e1e40-8e25-709a-8952-25ff44e60526';

async function setPriceMessages(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(SetArticlePriceDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

async function updatePriceMessages(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(UpdateArticlePriceDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('SetArticlePriceDto validation', () => {
  it('accepts a valid payload', async () => {
    expect(await setPriceMessages({ priceListId: VALID_UUID, price: 9.5 })).toHaveLength(0);
  });

  it('rejects invalid priceListId → E_ARTICLE_PRICE_LIST_ID_INVALID', async () => {
    expect(await setPriceMessages({ priceListId: 'nope', price: 9.5 })).toContain(
      'E_ARTICLE_PRICE_LIST_ID_INVALID',
    );
  });

  it('rejects negative price → E_ARTICLE_PRICE_INVALID', async () => {
    expect(await setPriceMessages({ priceListId: VALID_UUID, price: -1 })).toContain(
      'E_ARTICLE_PRICE_INVALID',
    );
  });

  it('rejects missing price', async () => {
    expect((await setPriceMessages({ priceListId: VALID_UUID })).length).toBeGreaterThan(0);
  });

  it('rejects missing priceListId', async () => {
    expect((await setPriceMessages({ price: 9.5 })).length).toBeGreaterThan(0);
  });
});

describe('UpdateArticlePriceDto validation', () => {
  it('accepts a valid payload', async () => {
    expect(await updatePriceMessages({ price: 12.0 })).toHaveLength(0);
  });

  it('accepts an empty payload (price optional)', async () => {
    expect(await updatePriceMessages({})).toHaveLength(0);
  });

  it('rejects negative price → E_ARTICLE_PRICE_INVALID', async () => {
    expect(await updatePriceMessages({ price: -5 })).toContain('E_ARTICLE_PRICE_INVALID');
  });
});
