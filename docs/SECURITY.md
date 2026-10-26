# Security checklist

- [ ] Discord OAuth exchange is verified server-side and session cookies are HttpOnly, Secure in production, and appropriately SameSite.
- [ ] Mutating requests enforce origin/CSRF protections appropriate to the chosen session model.
- [ ] Every route verifies user identity, workspace membership, and role before accessing records.
- [ ] Team/workspace IDs from the client are never treated as authorization.
- [ ] Validate all request bodies and real-time messages with schemas and enforce payload limits.
- [ ] Use an explicit widget allowlist; never evaluate workspace content as code.
- [ ] Secrets, tokens, and session cookies are redacted from logs.
- [ ] Database uses a dedicated least-privilege role; production network access is restricted.
- [ ] Backups are encrypted and restore-tested.
- [ ] Dependency scanning, security updates, and release review are in place.
