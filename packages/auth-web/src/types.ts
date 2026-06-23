export interface LoginResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

// [livello 2 — portale cliente, ADR-0046] discriminatore identità (wire = stringa).
export type UserTipo = 'operatore' | 'cliente';
export type ClienteRuolo = 'admin' | 'utente';

export interface MeUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
  // [livello 2 — portale cliente, ADR-0046] routing FE per tipo + scoping azienda.
  tipo: UserTipo;
  aziendaId: string | null;
  clienteRuolo: ClienteRuolo | null;
}

export interface MeRole {
  id: string;
  name: string;
  sedeId: string | null;
}

export interface MeResponse {
  data: {
    user: MeUser;
    roles: MeRole[];
    permissions: string[];
  };
}
