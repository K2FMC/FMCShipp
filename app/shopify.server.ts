interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

export async function getShopifyToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt - now > 5 * 60 * 1000) {
    return tokenCache.accessToken;
  }

  const shop = process.env.SHOPIFY_STORE!;
  const clientId = process.env.SHOPIFY_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET!;

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify token error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  const expiresIn = (data.expires_in ?? 86400) * 1000;
  tokenCache = {
    accessToken: data.access_token,
    expiresAt: now + expiresIn,
  };

  return tokenCache.accessToken;
}

export interface ShopifyAdmin {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<Response>;
}

export interface ShopifySession {
  shop: string;
  accessToken: string;
}

export async function getShopifyAdmin(): Promise<{
  admin: ShopifyAdmin;
  session: ShopifySession;
}> {
  const shop = process.env.SHOPIFY_STORE!;
  const accessToken = await getShopifyToken();

  const admin: ShopifyAdmin = {
    graphql: (query, options) =>
      fetch(`https://${shop}/admin/api/2025-10/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: options?.variables }),
      }),
  };

  return { admin, session: { shop, accessToken } };
}
