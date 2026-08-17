import { z } from "zod";

export const ACCOUNT_TYPES = [
  "Brokerage",
  "401(k)",
  "Traditional IRA",
  "Roth IRA",
  "HSA",
  "Other",
] as const;

export const holdingInputSchema = z.object({
  ticker: z
    .string()
    .trim()
    .min(1, "Ticker is required")
    .max(10)
    .transform((v) => v.toUpperCase()),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  costBasis: z.coerce
    .number()
    .nonnegative("Cost basis can't be negative"),
  accountType: z.enum(ACCOUNT_TYPES),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export type HoldingInput = z.infer<typeof holdingInputSchema>;

export type Holding = {
  id: string;
  ticker: string;
  quantity: number;
  costBasis: number;
  accountType: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
