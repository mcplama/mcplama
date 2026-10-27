# Request an MCP server registry entry

The MCPlama registry is the curated catalog shown in the dashboard. The
current catalog is maintained in [`registry/v2.json`](../registry/v2.json),
with its own versioned envelope and schema. Older MCPlama releases can continue
using the unchanged v1 [`registry.json`](../registry.json).
A registry entry describes an MCP server that MCPlama can install or connect to; it is not the
MCPlama application image itself. The application image is
`mcplama/mcplama`.

## Before requesting an entry

Confirm that the server:

- has a public source repository and maintainer documentation;
- has a stable Docker image or npm/uvx package, or a public remote MCP endpoint;
- documents its transport (`stdio`, `streamable_http`, legacy `http`, or legacy `sse`) and required startup arguments;
- documents every credential or configuration value it needs; and
- has a license compatible with inclusion in a catalog of links and metadata.

Do not include secrets, private registry credentials, or locally generated
configuration in an issue or pull request. A registry entry contains metadata;
users provide their own credentials through MCPlama's authorization flow.

## Request the entry

Open an issue in the MCPlama repository titled **Registry request: `<server>`**
with:

1. Server name, publisher, and source repository.
2. The Docker image or package name and the exact version/tag tested.
3. Runtime and transport: `docker`, `npx`, `uvx`, or `remote`, plus `stdio`, `streamable_http`, `sse`, or legacy `http`.
4. Required credentials, environment variables, and whether they are shared or
   per-user.
5. The server's documentation URL and a list of representative tools.
6. Any network, filesystem, OAuth, or other operational requirements.

If you can make the change yourself, submit a pull request to the application
repository instead. Add the entry to `registry.json` using an existing entry
as a template. Keep the entry limited to declarative metadata; runtime
behavior belongs in the application code and requires separate review.

## Entry shape

Use an existing entry in `registry.json` as a template. At minimum, provide
these fields:

```json
{
  "id": "mcp-example",
  "name": "Example",
  "publisher": "example-org",
  "description": "What the server does",
  "category": "General Tools",
  "version": "1.2.3",
  "docs_url": "https://example.com/docs",
  "runtime": "docker",
  "transport": "stdio",
  "docker_image": "example/mcp-server:1.2.3",
  "package": null,
  "auth_type": "none",
  "auth_mode": "environment",
  "user_config_schema": [],
  "tools": ["example_tool"],
  "requirements": "Describe setup requirements."
}
```

For `npx` or `uvx`, provide `package` and set `docker_image` to `null`. For
credentials, describe each required value in `user_config_schema` and choose
the appropriate `auth_mode`; never put an actual credential in the file.

Remote entries use the same MCPlama remote proxy and OAuth support as manually
configured remote servers. Include `url` and `remote_auth` (`none`, `bearer`,
`header`, or `oauth`) and specify `auth_header_name` when using `header`.
`auth_type` is the user facing credential category; `auth_mode` is `none`,
`shared`, or `per_user`. The `tools` array is a maintained name list, not a
security classification. Admins can inspect public remote endpoints in the
catalog; inspection sends MCP `initialize` and `tools/list`, never tool calls.
Tool `annotations` shown by live inspection are server supplied hints.

### Remote MCP and OAuth

Remote entries use `runtime: "remote"` and a public MCP `url`. `remote_auth`
describes how MCPlama authenticates to the upstream endpoint:

- `none`: no upstream authorization header;
- `bearer`: send a bearer token;
- `header`: send a token in `auth_header_name`;
- `oauth`: use the upstream MCP OAuth flow, with each member authorizing their
  own provider account from the member portal.

For remote OAuth entries, `oauth_client` describes how MCPlama obtains the
OAuth application credentials. Set `required` and list the required `fields`
using `key`, `label`, `type` (`text` or `secret`), and `required`. Set
`registration` to `static` when the provider requires a pre-registered OAuth
client, or `discovered` when the provider supports dynamic client registration.
The optional `credential_mode_options` and `default_credential_mode` control
whether the OAuth client credentials are shared by the deployment or supplied
by each user. This is separate from the upstream account: members still
authorize their own account.

The admin configures shared OAuth client credentials in server settings. With
per-user client credentials enabled, each member supplies their OAuth client
details in the portal. In both modes, users complete the provider consent flow
for their own account. Do not place client IDs, client secrets, access tokens,
or refresh tokens in registry files; registry entries contain field
definitions and setup instructions only.

The catalog's remote inspection action is read-only and unauthenticated. It
performs MCP `initialize` and `tools/list` to compare the live endpoint with
the catalog; it does not invoke tools or pass configured user credentials.

V1 entries are validated against [`registry.schema.json`](../registry.schema.json);
v2 entries use [`registry/v2.schema.json`](../registry/v2.schema.json). The
backend's bundled fallback reads [`registry/v2.json`](../registry/v2.json).

## Registry v2

New MCPlama releases load the versioned catalog in [`registry/v2.json`](../registry/v2.json),
whose envelope is `{ "version": 2, "servers": [...] }`. It preserves the v1
entries and adds the v2 integrations at the start of the list. Older releases
continue loading the unchanged top-level array in [`registry.json`](../registry.json).
Add new entries to `registry/v2.json` and keep `registry.json` in sync for v1
consumers. Validate changes to both catalogs with `python tools/validate_registry.py`.

The v2 starter order is PostgreSQL, Filesystem, Brave Search, Playwright, Slack,
Jira, Obsidian, Notion, Figma, Resend, RevenueCat, then Google Workspace MCP
services. Google publishes separate endpoints for Drive, Gmail, Calendar, Chat,
Docs, Sheets, Slides, and People. Their registry entries carry the Developer
Preview and OAuth setup requirements from Google's documentation.

### Remote entry example

```json
{
  "id": "mcp-example-remote",
  "name": "Example Remote",
  "publisher": "example-org",
  "description": "Example hosted MCP service",
  "category": "Developer Tools",
  "official": false,
  "version": "1.2.3",
  "docs_url": "https://example.org/mcp",
  "runtime": "remote",
  "transport": "streamable_http",
  "url": "https://mcp.example.org/mcp",
  "auth_type": "oauth",
  "auth_mode": "per_user",
  "remote_auth": "oauth",
  "tools": [],
  "requirements": "Each member authorizes their own account."
}
```

Reviewers will verify the metadata, installation flow, credentials handling,
image/package availability, and security implications before adding the entry
to the curated catalog.
