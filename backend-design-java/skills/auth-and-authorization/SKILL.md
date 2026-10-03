---
name: auth-and-authorization
description: Use when designing or modifying any Spring Security configuration, login/session/token flow, OAuth2 resource server or client, method-level permission, ownership check, multi-tenant data scope, or admin path. Forces the split between authentication and authorization, a conscious enforcement layer (filter chain, @PreAuthorize, query scope, PostgreSQL RLS), and treating tokens as bearer credentials. Triggers also on "авторизация", "аутентификация", "права доступа", "роли", "JWT", "OAuth", "Keycloak", "мультитенантность", "Spring Security".
---

# Auth And Authorization

Auth is two systems. Authentication identifies the caller; authorization decides what that caller may touch. Conflating them ships holes like "any valid token can read any order" or "the filter chain passed, so the repository trusts the id from the body".

## The Discipline

For any change that touches auth, answer five questions:

1. **AuthN:** how does the service know who is calling? A session cookie, a bearer JWT from the IdP, mTLS, or a signed webhook.
2. **AuthZ:** what may this principal do, on which resources, in which scope (tenant, project, row)?
3. **Enforcement point:** the filter chain (coarse), method security (business permission), query scope or RLS (row). Pick each on purpose.
4. **Failure mode:** closed by default. No matching rule means denied.
5. **Audit:** every security decision that matters logs the principal, action, resource, outcome and traceId.

## AuthN In Spring

- **Browser users of your own web app:** server-side sessions (Spring Session JDBC/Redis), `HttpOnly` + `Secure` + `SameSite` cookies, CSRF on, an absolute timeout plus an idle timeout. Logout invalidates the session server-side.
- **API behind an IdP (Keycloak, Okta, Entra ID):** `oauth2ResourceServer().jwt()`. Validate:
  - `iss`: `spring.security.oauth2.resourceserver.jwt.issuer-uri`;
  - `aud`: `...jwt.audiences`, or a custom `OAuth2TokenValidator`. Without an audience check, a token issued for another app works on yours;
  - `exp`/`nbf`: done by default, with the clock-skew default noted.
  Map roles explicitly with a `JwtAuthenticationConverter` (Keycloak roles live in `realm_access`/`resource_access`, not `scope`).
- **SPA:** Authorization Code + PKCE, and preferably a BFF (Spring Cloud Gateway or your app as an OAuth2 client holding tokens server-side) so tokens never sit in `localStorage`.
- **Service-to-service:** client credentials (`OAuth2AuthorizedClientManager` with `RestClient`) with a narrow audience/scope per caller, or mTLS. No shared static API keys between all services.
- **Webhooks in:** HMAC signature over the raw body, compared with `MessageDigest.isEqual`, plus a timestamp window and dedup by event id.
- **Admin / ops endpoints:** per-operator identity through the same IdP, no shared accounts, every action audited.

Do not build your own JWT issuance or login filter when the org has an IdP. Spring Authorization Server exists if you truly are the IdP.

## Tokens Are Bearer Credentials

- Access tokens are short-lived (minutes). Refresh tokens rotate and are not visible to browser JavaScript.
- Claims are a snapshot. A demoted user keeps their roles until expiry. For sensitive actions, re-check current state (account status, membership) against the DB.
- Tokens never go in URLs or logs. Mask `Authorization` in request logging.

## AuthZ: Where To Enforce

Defense in depth, each layer doing its own job:

1. **Filter chain:** "authenticated or explicitly public". Coarse URL rules only:
   ```java
   http.authorizeHttpRequests(a -> a
       .requestMatchers("/actuator/health/**").permitAll()
       .requestMatchers("/admin/**").hasRole("ADMIN")
       .anyRequest().authenticated());
   ```
2. **Method security:** the business permission at the service or controller method. Centralize the decision in one bean, so `if (user.isAdmin())` is not scattered across fifty methods:
   ```java
   @PreAuthorize("@projectAccess.canEdit(#projectId, authentication)")
   public void rename(UUID projectId, String name) { ... }
   ```
3. **Query scope:** repository methods take the scope from the principal (`findByIdAndTenantId`). A missing scope returns empty, which becomes 404.
4. **Database (RLS):** the last line for multi-tenant data, the one that still holds when 1–3 have a bug.

Model: start with RBAC plus per-resource ownership checks. Move to ReBAC (SpiceDB/OpenFGA) only when sharing graphs ("shared with team X on project Y") dominate. Do not invent a policy engine.

## Multi-Tenancy With PostgreSQL RLS

Hibernate `@TenantId`, `@Filter` or a base-repository `where tenant_id = ?` are app-level filters. They fail **open** on native queries, `JdbcClient`, reports and new code. Put the floor in Postgres:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;   -- otherwise the table OWNER bypasses RLS
CREATE POLICY tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

and set the tenant **per transaction**, because pooled connections are reused across requests:

```java
// first statement inside every @Transactional unit of work
jdbcClient.sql("select set_config('app.tenant_id', ?, true)")   // true = transaction-local (SET LOCAL)
          .param(tenantId.toString()).query().singleValue();
```

Rules:
- The app connects as a role that is **not** the table owner and **not** superuser/`BYPASSRLS`. Liquibase runs as a separate owner role.
- Use transaction-local only (`set_config(..., true)` / `SET LOCAL`). A session-level `SET` leaks the tenant to the next request on that pooled connection.
- The tenant comes from the authenticated principal, never from a header or body field the client controls.
- Write tests that prove isolation: tenant A cannot read B through the repository, a native query, or a missing filter.

## Anti-Patterns

- **Authorization only in the filter chain.** `/orders/**` requires `USER`, then `findById(anyId)`.
- **`@PreAuthorize` on a private or self-invoked method.** The proxy never sees it, so there is no check.
- **Role checks on JWT `scope` when the IdP puts roles elsewhere**, so every check silently fails, or someone "fixes" it with `permitAll`.
- **No audience validation** on the resource server.
- **Tenant id from the `X-Tenant-Id` header** without checking membership.
- **The app DB user owns the tables**, so RLS is silently bypassed without `FORCE`.
- **Shared service account for admin tooling.** No accountability in the first incident.
- **Login throttling per IP only.** Credential stuffing rotates IPs. Throttle per account too.

## Quick Decision Guide

| Question | Default | Deviate when |
|----------|---------|--------------|
| Browser auth | Server sessions (Spring Session) or BFF | Pure API consumed by other services |
| API auth | Resource server JWT from the org IdP, `iss` + `aud` validated | Internal mTLS mesh |
| Service-to-service | Client credentials, narrow audience | Same trust domain with mTLS |
| Permission check | `@PreAuthorize` → central access bean | Trivial role-only endpoints |
| Row ownership | Scope in the query, 404 on miss | Never "load, then check in the controller" |
| Multi-tenant floor | RLS + `FORCE` + transaction-local tenant | Single-tenant |
| Webhook in | HMAC + timestamp + dedup | Internal only, mTLS |
| Admin actions | IdP identity, audited, scoped | Never a shared account |

## See also

- [[security-discipline]] for the per-change reflex
- [[data-modeling-discipline]] for tenant columns and constraints
- [[jpa-and-transactions]] for proxy rules that also apply to `@PreAuthorize`
- [[observability-by-default]] for audit logs
- [[think-before-coding]] Step 4 invokes this skill
