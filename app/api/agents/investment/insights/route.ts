import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateInsights } from "@/lib/agents/investment/agent";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const holdings = await db.holding.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  let content: string;
  try {
    content = await generateInsights(holdings);
  } catch {
    return NextResponse.json(
      { error: "Failed to generate insights. Check ANTHROPIC_API_KEY is configured." },
      { status: 502 }
    );
  }

  const insight = await db.agentInsight.create({
    data: { userId: session.user.id, agentId: "investment", content },
  });

  return NextResponse.json({
    content: insight.content,
    createdAt: insight.createdAt.toISOString(),
  });
}
