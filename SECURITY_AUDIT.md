# FORCE Arena Security Verification

## Implemented controls

- Cookie-only authentication.
- 30-day sessions with seven-day token rotation.
- Same-origin enforcement for state-changing browser requests.
- Generic internal-error responses.
- Server-only Supabase Service Role client.
- No Anon Key requirement or public realtime-config endpoint.
- No legacy direct-Supabase browser client.
- Atomic duel-answer RPC with row lock, single insert, server timing, server order validation, and server scoring.
- Worker POST-only access with mandatory header secret and timing-safe comparison.
- Database privileges revoked from PUBLIC, anon, and authenticated.
- Default database privileges hardened for future objects.
- CSP, HSTS, MIME sniffing protection, referrer policy, permissions policy, and clickjacking protection.

## Deployment order

1. Back up the active Supabase database.
2. Run `supabase/migrations/20260717_security_hardening.sql`.
3. Verify role privileges using the queries at the bottom of the migration.
4. Set Vercel environment variables from `.env.example`.
5. Deploy the application code.
6. Run the production checklist in `README.md`.

## Important limitation

This repository review verifies source-code controls and build behavior. A production penetration test, dependency monitoring, WAF configuration, secret rotation, and Supabase audit-log review remain operational responsibilities.

## Verification results

- `npm run check:static`: passed.
- `npm run check:security`: passed.
- `npm audit`: 0 known vulnerabilities.
- `npm run build`: passed.
- `supabase/schema.sql`: PostgreSQL parser accepted 183 statements.
- `supabase/migrations/20260717_security_hardening.sql`: PostgreSQL parser accepted 20 statements.
- Runtime smoke test confirmed security headers, minimal `/api/health`, HTTP 404 for `/api/realtime-config`, HTTP 405 for worker GET, and HTTP 403 for an invalid worker secret.
