# Architecture

## Principles

- **Workspace-first:** teams are independent; linking a Discord guild is optional.
- **Server is authoritative:** persisted data and permission decisions live on the server.
- **Same codebase:** hosted and self-hosted deployments use the same apps and schema.
- **Safe customization:** themes/layouts are validated JSON; widgets come from an allowlisted registry. Never run user-provided JavaScript.
- **Tenant isolation:** every workspace-scoped read and write must establish the authenticated user's team membership and role.

## Services

| Component | Responsibility |
| --- | --- |
| Activity client | Embedded UI and user interactions |
| REST API | Authentication, authorization, validation, persistent CRUD |
| Real-time service | Presence and authorized live updates |
| PostgreSQL | Durable source of truth |
| Prisma | Schema, migrations, and typed database access |

Redis is optional for later rate-limit coordination, caching, and multi-instance real-time coordination. It is not required by the current scaffold.

## Identity and authorization

Discord identity should be established through the official Embedded App SDK authorization flow and verified server-side. Do not trust client-submitted Discord IDs or guild IDs. Create TeamSpace memberships explicitly; Discord server membership alone does not automatically grant workspace access.

Recommended roles: OWNER, ADMIN, EDITOR, MEMBER, VIEWER. Implement permissions as server-side policies, not hidden UI controls.

## First milestone

1. Boot the Activity shell, API health endpoint, and real-time process.
2. Validate environment and database schema.
3. Implement server-verified Discord OAuth exchange and secure session cookie.
4. Add team/workspace creation with a transaction for owner membership and defaults.
5. Add membership-aware CRUD and real-time authorization.
6. Add deployment files only after each service has a known-good production build.

## Production readiness gates

Do not label the service production-ready until authentication, CSRF/origin handling, role checks, schema validation, rate limits, logging/redaction, migrations, backup/restore, dependency checks, and end-to-end Discord testing are in place.
