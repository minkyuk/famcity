"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Script from "next/script";
import { CREDIT_PACKAGES, type CreditPackage } from "@/lib/creditPackages";

declare global {
  interface Window {
    paypal?: {
      Buttons: (opts: {
        createOrder: () => Promise<string>;
        onApprove: (data: { orderID: string }) => Promise<void>;
        onError: (err: unknown) => void;
      }) => { render: (selector: string) => Promise<void>; isEligible: () => boolean };
    };
  }
}

export default function ShopPage() {
  const { data: session } = useSession();
  const [selected, setSelected] = useState<string>(CREDIT_PACKAGES[1].id);
  const [sdkReady, setSdkReady] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [btcLoading, setBtcLoading] = useState(false);

  const pkg = CREDIT_PACKAGES.find((p) => p.id === selected)!;

  // Re-render PayPal button whenever package or SDK readiness changes
  useEffect(() => {
    if (!sdkReady || !window.paypal) return;
    const container = document.getElementById("paypal-btn");
    if (!container) return;
    container.innerHTML = "";

    const selectedId = selected; // capture for closure
    window.paypal.Buttons({
      createOrder: async () => {
        const res = await fetch("/api/payments/paypal/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packageId: selectedId }),
        });
        const data = await res.json() as { orderId?: string; error?: string };
        if (data.error) throw new Error(data.error);
        return data.orderId!;
      },
      onApprove: async (data) => {
        const res = await fetch("/api/payments/paypal/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: data.orderID }),
        });
        const result = await res.json() as { credits?: number; error?: string };
        if (result.error) {
          setMessage({ type: "error", text: result.error });
          return;
        }
        setMessage({ type: "success", text: `${result.credits} credits added to your account!` });
        window.dispatchEvent(new Event("credits-changed"));
      },
      onError: () => setMessage({ type: "error", text: "Payment failed. Please try again." }),
    }).render("#paypal-btn");
  }, [selected, sdkReady]);

  const handleBtcPay = async () => {
    setBtcLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/payments/btc/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packageId: selected }),
      });
      const data = await res.json() as { hostedUrl?: string; error?: string };
      if (data.error) { setMessage({ type: "error", text: data.error }); return; }
      window.open(data.hostedUrl, "_blank");
      setMessage({ type: "success", text: "Crypto payment page opened. Credits are added once confirmed on-chain." });
    } catch {
      setMessage({ type: "error", text: "Failed to create payment. Please try again." });
    } finally {
      setBtcLoading(false);
    }
  };

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen text-gray-400 text-sm">
        Please sign in to purchase credits.
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Get Credits</h1>
      <p className="text-sm text-gray-400 mb-8">
        Credits power space sessions (10 cr) and global hot hours (1000 cr).
      </p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {CREDIT_PACKAGES.map((p: CreditPackage) => (
          <button
            key={p.id}
            onClick={() => { setSelected(p.id); setMessage(null); }}
            className={`rounded-xl border-2 px-4 py-4 text-left transition-all ${
              selected === p.id
                ? "border-orange-400 bg-orange-50"
                : "border-gray-200 hover:border-gray-300 bg-white"
            }`}
          >
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{p.label}</div>
            <div className="text-xl font-bold text-gray-800">{p.credits.toLocaleString()} cr</div>
            <div className="text-sm text-green-600 font-medium">${(p.usdCents / 100).toFixed(2)}</div>
          </button>
        ))}
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 mb-4 text-sm ${
          message.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {message.text}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <p className="text-sm text-gray-500 mb-4">
          Paying for{" "}
          <span className="font-semibold text-gray-700">{pkg.credits.toLocaleString()} credits</span>
          {" "}— ${(pkg.usdCents / 100).toFixed(2)} USD
        </p>

        <div id="paypal-btn" className="mb-3 min-h-[44px]" />

        <div className="flex items-center gap-3 mb-3">
          <div className="flex-1 border-t border-gray-200" />
          <span className="text-xs text-gray-400">or</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>

        <button
          onClick={handleBtcPay}
          disabled={btcLoading}
          className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
        >
          {btcLoading ? "Opening..." : "Pay with Bitcoin / Crypto"}
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center mt-4">
        Bitcoin payments are confirmed on-chain — credits appear within minutes.
      </p>

      <Script
        src={`https://www.paypal.com/sdk/js?client-id=${process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "sb"}&currency=USD`}
        onReady={() => setSdkReady(true)}
      />
    </div>
  );
}
