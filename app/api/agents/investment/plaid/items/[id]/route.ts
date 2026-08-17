import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { removeItem } from "@/lib/agents/investment/plaid";
import { decrypt } from "@/lib/crypto";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const item = await db.plaidItem.findUnique({ where: { id } });
  if (!item || item.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await removeItem(decrypt(item.accessTokenEncrypted));
  } catch {
    // Continue even if Plaid-side removal fails (e.g. already revoked) —
    // we still want to remove our local copy of this connection.
  }

  await db.plaidItem.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
