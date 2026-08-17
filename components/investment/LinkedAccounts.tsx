"use client";

import { useState } from "react";
import { RefreshCw, Unlink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ConnectAccountButton } from "@/components/investment/ConnectAccountButton";
import type { PlaidLinkedAccount } from "@/lib/agents/investment/types";

export function LinkedAccounts({
  items,
  onRefresh,
}: {
  items: PlaidLinkedAccount[];
  onRefresh: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleSync(id: string) {
    setBusyId(id);
    await fetch("/api/agents/investment/plaid/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plaidItemId: id }),
    });
    setBusyId(null);
    onRefresh();
  }

  async function handleDisconnect(id: string, institutionName: string) {
    if (!confirm(`Disconnect ${institutionName}? Its synced holdings will be removed.`)) {
      return;
    }
    setBusyId(id);
    await fetch(`/api/agents/investment/plaid/items/${id}`, { method: "DELETE" });
    setBusyId(null);
    onRefresh();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Linked accounts</CardTitle>
            <CardDescription>
              Brokerage accounts connected via Plaid — holdings sync on demand.
            </CardDescription>
          </div>
          <ConnectAccountButton onConnected={onRefresh} />
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-neutral-500">No accounts connected yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-medium">{item.institutionName}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleSync(item.id)}
                    disabled={busyId === item.id}
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    aria-label={`Sync ${item.institutionName}`}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDisconnect(item.id, item.institutionName)}
                    disabled={busyId === item.id}
                    className="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950"
                    aria-label={`Disconnect ${item.institutionName}`}
                  >
                    <Unlink className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
