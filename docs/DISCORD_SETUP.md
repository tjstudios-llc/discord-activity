# Discord application setup

This checklist is a planning guide; Discord Developer Portal labels and requirements can change. Verify the current official Discord documentation before production configuration.

1. Create a Discord application in the Developer Portal and keep its application ID and client secret private.
2. Enable/configure the Activity or Embedded App settings supported by that application.
3. Configure the Activity URL mapping to the public HTTPS origin used by the embedded client.
4. Configure the Activity entry point/launch command and application metadata.
5. Request only the OAuth scopes the implementation actually needs. Start with identity; add guild-related scopes only when a specific feature requires them.
6. Implement the official Embedded App SDK authorization-code exchange and verify the exchange on the server. Do not treat client-provided identity data as proof of authentication.
7. Store the client secret only in server environment variables. Never prefix it with VITE_ or commit it.
8. Configure exact allowed browser origins for the API and test WebSocket connectivity through the Discord Activity environment.
9. Test launch inside Discord, token/code exchange, expiry and logout, two-user workspace access, reconnects, and denied unauthorized requests.
10. Add production domains, privacy policy, and terms URLs after local end-to-end testing.

Do not request a bot token or bot permissions unless a separate bot feature is deliberately added.
