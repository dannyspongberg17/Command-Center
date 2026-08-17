"use client";

import { Pencil, Trash2 } from "lucide-react";
import type { Holding } from "@/lib/agents/investment/types";

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function HoldingsTable({
  holdings,
  totalValue,
  onEdit,
  onDelete,
}: {
  holdings: Holding[];
  totalValue: number;
  onEdit: (holding: Holding) => void;
  onDelete: (holding: Holding) => void;
}) {
  if (holdings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-500">
        No holdings yet. Add your first one to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-400 dark:border-neutral-800">
            <th className="py-2 pr-4 font-medium">Ticker</th>
            <th className="py-2 pr-4 font-medium">Account</th>
            <th className="py-2 pr-4 text-right font-medium">Quantity</th>
            <th className="py-2 pr-4 text-right font-medium">Cost basis</th>
            <th className="py-2 pr-4 text-right font-medium">Allocation</th>
            <th className="py-2 pr-0 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((holding) => {
            const allocation =
              totalValue > 0 ? (holding.costBasis / totalValue) * 100 : 0;
            return (
              <tr
                key={holding.id}
                className="border-b border-neutral-100 last:border-0 dark:border-neutral-900"
              >
                <td className="py-2.5 pr-4 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {holding.ticker}
                    {holding.source === "plaid" && (
                      <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-neutral-500 dark:bg-neutral-800">
                        Synced
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2.5 pr-4 text-neutral-500">
                  {holding.accountType}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums">
                  {holding.quantity}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums">
                  {formatCurrency(holding.costBasis)}
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-neutral-500">
                  {allocation.toFixed(1)}%
                </td>
                <td className="py-2.5 pr-0">
                  {holding.source === "manual" && (
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => onEdit(holding)}
                        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                        aria-label={`Edit ${holding.ticker}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(holding)}
                        className="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                        aria-label={`Delete ${holding.ticker}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
