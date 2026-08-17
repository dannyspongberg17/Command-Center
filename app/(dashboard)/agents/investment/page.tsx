import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { InvestmentDashboard } from "@/components/investment/InvestmentDashboard";

export default async function InvestmentAgentPage() {
  const session = await getServerSession(authOptions);
  const userId = session!.user.id;

  const [holdings, latestInsight] = await Promise.all([
    db.holding.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    }),
    db.agentInsight.findFirst({
      where: { userId, agentId: "investment" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <InvestmentDashboard
      initialHoldings={holdings.map((h) => ({
        ...h,
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
    />
  );
}
