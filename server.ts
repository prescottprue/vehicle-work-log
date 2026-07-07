import OAuthProvider from "@cloudflare/workers-oauth-provider";
import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

import { LogbookMCP } from "./app/mcp/agent.server";
import { runWithOAuthHelpers } from "./app/mcp/oauth-context.server";

const app = createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});

// Durable Object class backing /mcp sessions — wrangler.jsonc binds it as
// MCP_OBJECT. Must be re-exported from the worker entry.
export { LogbookMCP };

// The OAuthProvider wraps the whole Worker: it serves the OAuth protocol
// endpoints itself (/oauth/token, /oauth/register, /.well-known/*), gates
// /mcp behind Bearer tokens (decrypted props land on ctx.props → McpAgent
// this.props), and forwards everything else — including /authorize, which
// renders the login/consent UI inside the TanStack app — to the site.
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: LogbookMCP.serve("/mcp"),
  defaultHandler: {
    fetch: (request: Request, env: Cloudflare.Env) =>
      Promise.resolve(
        runWithOAuthHelpers(env.OAUTH_PROVIDER, () => app.fetch(request)),
      ),
  },
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
});
