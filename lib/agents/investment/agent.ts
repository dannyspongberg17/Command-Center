import Anthropic from "@anthropic-ai/sdk";
import type { Holding } from "@/lib/agents/investment/types";

type HoldingForInsights = Pick<
  Holding,
  "ticker" | "quantity" | "costBasis" | "accountType" | "notes"
>;

const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `You are the Investment Agent inside a personal Command Center dashboard.
You analyze a single user's self-reported portfolio holdings and produce a short,
plain-English summary covering: overall diversification, concentration risk (by
ticker and by account type), and 2-3 things worth considering or researching further.

Rules:
- You are informational only, not a licensed financial advisor. Never phrase
  anything as a specific buy/sell/hold recommendation or price prediction.
- Be concise: use short paragraphs and bullet points, aim for well under 300 words.
- Holdings are valued at cost basis (what the user paid), not live market value,
  since no live price feed is connected — do not imply these are current prices.
- If there are very few holdings, say so plainly rather than inventing analysis.`;

function buildHoldingsSummary(holdings: HoldingForInsights[]): string {
  if (holdings.length === 0) {
    return "The user has no holdings recorded yet.";
  }

  const totalValue = holdings.reduce((sum, h) => sum + h.costBasis, 0);

  const lines = holdings.map((h) => {
    const share = totalValue > 0 ? (h.costBasis / totalValue) * 100 : 0;
    return `- ${h.ticker}: ${h.quantity} units, $${h.costBasis.toFixed(2)} cost basis (${share.toFixed(1)}% of portfolio), account: ${h.accountType}${h.notes ? `, notes: ${h.notes}` : ""}`;
  });

  return [`Total cost basis: $${totalValue.toFixed(2)}`, ...lines].join("\n");
}

export async function generateInsights(
  holdings: HoldingForInsights[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Here is the current portfolio:\n\n${buildHoldingsSummary(holdings)}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock?.text ?? "No insights were generated.";
}
