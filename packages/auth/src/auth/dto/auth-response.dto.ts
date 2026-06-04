// Shape risposta per login + refresh.
// Coerente con §C2: response wrappata in { data, meta?, error? }.
// Il wrapping { data } e' fatto a livello controller / interceptor; il DTO
// qui descrive la parte interna `data`.

export interface AuthTokensPayload {
  accessToken: string;
  refreshToken: string;
  /** Access token TTL in secondi (es. 900 = 15min). Coerente con OAuth2 spec. */
  expiresIn: number;
}
