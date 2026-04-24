const BASE =
  process.env.PAYPAL_MODE === "live"
    ? "https://api.paypal.com"
    : "https://api.sandbox.paypal.com";

let _token: { value: string; exp: number } | null = null;

export async function getPayPalToken(): Promise<string> {
  if (_token && Date.now() < _token.exp) return _token.value;

  const clientId = process.env.PAYPAL_CLIENT_ID!;
  const secret = process.env.PAYPAL_CLIENT_SECRET!;
  const creds = Buffer.from(`${clientId}:${secret}`).toString("base64");

  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const data = await res.json() as { access_token: string; expires_in: number };
  _token = { value: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 };
  return _token.value;
}

export async function createPayPalOrder(usdCents: number, description: string): Promise<string> {
  const token = await getPayPalToken();
  const usd = (usdCents / 100).toFixed(2);
  const res = await fetch(`${BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value: usd }, description }],
    }),
  });
  const data = await res.json() as { id: string };
  return data.id;
}

export async function capturePayPalOrder(orderId: string): Promise<{ status: string }> {
  const token = await getPayPalToken();
  const res = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  return res.json() as Promise<{ status: string }>;
}
