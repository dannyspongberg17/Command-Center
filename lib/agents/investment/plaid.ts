import { Configuration, PlaidApi, PlaidEnvironments, Products, CountryCode } from "plaid";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

const env = process.env.PLAID_ENV ?? "sandbox";

const configuration = new Configuration({
  basePath: PlaidEnvironments[env],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

export async function createLinkToken(userId: string) {
  const response = await plaidClient.linkTokenCreate({
    client_name: "Command Center",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: userId },
    products: [Products.Investments],
  });
  return response.data;
}

export async function exchangePublicToken(publicToken: string) {
  const response = await plaidClient.itemPublicTokenExchange({
    public_token: publicToken,
  });
  return response.data;
}

export async function removeItem(accessToken: string) {
  await plaidClient.itemRemove({ access_token: accessToken });
}

/**
 * Pulls current holdings for a linked institution and upserts them into the
 * Holding table, matched on (plaidAccountId, plaidSecurityId) so repeat
 * syncs update in place instead of creating duplicates.
 */
export async function syncHoldingsForItem(plaidItemId: string) {
  const item = await db.plaidItem.findUniqueOrThrow({
    where: { id: plaidItemId },
  });
  const accessToken = decrypt(item.accessTokenEncrypted);

  const { data } = await plaidClient.investmentsHoldingsGet({
    access_token: accessToken,
  });

  const accountsById = new Map(data.accounts.map((a) => [a.account_id, a]));
  const securitiesById = new Map(data.securities.map((s) => [s.security_id, s]));

  for (const holding of data.holdings) {
    const account = accountsById.get(holding.account_id);
    const security = securitiesById.get(holding.security_id);

    await db.holding.upsert({
      where: {
        plaidAccountId_plaidSecurityId: {
          plaidAccountId: holding.account_id,
          plaidSecurityId: holding.security_id,
        },
      },
      update: {
        ticker: security?.ticker_symbol || security?.name || "UNKNOWN",
        quantity: holding.quantity,
        costBasis: holding.cost_basis ?? 0,
        accountType: account?.name ?? "Linked account",
      },
      create: {
        userId: item.userId,
        source: "plaid",
        plaidItemId: item.id,
        plaidAccountId: holding.account_id,
        plaidSecurityId: holding.security_id,
        ticker: security?.ticker_symbol || security?.name || "UNKNOWN",
        quantity: holding.quantity,
        costBasis: holding.cost_basis ?? 0,
        accountType: account?.name ?? "Linked account",
      },
    });
  }
}

export function encryptAccessToken(accessToken: string): string {
  return encrypt(accessToken);
}
