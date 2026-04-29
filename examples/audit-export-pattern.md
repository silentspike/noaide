# Export and replay the audit log

Goal: pull the NDJSON audit log for one session, walk the schema,
correlate one entry back to the chat panel, and hand it to a
downstream system (SIEM, ticketing, finance review).

## 1. Pick a session

```bash
SESSION_ID=$(wget -qO - http://localhost:8080/api/sessions \
  | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['id'])")
echo "session: $SESSION_ID"
```

The first session in the list is fine for a walkthrough. In a real
review you'd filter by date, project, or model.

## 2. Pull the audit log

The endpoint streams JSON by default and CSV when asked. Source:
[`server/src/main.rs`](../server/src/main.rs) (see
`api_export_audit`).

```bash
wget -qO audit.json \
  "http://localhost:8080/api/proxy/audit/export?session_id=${SESSION_ID}&format=json&limit=10000"

wget -qO audit.csv \
  "http://localhost:8080/api/proxy/audit/export?session_id=${SESSION_ID}&format=csv&limit=10000"
```

For NDJSON-style streaming (one record per line, easier to feed into
SIEM ingest):

```bash
python3 -c "import json; [print(json.dumps(e)) for e in json.load(open('audit.json'))]" > audit.ndjson
```

## 3. Walk one entry

```bash
python3 -c "
import json
entries = json.load(open('audit.json'))
print(f'entries: {len(entries)}')
print(json.dumps(entries[0], indent=2)[:800])
"
```

Expected shape (abridged):

```json
{
  "id": "01HX...",
  "session_id": "<uuid>",
  "ts_request": 1714200000.123,
  "ts_response": 1714200001.456,
  "method": "POST",
  "url": "https://api.anthropic.com/v1/messages",
  "model": "claude-3.5-sonnet",
  "request_body_redacted": "...",
  "response_body_redacted": "...",
  "input_tokens": 1820,
  "output_tokens": 510,
  "status": 200,
  "latency_ms": 1333
}
```

`request_body_redacted` and `response_body_redacted` are post-redaction;
`sk-…` keys, `Bearer …` tokens, and provider account ids are masked.

## 4. Correlate the entry to the chat panel

Take the `ts_request` of an entry, copy the timestamp, and scroll
the chat panel for the same session to the matching turn. Each chat
message exposes its source JSONL line — same evidence trail from
two sides.

## 5. Replay (read-only)

The audit log holds the redacted request body. Replay against the
proxy (with manual mode on, so you stay in the loop) is the safe
default; replay against the upstream directly is only useful for
offline benchmarking.

## See also

- [`codex-session-spawn.md`](codex-session-spawn.md) — generate a
  session worth auditing in the first place
- [`intercept-api-request.md`](intercept-api-request.md) — gate
  requests at the moment they happen, not after the fact
- [`docs/evidence-loop-details.md`](../docs/evidence-loop-details.md)
  — full audit-log NDJSON schema and persistence layers
