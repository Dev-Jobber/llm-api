# MegaNova API Postman Collection

Complete Postman collection and environment for the MegaNova AI Load Balancer.

## Files

- `MegaNova-API.postman_collection.json` — API endpoints, examples, and tests
- `MegaNova-API.postman_environment.json` — Environment variables
- `README.md` — This file

## Setup

1. **Import the collection**: In Postman, click Import → File → select `MegaNova-API.postman_collection.json`
2. **Import the environment**: In Postman, click Environments → Import → select `MegaNova-API.postman_environment.json`
3. **Set environment variables**:
   - `base_url` — e.g. `http://localhost:3000`
   - `proxy_auth_key` — must match your server's `PROXY_AUTH_KEY` env var

## Important API Behavior

- **`model` is ignored**: The load balancer selects the model via round-robin. Any `model` field in the request body is overwritten.
- **Auth on chat only**: `Authorization: Bearer <key>` is required for `/v1/chat/completions`. Health endpoints (`/health`, `/status`) are unauthenticated.
- **Auth flexibility**: The server accepts both `Authorization: Bearer <key>` and `x-api-key: <key>` headers.

## Endpoints

### Chat Completions (`POST /v1/chat/completions`)

Requires `Authorization: Bearer <proxy_auth_key>`.

**Body parameters:**

| Field       | Type      | Required | Default | Description                          |
|-------------|-----------|----------|---------|--------------------------------------|
| `messages`  | array     | Yes      | —       | Array of `{role, content}` objects   |
| `max_tokens`| number    | No       | 1024    | Max tokens in response               |
| `temperature`| number   | No       | 0.7     | Sampling temperature (0–2)         |
| `top_p`     | number    | No       | 0.9     | Nucleus sampling (0–1)               |
| `stream`    | boolean   | No       | false   | Enable streaming (SSE)               |

**Response codes:**
- `200` — Success
- `400` — Validation error (empty messages, invalid roles, etc.)
- `401` — Missing or invalid auth key
- `502` — Upstream API error (returned as `upstream_error`)
- `503` — All API keys locked (`service_unavailable`)

### Health Check (`GET /health`)

No auth required.

```json
{
  "status": "ok",
  "uptime": 3600
}
```

### Detailed Status (`GET /status`)

No auth required. Returns the full load balancer state.

```json
{
  "roundRobinPointer": 1,
  "totalKeys": 3,
  "totalModels": 3,
  "lockedKeys": 0,
  "freeKeys": 3,
  "keys": [
    {
      "id": "k0",
      "keyId": "k0",
      "locked": false,
      "activeModelIdx": 0,
      "models": [
        {
          "model": "meganova-ai/manta-flash-1.0",
          "rounds": 5,
          "failed": false,
          "active": true
        }
      ]
    }
  ]
}
```

## Response Examples

### Success (`200`)

```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "meganova-ai/manta-flash-1.0",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 12,
    "total_tokens": 21
  }
}
```

### Bad Request (`400`)

```json
{
  "error": "Bad Request",
  "message": "messages must be a non-empty array"
}
```

### Unauthorized (`401`)

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

### Service Unavailable (`503`)

```json
{
  "error": "service_unavailable",
  "message": "All API keys are currently locked. Retry after a few minutes."
}
```

## Automated Tests

The collection includes per-request tests:

- **Chat Completion**: Validates status code is 200/400/503 and response time < 30s
- **Health Check**: Validates `status: "ok"` and `uptime` is a number
- **Status**: Validates required fields and `keys` array length matches `totalKeys`

## Load Testing

Use Postman's Collection Runner on the **Load Testing → Simple Load Test** folder:

1. Select the folder
2. Set iterations (e.g. 30)
3. Run and observe `/status` to verify round-robin distribution across keys and models

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| `401 Unauthorized` | Missing or wrong `proxy_auth_key` | Match it to `PROXY_AUTH_KEY` env var |
| `503 Service Unavailable` | All keys locked after upstream errors | Wait for TTL expiry (default 10 min) |
| `Connection refused` | Server not running | Start with `npm run dev` or `npm start` |
| `502 Bad Gateway` | Upstream API error | Check upstream response in `upstream` field |

## Security

- Never commit `proxy_auth_key` to version control
- Use environment-specific values (dev vs prod)
- Rotate keys periodically
