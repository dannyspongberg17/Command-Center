import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  exchangePublicToken,
  encryptAccessToken,
  syncHoldingsForItem,
} from "@/lib/agents/investment/plaid";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const publicToken: unknown = body?.publicToken;
  const institutionName: unknown = body?.institutionName;
  if (typeof publicToken !== "string" || typeof institutionName !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const { access_token, item_id } = await exchangePublicToken(publicToken);

    const plaidItem = await db.plaidItem.create({
      data: {
        userId: session.user.id,
        itemId: item_id,
        institutionName,
        accessTokenEncrypted: encryptAccessToken(access_token),
      },
    });

    await syncHoldingsForItem(plaidItem.id);

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Failed to connect this account." },
      { status: 502 }
    );
  }
}
