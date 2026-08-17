import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { InvestmentDashboard } from "@/components/investment/InvestmentDashboard";
import type { Holding } from "@/lib/agents/investment/types";

export default async function InvestmentAgentPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;

  const [holdings, latestInsight, plaidItems] = await Promise.all([
    db.holding.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
    db.agentInsight.findFirst({
      where: { userId, agentId: "investment" },
      orderBy: { createdAt: "desc" },
    }),
    db.plaidItem.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <InvestmentDashboard
      initialHoldings={holdings.map((h) => ({
        ...h,
        source: h.source as Holding["source"],
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString(),
      }))}
      initialInsight={
        latestInsight
          ? {
              content: latestInsight.content,
              createdAt: latestInsight.createdAt.toISOString(),
            }
          : null
      }
      initialPlaidItems={plaidItems.map((p) => ({
        id: p.id,
        institutionName: p.institutionName,
        createdAt: p.createdAt.toISOString(),
      }))}
    />
  );
}
