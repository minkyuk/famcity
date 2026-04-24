const PATREON_BASE = "https://www.patreon.com";
const PATREON_API = "https://www.patreon.com/api/oauth2/v2";

export const PATREON_REDIRECT_URI =
  `${process.env.NEXTAUTH_URL}/api/auth/patreon/callback`;

/** Map pledge amount (cents) to monthly FamCity credits */
export function creditsForCents(cents: number): number {
  if (cents >= 4000) return 15000;
  if (cents >= 1500) return 5000;
  if (cents >= 400)  return 1000;
  if (cents >= 100)  return 200;
  return 0;
}

export function patreonOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.PATREON_CLIENT_ID!,
    redirect_uri: PATREON_REDIRECT_URI,
    scope: "identity identity.memberships",
    state,
  });
  return `${PATREON_BASE}/oauth2/authorize?${params}`;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
}> {
  const res = await fetch(`${PATREON_BASE}/api/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      client_id: process.env.PATREON_CLIENT_ID!,
      client_secret: process.env.PATREON_CLIENT_SECRET!,
      redirect_uri: PATREON_REDIRECT_URI,
    }),
  });
  return res.json() as Promise<{ access_token: string; refresh_token?: string }>;
}

type PatreonIdentity = {
  data: { id: string; attributes: Record<string, unknown> };
  included?: { type: string; attributes: { currently_entitled_amount_cents?: number; patron_status?: string } }[];
};

export async function getPatreonIdentity(accessToken: string): Promise<PatreonIdentity> {
  const res = await fetch(
    `${PATREON_API}/identity?include=memberships&fields[member]=currently_entitled_amount_cents,patron_status`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.json() as Promise<PatreonIdentity>;
}
