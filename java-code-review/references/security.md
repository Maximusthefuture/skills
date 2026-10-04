# Security

A security finding must describe a concrete path: where untrusted data comes from and where it ends up. "There may be a vulnerability here" without a path is not a finding.

## Injections
- SQL/JPQL/HQL/native queries built by concatenation or `String.format` with user data. A dynamic `ORDER BY` from a request parameter without an allowlist.
- `Criteria`/`Specification` with `like` and unescaped `%`/`_` (not an injection, but a filter bypass).
- A command line (`ProcessBuilder`, `Runtime.exec`) with user input.
- LDAP, XPath, SpEL (`SpelExpressionParser` on a user string), templates (Thymeleaf/Freemarker with a user-supplied template).
- File paths from input without normalization and a root check (path traversal); `MultipartFile.getOriginalFilename()` as a path.

## Authentication and authorization
- A new endpoint is not covered by `SecurityFilterChain` rules or is opened by `permitAll` with too broad a pattern.
- No resource ownership check (IDOR): `GET /orders/{id}` returns someone else's order, only authentication is checked.
- `@PreAuthorize` on a method called via self-invocation (will not fire), or on an interface without method security enabled.
- CSRF disabled for cookie sessions; CORS `allowedOrigins("*")` together with credentials.
- JWT: the signature/algorithm/expiry is not checked, the secret is in code, the `none` algorithm.

## Data and secrets
- Secrets, tokens, passwords in code, `application.yml`, tests, logs.
- PII or tokens in logs, exception messages, error responses (stack traces going out).
- Passwords without a `PasswordEncoder` (BCrypt/Argon2); `MessageDigest` MD5/SHA-1 for passwords; `Random` instead of `SecureRandom` for tokens.
- Comparing secrets with `equals` instead of `MessageDigest.isEqual` (timing).

## Deserialization and parsing
- Jackson `enableDefaultTyping`/`@JsonTypeInfo(use = CLASS)` on untrusted input.
- Java serialization (`ObjectInputStream`) of untrusted data.
- XML parsers without external entities disabled (XXE): `DocumentBuilderFactory`, `SAXParserFactory`, `XMLInputFactory`.
- Mass assignment: binding a request directly to an entity, allowing `role`, `isAdmin`, `ownerId` to be set.

## Network
- SSRF: an HTTP request to a URL from user input without a host allowlist.
- Disabled TLS certificate checks (`TrustAllCerts`, `NoopHostnameVerifier`).
- Open redirect: `redirect:` + a request parameter.

## Dependencies
- A new dependency with known vulnerabilities or from a non-standard repository; a downgrade of a security library.
