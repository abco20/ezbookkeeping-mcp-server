# Security

## Secrets

- Never commit `EZBK_API_TOKEN` or `MCP_CONFIRMATION_SECRET`.
- Use a secret manager, Docker secrets, or restricted environment variables in production.
- Issue a dedicated API token for this MCP server instead of reusing a browser token.

## HTTP exposure

Streamable HTTP supports static bearer authentication through `MCP_HTTP_BEARER_TOKEN` and Host validation through `MCP_HTTP_ALLOWED_HOSTS`. Use TLS, an authenticated reverse proxy, or a VPN on untrusted networks.

Binding to a non-loopback address without the built-in bearer token requires an authenticated external proxy and an explicit `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` setting.

## Write profiles

Use `standard` or lower for routine operation. Enable `extended` and `admin` only when required.

## Confirmation tokens

Confirmation tokens are HMAC-signed and bound to an action and expiration time. Treat them as secrets and do not retain them in logs or chat history.

## Audit log

Audit logs may contain transaction data. Configure suitable file permissions, encryption, retention, and rotation. Write-enabled profiles check the audit destination during startup. Monitor stderr and the `/healthz` 503/degraded response for runtime audit failures.

If an upstream mutation succeeds but the audit write fails, the tool does not report the mutation as failed. This prevents an automatic retry from duplicating a completed operation. Stop further writes until the audit destination is restored.

## Concurrency boundary

Revision checks are required, but the ezBookkeeping API does not provide conditional writes. The read-check-write sequence is therefore not atomic across the Web UI and other clients. Avoid concurrent writes to the same transaction.

## Reporting

Do not include secrets in public issues. Report security vulnerabilities to the repository maintainers through a private channel.
