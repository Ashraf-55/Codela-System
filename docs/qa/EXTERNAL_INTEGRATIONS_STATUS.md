# External integrations status

| Integration | Implemented in code | Verified locally | Verified against the real provider | Needs from you |
|---|---|---|---|---|
| Paymob (checkout, HMAC callback, refunds) | yes | yes, with a faked provider in tests | **no** | merchant account, API key, integration id, iframe id, HMAC secret, webhook URL; run one sandbox payment |
| Automatic monthly card charging | **no** | no | no | Paymob tokenization/recurring capability and a new implementation |
| Resend e-mail + delivery receipts | yes | signature logic tested with synthetic signatures | **no** | API key, verified sending domain, webhook secret |
| Twilio SMS + status callbacks | yes | synthetic signatures | **no** | account, number, auth token |
| WhatsApp Cloud API + callbacks | yes | synthetic signatures | **no** | Meta business account, approved templates, tokens |
| Sentry | code present, unit-tested | partly | **no** | DSN |
| Custom domains (DNS TXT verification) | yes | yes, resolver faked | **no** | real DNS records |
| HTTPS / wildcard tenant domains | Caddy config provided | no | **no** | public server, DNS, wildcard certificate method (DNS challenge) |
| File storage | local disk only | yes | n/a | cloud storage provider if you need one |
| Video hosting for courses | **not inspected** in this review | no | no | provider decision and credentials |

Rule: until a row says verified against the real provider, treat the integration as **not live**. Local sandbox success is not production readiness.
