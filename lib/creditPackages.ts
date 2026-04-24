export interface CreditPackage {
  id: string;
  label: string;
  credits: number;
  usdCents: number; // in cents
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: "starter",  label: "Starter",    credits: 200,   usdCents: 100  },
  { id: "bolt",     label: "Bolt Pack",  credits: 1000,  usdCents: 400  },
  { id: "fire",     label: "Fire Pack",  credits: 5000,  usdCents: 1500 },
  { id: "power",    label: "Power Pack", credits: 15000, usdCents: 4000 },
];

export function getPackage(id: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((p) => p.id === id);
}
