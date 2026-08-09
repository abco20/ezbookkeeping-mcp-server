# ezBookkeeping MCP Server

An independent Model Context Protocol (MCP) server for the [ezBookkeeping](https://github.com/mayswind/ezbookkeeping) HTTP API. It supports stdio and Streamable HTTP transports.

## MCP tools

| Domain | Tools | Minimum profile |
|---|---|---|
| System | `get_server_info` | `read` |
| Transactions | `search_transactions`, `get_transaction` | `read` |
| Transactions | `create_transaction`, `patch_transaction` | `standard` |
| Batch | `preview_transaction_batch`, `apply_transaction_batch` | `standard` |
| Delete | `delete_transaction` | `standard` |
| Accounts | `list_accounts` | `read` |
| Accounts | `manage_account` | `extended` (`admin` for deletion) |
| Categories | `list_categories` | `read` |
| Categories | `manage_category` | `extended` |
| Tags | `list_tag_groups`, `list_tags` | `read` |
| Tags | `manage_tag_group`, `manage_tag` | `extended` |
| Templates | `list_templates` | `read` |
| Templates | `manage_template` | `extended` |
| Analytics | `get_financial_summary`, `get_financial_trends`, `get_reconciliation_statement` | `read` |
| Exchange rates | `get_exchange_rates` | `read` |
| Exchange rates | `manage_custom_exchange_rate` | `extended` |

File import/export, picture upload, user authentication management, and clear-all operations are intentionally excluded.

## Requirements

- Node.js 20 or later
- An ezBookkeeping instance with API tokens enabled
- An ezBookkeeping API token

Read, write, batch, and delete flows have been verified against the official ezBookkeeping v1.6.1 Docker image.

## Setup

```bash
cp .env.example .env
npm ci
npm run build
```

```dotenv
EZBK_BASE_URL=http://127.0.0.1:8080
EZBK_API_TOKEN=replace-with-api-token
EZBK_TIMEZONE=Asia/Tokyo

MCP_TRANSPORT=stdio
MCP_WRITE_PROFILE=read
MCP_CONFIRMATION_SECRET=
```

Profiles above `read` require an `MCP_CONFIRMATION_SECRET` of at least 32 characters.

### Write profiles

| Profile | Permissions |
|---|---|
| `read` | Read and analytics only |
| `standard` | Create, update, delete, and batch-update transactions |
| `extended` | `standard` plus master data, templates, and custom exchange rates |
| `admin` | `extended` plus account deletion |

Start with `read` and enable only the permissions you need.

## Running

### stdio

```bash
set -a
. ./.env
set +a
npm start
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "ezbookkeeping": {
      "command": "node",
      "args": ["/absolute/path/to/ezbookkeeping-mcp/dist/index.js"],
      "env": {
        "EZBK_BASE_URL": "http://127.0.0.1:8080",
        "EZBK_API_TOKEN": "...",
        "EZBK_TIMEZONE": "Asia/Tokyo",
        "MCP_WRITE_PROFILE": "read"
      }
    }
  }
}
```

### Streamable HTTP

```bash
MCP_TRANSPORT=http \
MCP_HTTP_HOST=0.0.0.0 \
MCP_HTTP_ALLOWED_HOSTS=finance.example.com \
MCP_HTTP_BEARER_TOKEN="$(openssl rand -hex 32)" \
MCP_HTTP_PORT=3000 npm start
```

- MCP endpoint: `http://HOST:3000/mcp`
- Health check: `http://HOST:3000/healthz`

Non-loopback bindings require a bearer token, or an authenticated reverse proxy with `MCP_HTTP_ALLOW_UNAUTHENTICATED=true`. Do not expose the endpoint directly to the internet.

### Docker Compose

```bash
cp .env.example .env
docker compose up --build -d
curl http://127.0.0.1:3000/healthz
```

## Verification

```bash
npm run ci
```

Read-only smoke test against a real ezBookkeeping instance:

```bash
EZBK_BASE_URL=https://example.invalid \
EZBK_API_TOKEN=... \
npm run test:real
```

## Safety

`patch_transaction` requires an `expected_revision` from a recent read. Batch updates and deletions revalidate the `confirmation_token` issued during Preview before Apply.

The ezBookkeeping API does not provide conditional writes, so revision validation and the upstream write are not fully atomic. Avoid updating the same transaction concurrently from the Web UI or another client. See [SECURITY.md](SECURITY.md) for HTTP exposure, secrets, and audit-log guidance.

## License

[MIT](LICENSE)
