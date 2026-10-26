# API reference (current implementation)

Base path: `/api/v1`

The API is still in development. Every authenticated request uses an opaque TeamSpace session token in the `Authorization: Bearer <token>` header. Tokens are returned only after the server exchanges a Discord Embedded App SDK authorization code with Discord. The database stores a SHA-256 hash of the TeamSpace token, not the raw token. The Activity keeps the token in memory; reloading the Activity initiates authorization again.

## Health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Process liveness |
| GET | `/ready` | Checks PostgreSQL connectivity; returns 503 if unavailable |
| GET | `/api/v1` | API version and auth configuration status |

## Authentication

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/auth/discord/exchange` | Body: `{ "code": "..." }`. Exchanges the SDK code with Discord, verifies identity via `/users/@me`, upserts the user, creates a server-side session, and returns the SDK access token plus TeamSpace session token. Rate limited. |
| GET | `/api/v1/auth/me` | Returns the current user for a valid TeamSpace bearer token |
| POST | `/api/v1/auth/logout` | Revokes the bearer token; returns 204 |

The Discord client secret must remain server-side. The Discord access token is returned to the embedded client only so it can call `discordSdk.commands.authenticate()`; the client does not persist it. Do not log authorization codes, access tokens, or TeamSpace session tokens.

## Teams and workspaces

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/teams` | Lists teams where the current user has a membership |
| POST | `/api/v1/teams` | Creates a team, owner membership, initial Home workspace, default theme/layout/features, and audit event in a transaction |
| GET | `/api/v1/teams/:teamId` | Reads a team only if the user is a member |
| GET | `/api/v1/teams/:teamId/workspaces` | Lists workspaces for a team the user belongs to |
| POST | `/api/v1/teams/:teamId/workspaces` | Creates a workspace; OWNER or ADMIN required |
| GET | `/api/v1/workspaces/:workspaceId/config` | Reads persisted theme, layout, and feature config for a member |

Team creation body:
```json
{ "name": "Design Team", "slug": "design-team", "workspaceName": "Home" }
```

Only `name` is required. Slugs are normalized from the name if omitted. Team slugs are currently globally unique; workspace slugs are unique within a team.

## Tasks

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/workspaces/:workspaceId/tasks` | Lists tasks for a workspace the user can access |
| POST | `/api/v1/workspaces/:workspaceId/tasks` | Creates a task; VIEWER cannot create |
| PATCH | `/api/v1/workspaces/:workspaceId/tasks/:taskId` | Updates task fields; VIEWER cannot update |
| DELETE | `/api/v1/workspaces/:workspaceId/tasks/:taskId` | OWNER, ADMIN, or EDITOR required |

Create-task body:
```json
{ "title": "Review launch checklist", "description": "Optional details", "position": 0 }
```

Task status values: `TODO`, `IN_PROGRESS`, `DONE`, `ARCHIVED`. If an assignee is specified, that user must be a member of the same team.

## Error conventions

- `400` invalid request or field values
- `401` missing, expired, or invalid session
- `403` authenticated but insufficient role
- `404` missing or inaccessible resource
- `409` duplicate team/workspace slug
- `503` database/session service unavailable

## Not implemented yet

Notes CRUD, member invitations and role management, theme/layout mutation endpoints, preference management, and authorized real-time event handlers remain future work. Never assume a UI-hidden action is secure; enforce authorization in each server route.
