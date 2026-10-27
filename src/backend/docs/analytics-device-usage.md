# Device presence and usage analytics API

All timestamps and date grouping use UTC.

## POST `/api/analytics/devices/heartbeat`

Requires a valid access token. The client should call this while the app is active, about every 30–60 seconds.

Request JSON:

```json
{
  "device_id": "stable-client-generated-id",
  "device_name": "Android phone"
}
```

`device_id` is 1–128 characters and may contain letters, numbers, `.`, `_`, `:`, and `-`. `device_name` is optional and is limited to 100 characters. A session starts on the first heartbeat or after more than 30 minutes without a heartbeat.

## GET `/api/analytics/usage?period=day`

Requires `analytics:read`. Returns active devices (heartbeat in the last 2 minutes) and usage-session counts for the last 30 UTC calendar days including today.

## GET `/api/analytics/usage?period=month`

Requires `analytics:read`. Returns active devices and usage-session counts for the current month and previous 11 UTC calendar months.

## Custom date range

Pass both `from` and `to` as `YYYY-MM-DD`, inclusive, for example:

`GET /api/analytics/usage?period=day&from=2026-10-01&to=2026-10-24`

The response includes `active_device_count`, `active_devices`, `usage` (each item has `period`, `sessions`, and `uniqueDevices`), and `total_sessions`.

## Storage

- `device_presence`: one latest heartbeat per `(user_id, device_id)`.
- `device_usage_sessions`: one document per usage session; a new session begins after 30 minutes of inactivity.

The frontend must send a stable `device_id` and repeat heartbeats while the app is active. Until it does, the endpoint will not reflect real app-device activity.
