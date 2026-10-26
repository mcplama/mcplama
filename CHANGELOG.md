# Changelog

Notable changes since the `v1.0.1` release. These entries cover the commits on
this branch and the pending change-audit work.

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

### Changed

- Improved admin navigation, activity presentation, and access-request
  notifications.
- Updated OAuth setup metadata for registry integrations and refined remote
  OAuth token handling.

### Fixed

- Added the follow-up database migration for generic resources in the change
  audit log, so audit writes do not prevent user and access-management actions
  from completing.
- Show API errors in the Users page when invitation deletion or access
  revocation fails.
