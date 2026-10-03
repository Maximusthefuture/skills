#!/usr/bin/env python3
"""
PostToolUse check for everyday security holes in Java / Spring code and config.

- SQL/JPQL built by concatenation, String.format or text-block .formatted()
- hard-coded secrets (provider key shapes, literals in application config)
- secrets / credentials referenced in log calls
- TLS verification disabled (trust-all managers, no-op hostname verifiers)
- shell command execution, unsafe deserialization, SpEL injection, XXE
- weak password encoders / hashes / ciphers, non-crypto randomness for tokens
- Spring Security: permitAll catch-alls, CSRF off, wildcard CORS, web.ignoring()
- Actuator fully exposed, stack traces in error responses
- open redirects, tokens in URLs

Warns through additionalContext, never blocks. See skills/security-discipline.
"""

import os
import re

from _common import (
    current_content, emit, file_path, is_test_or_generated, line_of, read_payload, run,
    strip_java_comments,
)

JAVA_RULES = [
    # --- injection ---
    ("blocking", "sql-concat",
     re.compile(r"\b(createQuery|createNativeQuery|createSelectionQuery|createMutationQuery|prepareStatement|"
                r"executeQuery|executeUpdate|execute|queryForObject|queryForList|queryForMap|query|update|batchUpdate|sql)"
                r"\s*\(\s*\"[^\"]*\"\s*\+\s*\w"),
     "SQL/JPQL built by string concatenation. Use bind parameters (:name / ?), Spring Data derived queries, or "
     "Criteria. For dynamic ORDER BY, map user input onto an allowlist of columns."),
    ("blocking", "sql-format",
     re.compile(r"String\.format\s*\(\s*\"\s*(SELECT|INSERT|UPDATE|DELETE|WITH|MERGE)\b", re.IGNORECASE),
     "SQL built with String.format. Use bind parameters."),
    ("blocking", "sql-formatted-textblock",
     re.compile(r"\"\"\"[^\"]*?\b(SELECT|INSERT|UPDATE|DELETE|WITH)\b[\s\S]*?\"\"\"\s*\.formatted\s*\(", re.IGNORECASE),
     "SQL text block filled with .formatted(). Use bind parameters."),
    ("risk", "sql-concat-generic",
     re.compile(r"\"\s*(SELECT\b[^\"\n]*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b[^\"\n]*\"\s*\+\s*[a-z]\w*", re.IGNORECASE),
     "Probable SQL built by concatenation. Use bind parameters."),
    ("risk", "jpasort-unsafe",
     re.compile(r"JpaSort\s*\.\s*unsafe\s*\("),
     "JpaSort.unsafe passes the expression into JPQL as-is. Never feed it request input; use an allowlist."),
    ("blocking", "command-exec",
     re.compile(r"Runtime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(|new\s+ProcessBuilder\s*\([^)]*\"(sh|bash|cmd(\.exe)?)\"\s*,\s*\"(-c|/c)\""),
     "Shell command execution. With any input in the command this is command injection: pass an argument list to "
     "ProcessBuilder without a shell, or remove the call."),
    ("blocking", "spel-injection",
     re.compile(r"parseExpression\s*\(\s*(?!\")"),
     "SpEL expression parsed from a non-literal string: if any of it is user input, this is remote code execution. "
     "Use SimpleEvaluationContext at minimum, better avoid dynamic expressions."),
    ("blocking", "unsafe-deserialization",
     re.compile(r"new\s+ObjectInputStream\s*\(|\b(activateDefaultTyping|enableDefaultTyping)\s*\(|"
                r"JsonTypeInfo\.Id\.(CLASS|MINIMAL_CLASS)"),
     "Polymorphic / native Java deserialization of untrusted data is a known RCE vector. Use explicit DTO types, "
     "or JsonTypeInfo.Id.NAME with a closed set of subtypes."),
    ("risk", "snakeyaml-unsafe",
     re.compile(r"new\s+Yaml\s*\(\s*\)"),
     "new Yaml() on untrusted input can instantiate arbitrary types on SnakeYAML < 2.0. Use SafeConstructor / "
     "LoaderOptions or Jackson YAML into a DTO."),
    # --- TLS ---
    ("blocking", "tls-disabled",
     re.compile(r"\b(TrustAllStrategy|TrustSelfSignedStrategy|NoopHostnameVerifier|ALLOW_ALL_HOSTNAME_VERIFIER|"
                r"InsecureTrustManagerFactory)\b|setHostnameVerifier\s*\(\s*\(?[^)]*\)?\s*->\s*true|"
                r"checkServerTrusted\s*\([^)]*\)\s*(throws\s+[\w.]+\s*)?\{\s*\}"),
     "TLS certificate or hostname verification disabled. Never in production; import the CA into a truststore "
     "instead."),
    # --- crypto ---
    ("blocking", "weak-password-encoder",
     re.compile(r"\b(NoOpPasswordEncoder|StandardPasswordEncoder|Md5PasswordEncoder|ShaPasswordEncoder|LdapShaPasswordEncoder)\b"),
     "Weak / no-op password encoder. Use PasswordEncoderFactories.createDelegatingPasswordEncoder() (bcrypt) or "
     "Argon2PasswordEncoder."),
    ("risk", "weak-hash",
     re.compile(r"MessageDigest\s*\.\s*getInstance\s*\(\s*\"(MD5|SHA-?1)\"", re.IGNORECASE),
     "MD5/SHA-1: never for passwords or signatures. Passwords -> PasswordEncoder; integrity -> HMAC-SHA256 with "
     "MessageDigest.isEqual for comparison."),
    ("risk", "ecb-cipher",
     re.compile(r"Cipher\s*\.\s*getInstance\s*\(\s*\"(AES|DES|DESede|Blowfish)(/ECB[^\"]*)?\"|\"[A-Za-z]+/ECB/"),
     "ECB mode (also the default for Cipher.getInstance(\"AES\")) leaks plaintext patterns. Use AES/GCM/NoPadding "
     "with a random 12-byte IV, or a vetted library (Tink)."),
    ("risk", "insecure-random",
     re.compile(r"^(?=[^\n]*(new\s+Random\s*\(|Math\.random\s*\(|ThreadLocalRandom\.current\s*\())"
                r"(?=[^\n]*(token|secret|otp|nonce|password|salt))[^\n]*", re.IGNORECASE | re.MULTILINE),
     "java.util.Random / Math.random are predictable. Use SecureRandom for tokens, OTPs, nonces, salts."),
    # --- logging ---
    ("risk", "log-leak",
     re.compile(r"\b(log|logger|LOG|LOGGER)\s*\.\s*(trace|debug|info|warn|error)\s*\([^;]*?\b"
                r"(password|passwd|secret|token|authorization|cookie|apiKey|api_key|cardNumber|cvv|pan)\b",
                re.IGNORECASE),
     "Credential or sensitive field referenced in a log call. Log an id, not the value; mask at the logger."),
    # --- spring security ---
    ("blocking", "permit-all-catchall",
     re.compile(r"anyRequest\s*\(\s*\)\s*\.\s*permitAll\s*\(|requestMatchers\s*\(\s*\"/\*\*\"\s*\)\s*\.\s*permitAll"),
     "Catch-all permitAll(): every endpoint, including future ones, is public by default. End the chain with "
     "anyRequest().authenticated() (or denyAll()) and allowlist public paths."),
    ("note", "csrf-disabled",
     re.compile(r"csrf\s*\(\s*(AbstractHttpConfigurer::disable|\w+\s*->\s*\w+\s*\.\s*disable\s*\(\s*\))\s*\)|"
                r"csrf\s*\(\s*\)\s*\.\s*disable\s*\("),
     "CSRF disabled. Correct only for stateless bearer-token APIs; with session cookies (formLogin, Spring Session) "
     "this opens CSRF on every state-changing endpoint."),
    ("risk", "cors-wildcard",
     re.compile(r"allowedOrigin(s|Patterns)\s*\(\s*\"\*\"|@CrossOrigin\s*(\(\s*\)|(?!\s*\())|"
                r"@CrossOrigin\s*\([^)]*origins\s*=\s*\"\*\""),
     "Wildcard CORS (@CrossOrigin without origins allows all). Use an explicit origin allowlist, especially with "
     "allowCredentials(true)."),
    ("note", "web-ignoring",
     re.compile(r"\.\s*ignoring\s*\(\s*\)"),
     "web.ignoring() removes paths from the whole security filter chain (no security headers, no auth). Prefer "
     "permitAll() for public endpoints."),
    # --- web ---
    ("risk", "open-redirect",
     re.compile(r"\"redirect:\"\s*\+\s*\w|sendRedirect\s*\(\s*(request\.getParameter|\w*[uU]rl\b|\w*[rR]edirect\w*\b)"),
     "Redirect to a request-controlled URL (open redirect). Redirect only to relative paths or an allowlist."),
    ("risk", "xxe",
     re.compile(r"(DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|TransformerFactory)\s*\.\s*new(Default)?Instance\s*\("),
     "XML parser factory: unless DTDs/external entities are disabled (disallow-doctype-decl, "
     "XMLConstants.FEATURE_SECURE_PROCESSING, SUPPORT_DTD=false) it is open to XXE."),
]

GENERIC_SECRET_RULES = [
    ("blocking", "secret-shape", re.compile(r"sk_live_[0-9a-zA-Z]{16,}|rk_live_[0-9a-zA-Z]{16,}"), "Stripe live key in source."),
    ("blocking", "secret-shape", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key id in source."),
    ("blocking", "secret-shape", re.compile(r"\bxox[baprs]-[0-9a-zA-Z-]{10,}"), "Slack token in source."),
    ("blocking", "secret-shape", re.compile(r"\bgh[pousr]_[0-9a-zA-Z]{30,}|github_pat_[0-9a-zA-Z_]{30,}"), "GitHub token in source."),
    ("blocking", "secret-shape", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "Private key in source."),
    ("blocking", "secret-shape", re.compile(r"jdbc:postgresql://[^\s\"']*[?&]password=[^&\s\"'$]+|postgres(ql)?://[^/\s'\"$]+:[^@\s'\"$]+@", re.IGNORECASE),
     "Database URL with an embedded password."),
    ("risk", "token-in-url",
     re.compile(r"[?&](token|api[_-]?key|access[_-]?token|auth[_-]?token|password)=[^&\s\"'<>${}]+", re.IGNORECASE),
     "Credential in a URL query string: it ends up in access logs, proxies and Referer headers. Send it in a header."),
]

JAVA_SECRET_LITERAL = re.compile(
    r"\b\w*(password|secret|apiKey|api_key|accessToken|clientSecret|privateKey)\w*\s*=\s*\"[^\"\s]{8,}\"", re.IGNORECASE)

CONFIG_RULES = [
    ("blocking", "actuator-exposed",
     re.compile(r"exposure\.include\s*=\s*\*|exposure\s*:\s*\n\s*include\s*:\s*[\"']?\*", re.IGNORECASE),
     "All Actuator endpoints exposed: /heapdump and /env leak secrets and session data, /loggers lets anyone change "
     "log levels. Expose only health,info,prometheus and put the management port behind the network boundary."),
    ("risk", "env-show-values",
     re.compile(r"show-values\s*[:=]\s*[\"']?always", re.IGNORECASE),
     "Actuator show-values=ALWAYS returns secrets unmasked from /env and /configprops."),
    ("risk", "error-details-exposed",
     re.compile(r"include-(stacktrace|exception|message|binding-errors)\s*[:=]\s*[\"']?(always|true)", re.IGNORECASE),
     "Error responses include stack traces / exception messages: framework, versions, SQL and paths leak to clients. "
     "Keep server.error.include-* at never and return ProblemDetail with stable codes."),
]

CONFIG_SECRET_LITERAL = re.compile(
    r"^\s*[\w.-]*(password|secret|api-key|apikey|token|client-secret|private-key)[\w.-]*\s*[:=]\s*"
    r"(?![\"']?\$\{)(?![\"']?\s*$)(?![\"']?(\d+[smhdSMHD]?|true|false)[\"']?\s*$)[\"']?([^\s\"'#]{6,})", re.IGNORECASE | re.MULTILINE)

CONFIG_NAME = re.compile(r"^(application|bootstrap)([-.][\w-]+)?\.(ya?ml|properties)$", re.IGNORECASE)


def scan(rules, text, out, seen):
    for severity, rule_id, pattern, message in rules:
        m = pattern.search(text)
        if m and (rule_id, message) not in seen:
            seen.add((rule_id, message))
            snippet = m.group(0).splitlines()[0][:90]
            out.append((severity, rule_id, "{} (line {}: `{}`)".format(message, line_of(text, m.start()), snippet.strip())))


def main():
    payload = read_payload()
    if not payload:
        return
    path = file_path(payload)
    if not path or is_test_or_generated(path):
        return
    content = current_content(payload)
    if not content.strip():
        return
    base = os.path.basename(path)
    out, seen = [], set()
    if path.endswith(".java"):
        src = strip_java_comments(content)
        scan(JAVA_RULES, src, out, seen)
        scan(GENERIC_SECRET_RULES, src, out, seen)
        m = JAVA_SECRET_LITERAL.search(src)
        if m:
            out.append(("blocking", "secret-literal",
                        "Hard-coded secret literal (line {}). Load it from configuration bound to an environment "
                        "variable or secret manager.".format(line_of(src, m.start()))))
    elif CONFIG_NAME.match(base):
        scan(CONFIG_RULES, content, out, seen)
        scan(GENERIC_SECRET_RULES, content, out, seen)
        m = CONFIG_SECRET_LITERAL.search(content)
        if m and not re.search(r"-(local|test)\.", base.lower()):
            out.append(("blocking", "secret-literal",
                        "Literal secret in {} (line {}). Use `${{ENV_VAR}}` placeholders resolved from the environment "
                        "or a secret manager; never commit real values.".format(base, line_of(content, m.start()))))
    else:
        return
    emit("security", path, out,
         "See skills/security-discipline. For a full pass, ask the security-reviewer agent.")


if __name__ == "__main__":
    run(main)
