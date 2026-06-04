export interface LoginResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

export interface MeUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
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
