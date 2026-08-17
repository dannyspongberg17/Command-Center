import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createLinkToken } from "@/lib/agents/investment/plaid";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { link_token } = await createLinkToken(session.user.id);
    return NextResponse.json({ linkToken: link_token });
  } catch {
    return NextResponse.json(
      { error: "Failed to start Plaid Link. Check PLAID_CLIENT_ID/PLAID_SECRET/PLAID_ENV are configured." },
      { status: 502 }
    );
  }
}
