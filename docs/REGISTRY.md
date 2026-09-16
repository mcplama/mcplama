# Request an MCP server registry entry

The MCPlama registry is the curated catalog shown in the dashboard. The
canonical catalog is maintained in the application repository's
[`registry.json`](https://raw.githubusercontent.com/mcplama/mcplama/refs/heads/main/registry.json).
A registry entry describes an MCP server that MCPlama can install and run; it is not the
MCPlama application image itself. The application image is
`mcplama/mcplama`.

## Before requesting an entry

Confirm that the server:

- has a public source repository and maintainer documentation;
- has a stable Docker image or npm/uvx package, with a version or tag that can
  be identified and updated;
- documents its transport (`http` or `stdio`) and required startup arguments;
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
3. Runtime and transport: `docker`, `npx`, or `uvx`, plus `http` or `stdio`.
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

Reviewers will verify the metadata, installation flow, credentials handling,
image/package availability, and security implications before adding the entry
to the curated catalog.
