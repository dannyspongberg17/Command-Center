"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPES, type Holding, type HoldingInput } from "@/lib/agents/investment/types";

const inputClass =
  "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-900";

export function HoldingFormDialog({
  onClose,
  onSubmit,
  editing,
}: {
  onClose: () => void;
  onSubmit: (input: HoldingInput) => Promise<string | void>;
  editing: Holding | null;
}) {
  const [ticker, setTicker] = useState(editing?.ticker ?? "");
  const [quantity, setQuantity] = useState(
    editing ? String(editing.quantity) : ""
  );
  const [costBasis, setCostBasis] = useState(
    editing ? String(editing.costBasis) : ""
  );
  const [accountType, setAccountType] = useState<
    (typeof ACCOUNT_TYPES)[number]
  >((editing?.accountType as (typeof ACCOUNT_TYPES)[number]) ?? "Brokerage");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const result = await onSubmit({
      ticker,
      quantity: Number(quantity),
      costBasis: Number(costBasis),
      accountType,
      notes,
    });

    setSaving(false);
    if (result) {
      setError(result);
      return;
    }
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? "Edit holding" : "Add holding"}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Ticker</label>
          <input
            className={inputClass}
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="AAPL"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Quantity
            </label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Cost basis (total $)
            </label>
            <input
              className={inputClass}
              type="number"
              step="any"
              min="0"
              value={costBasis}
              onChange={(e) => setCostBasis(e.target.value)}
              required
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            Account type
          </label>
          <select
            className={inputClass}
            value={accountType}
            onChange={(e) =>
              setAccountType(e.target.value as (typeof ACCOUNT_TYPES)[number])
            }
          >
            {ACCOUNT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">
            Notes (optional)
          </label>
          <textarea
            className={inputClass}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : editing ? "Save changes" : "Add holding"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
