// =============================================================================
// require-permissions.decorator.spec.ts — Unit test @RequirePermissions
// =============================================================================
// Verifica metadata generata + signature overload AND/OR + edge case empty.
// =============================================================================

import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS_METADATA_KEY,
  type PermissionsMetadata,
} from '../interfaces/permissions-metadata.interface';
import { RequirePermissions } from './require-permissions.decorator';

function getMetadata(target: object): PermissionsMetadata | undefined {
  return Reflect.getMetadata(PERMISSIONS_METADATA_KEY, target);
}

describe('@RequirePermissions decorator', () => {
  it('AND mode default con 1 permission', () => {
    class Test {
      @RequirePermissions('users.read')
      method(): void {}
    }
    const metadata = getMetadata(Test.prototype.method);
    expect(metadata).toEqual({ mode: 'AND', permissions: ['users.read'] });
  });

  it('AND mode default con N permissions', () => {
    class Test {
      @RequirePermissions('users.read', 'users.write')
      method(): void {}
    }
    const metadata = getMetadata(Test.prototype.method);
    expect(metadata).toEqual({ mode: 'AND', permissions: ['users.read', 'users.write'] });
  });

  it('OR mode esplicito via options object', () => {
    class Test {
      @RequirePermissions({ mode: 'OR' }, 'admin', 'manager')
      method(): void {}
    }
    const metadata = getMetadata(Test.prototype.method);
    expect(metadata).toEqual({ mode: 'OR', permissions: ['admin', 'manager'] });
  });

  it('AND mode esplicito via options object', () => {
    class Test {
      @RequirePermissions({ mode: 'AND' }, 'p1', 'p2')
      method(): void {}
    }
    const metadata = getMetadata(Test.prototype.method);
    expect(metadata).toEqual({ mode: 'AND', permissions: ['p1', 'p2'] });
  });

  it('throw se empty permissions array (no codes)', () => {
    expect(() => {
      // Rest param zero-arg è TS-valido (firma `...permissions: string[]`);
      // il throw è guard runtime per impedire decorator senza effetto.
      RequirePermissions();
    }).toThrow(/almeno una permission richiesta/i);
  });

  it('throw se solo options object senza permissions', () => {
    expect(() => {
      RequirePermissions({ mode: 'OR' });
    }).toThrow(/almeno una permission richiesta/i);
  });
});
