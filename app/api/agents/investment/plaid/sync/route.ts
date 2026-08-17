import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { syncHoldingsForItem } from "@/lib/agents/investment/plaid";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const plaidItemId: unknown = body?.plaidItemId;
  if (typeof plaidItemId !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const item = await db.plaidItem.findUnique({ where: { id: plaidItemId } });
  if (!item || item.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await syncHoldingsForItem(plaidItemId);
  } catch {
    return NextResponse.json(
      { error: "Failed to sync this account." },
      { status: 502 }
    );
  }

  const holdings = await db.holding.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(holdings);
}
