"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { HoldingsTable } from "@/components/investment/HoldingsTable";
import { AllocationChart } from "@/components/investment/AllocationChart";
import { HoldingFormDialog } from "@/components/investment/HoldingFormDialog";
import { AIInsightsPanel } from "@/components/investment/AIInsightsPanel";
import { LinkedAccounts } from "@/components/investment/LinkedAccounts";
import type { Holding, HoldingInput, PlaidLinkedAccount } from "@/lib/agents/investment/types";

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function InvestmentDashboard({
  initialHoldings,
  initialInsight,
  initialPlaidItems,
}: {
  initialHoldings: Holding[];
  initialInsight: { content: string; createdAt: string } | null;
  initialPlaidItems: PlaidLinkedAccount[];
}) {
  const [holdings, setHoldings] = useState(initialHoldings);
  const [plaidItems, setPlaidItems] = useState(initialPlaidItems);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);

  const totalValue = holdings.reduce((sum, h) => sum + h.costBasis, 0);

  async function refreshData() {
    const [holdingsRes, itemsRes] = await Promise.all([
      fetch("/api/agents/investment/holdings"),
      fetch("/api/agents/investment/plaid/items"),
    ]);
    if (holdingsRes.ok) setHoldings(await holdingsRes.json());
    if (itemsRes.ok) setPlaidItems(await itemsRes.json());
  }

  function openAddDialog() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEditDialog(holding: Holding) {
    setEditing(holding);
    setDialogOpen(true);
  }

  async function handleSubmit(input: HoldingInput): Promise<string | void> {
    const url = editing
      ? `/api/agents/investment/holdings/${editing.id}`
      : "/api/agents/investment/holdings";
    const method = editing ? "PATCH" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      return "Something went wrong saving this holding.";
    }

    const saved: Holding = await res.json();
    setHoldings((prev) =>
      editing
        ? prev.map((h) => (h.id === saved.id ? saved : h))
        : [...prev, saved]
    );
  }

  async function handleDelete(holding: Holding) {
    if (!confirm(`Remove ${holding.ticker} from your holdings?`)) return;

    const res = await fetch(`/api/agents/investment/holdings/${holding.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setHoldings((prev) => prev.filter((h) => h.id !== holding.id));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Investment Agent
        </h1>
        <p className="mt-1 text-neutral-500">
          Manually tracked or synced holdings, valued at cost basis.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Portfolio</CardTitle>
              <CardDescription>
                Total cost basis: {formatCurrency(totalValue)}
              </CardDescription>
            </div>
            <Button size="sm" onClick={openAddDialog}>
              <Plus className="h-4 w-4" />
              Add holding
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <AllocationChart holdings={holdings} totalValue={totalValue} />
          <HoldingsTable
            holdings={holdings}
            totalValue={totalValue}
            onEdit={openEditDialog}
            onDelete={handleDelete}
          />
        </CardContent>
      </Card>

      <LinkedAccounts items={plaidItems} onRefresh={refreshData} />

      <AIInsightsPanel holdings={holdings} initialInsight={initialInsight} />

      {dialogOpen && (
        <HoldingFormDialog
          key={editing?.id ?? "new"}
          onClose={() => setDialogOpen(false)}
          onSubmit={handleSubmit}
          editing={editing}
        />
      )}
    </div>
  );
}
