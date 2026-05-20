// =============================================================================
// create-price-list.dto.spec.ts — unit validation (TD-BS Sub-1, sessione 18)
// =============================================================================

import { Channel } from '@gestionale/db';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import { CreatePriceListDto } from './create-price-list.dto';

async function messagesFor(payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(CreatePriceListDto, payload);
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreatePriceListDto validation', () => {
  it('accepts a valid minimal payload', async () => {
    expect(await messagesFor({ name: 'Base', channels: [Channel.cassa] })).toHaveLength(0);
  });

  it('accepts a valid full payload', async () => {
    const msgs = await messagesFor({
      name: 'Estivo',
      channels: [Channel.cassa, Channel.menu_online, Channel.delivery],
      priority: 5,
      isActive: true,
    });
    expect(msgs).toHaveLength(0);
  });

  it('rejects name too short → E_PRICE_LIST_NAME_TOO_SHORT', async () => {
    expect(await messagesFor({ name: 'a', channels: [Channel.cassa] })).toContain(
      'E_PRICE_LIST_NAME_TOO_SHORT',
    );
  });

  it('rejects missing name', async () => {
    expect((await messagesFor({ channels: [Channel.cassa] })).length).toBeGreaterThan(0);
  });

  it('rejects empty channels → E_PRICE_LIST_CHANNELS_REQUIRED', async () => {
    expect(await messagesFor({ name: 'Base', channels: [] })).toContain(
      'E_PRICE_LIST_CHANNELS_REQUIRED',
    );
  });

  it('rejects missing channels', async () => {
    expect((await messagesFor({ name: 'Base' })).length).toBeGreaterThan(0);
  });

  it('rejects invalid channel enum value → E_PRICE_LIST_CHANNELS_INVALID', async () => {
    expect(await messagesFor({ name: 'Base', channels: ['piccione_viaggiatore'] })).toContain(
      'E_PRICE_LIST_CHANNELS_INVALID',
    );
  });

  it('rejects negative priority → E_PRICE_LIST_PRIORITY_INVALID', async () => {
    expect(await messagesFor({ name: 'Base', channels: [Channel.cassa], priority: -1 })).toContain(
      'E_PRICE_LIST_PRIORITY_INVALID',
    );
  });
});
