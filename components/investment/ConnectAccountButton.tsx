"use client";

import { useState, useCallback, useEffect } from "react";
import { usePlaidLink } from "react-plaid-link";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ConnectAccountButton({ onConnected }: { onConnected: () => void }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSuccess = useCallback(
    async (publicToken: string | null, metadata: { institution: { name: string } | null }) => {
      if (!publicToken) return;

      setLoading(true);
      setError(null);

      const res = await fetch("/api/agents/investment/plaid/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicToken,
          institutionName: metadata.institution?.name ?? "Linked account",
        }),
      });

      setLoading(false);

      if (!res.ok) {
        setError("Something went wrong connecting this account.");
        return;
      }

      onConnected();
    },
    [onConnected]
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
  });

  useEffect(() => {
    if (linkToken && ready) {
      open();
    }
  }, [linkToken, ready, open]);

  async function handleClick() {
    if (linkToken) {
      open();
      return;
    }

    setLoading(true);
    setError(null);

    const res = await fetch("/api/agents/investment/plaid/create-link-token", {
      method: "POST",
    });

    if (!res.ok) {
      setLoading(false);
      const body = await res.json().catch(() => null);
      const detail = body?.detail;
      const detailText =
        typeof detail === "string"
          ? detail
          : detail?.error_message || detail?.display_message || JSON.stringify(detail ?? "");
      setError(`Couldn't start account linking.${detailText ? ` ${detailText}` : ""}`);
      return;
    }

    const { linkToken: token } = await res.json();
    setLinkToken(token);
    setLoading(false);
  }

  return (
    <div>
      <Button variant="outline" size="sm" onClick={handleClick} disabled={loading}>
        <Link2 className="h-4 w-4" />
        {loading ? "Connecting..." : "Connect account"}
      </Button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
