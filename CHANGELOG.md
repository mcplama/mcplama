# Changelog

Notable changes since the `v1.0.1` release.

## Unreleased

### Added

- Added a versioned v2 MCP registry catalog with a schema and automated
  validation. Existing v1 registry consumers remain supported.
- Added catalog metadata for remote MCP endpoints, including upstream OAuth
  setup instructions and client credential fields.
- Added support for shared or per-user OAuth application credentials. Each
  member still authorizes their own upstream provider account.
- Added separate administrative Audit Logs for server configuration and
  credential changes, invitations, user role/status changes, policies, access
  requests, access grants/revocations, and connection changes. Entries include
  safe change summaries; secret and policy configuration values are excluded.
- Added pagination and searchable, clickable audit event details in the admin
  portal.
- Added user groups with group-based MCP server grants, membership management,
  and connection access checks. Existing direct access requests remain
  supported.
- Added direct user creation from the Users page, alongside email and link
  invitations. Admin-created accounts require an initial password.
- Added an MCP infrastructure map for exploring configured users, connections,
  servers, and tools with details and status indicators.

### Changed

- Improved admin navigation, activity presentation, and access-request
  notifications.
- Updated OAuth setup metadata for registry integrations and refined remote
  OAuth token handling.
- Added Groups and MCP map entries to admin navigation and made the Groups page
  follow the shared application theme.

### Fixed

- Added the follow-up database migration for generic resources in the change
  audit log, so audit writes do not prevent user and access-management actions
  from completing.
- Show API errors in the Users page when invitation deletion or access
  revocation fails.
- Merged the groups and change-audit Alembic branches to restore a single
  migration head for database startup.
- Paginated the Groups list in 20-item pages, matching the Users list.
- Fixed registered tool labels in the Permission Map so their text follows the
  active light or dark theme.
