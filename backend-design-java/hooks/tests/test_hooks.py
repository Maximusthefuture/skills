#!/usr/bin/env python3
"""
Positive / negative cases for every hook rule.

    python3 hooks/tests/test_hooks.py -v

Each case writes a file into a temp project tree, feeds the hook the same JSON
Claude Code sends on PostToolUse, and asserts which rule ids are reported.
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

HOOKS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run_hook(hook, rel_path, content, tool="Write", tool_input_extra=None, original=None):
    with tempfile.TemporaryDirectory() as root:
        path = os.path.join(root, rel_path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content)
        tool_input = {"file_path": path}
        if tool == "Write":
            tool_input["content"] = content
        tool_input.update(tool_input_extra or {})
        payload = {"tool_name": tool, "tool_input": tool_input, "tool_response": {}}
        if original is not None:
            payload["tool_response"]["originalFile"] = original
        proc = subprocess.run([sys.executable, os.path.join(HOOKS, hook)], input=json.dumps(payload),
                              capture_output=True, text=True, timeout=20)
        assert proc.returncode == 0, proc.stderr
        if not proc.stdout.strip():
            return set(), ""
        ctx = json.loads(proc.stdout)["hookSpecificOutput"]["additionalContext"]
        ids = set()
        for line in ctx.splitlines():
            if line.startswith("- [") and "][" in line:
                ids.add(line.split("][", 1)[1].split("]", 1)[0])
        return ids, ctx


def d(s):
    return textwrap.dedent(s).lstrip()


CHANGELOG = "src/main/resources/db/changelog/changes/0042-orders.sql"


class MigrationHook(unittest.TestCase):
    H = "check_migration.py"

    def ids(self, content, **kw):
        return run_hook(self.H, kw.pop("path", CHANGELOG), content, **kw)[0]

    def test_index_without_concurrently(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:1
            CREATE INDEX idx_orders_customer ON orders (customer_id);
            --rollback DROP INDEX idx_orders_customer;
        """))
        self.assertIn("index-not-concurrently", ids)

    def test_index_on_new_table_is_fine(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:1
            CREATE TABLE orders (id bigint PRIMARY KEY, customer_id bigint NOT NULL REFERENCES customers(id));
            CREATE INDEX idx_orders_customer ON orders (customer_id);
            --rollback DROP TABLE orders;
        """))
        self.assertNotIn("index-not-concurrently", ids)
        self.assertNotIn("fk-without-not-valid", ids)
        self.assertNotIn("drop-table", ids)  # DROP only in --rollback

    def test_concurrently_needs_run_in_transaction_false(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:2
            CREATE INDEX CONCURRENTLY idx_orders_status ON orders (status);
            --rollback DROP INDEX CONCURRENTLY idx_orders_status;
        """))
        self.assertIn("concurrently-in-transaction", ids)
        self.assertNotIn("index-not-concurrently", ids)

    def test_concurrently_done_right(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:2 runInTransaction:false
            CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_status ON orders (status);
            --rollback DROP INDEX CONCURRENTLY IF EXISTS idx_orders_status;
        """))
        self.assertEqual(set(), ids)

    def test_xml_create_index(self):
        ids = self.ids(d("""
            <databaseChangeLog xmlns="http://www.liquibase.org/xml/ns/dbchangelog">
              <changeSet id="3" author="bob">
                <createIndex tableName="orders" indexName="idx_o"><column name="status"/></createIndex>
              </changeSet>
            </databaseChangeLog>
        """), path="src/main/resources/db/changelog/0003.xml")
        self.assertIn("index-not-concurrently", ids)

    def test_add_not_null_without_default(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:4
            ALTER TABLE invoices ADD COLUMN currency text NOT NULL;
            --rollback ALTER TABLE invoices DROP COLUMN currency;
        """))
        self.assertIn("add-not-null-no-default", ids)
        self.assertNotIn("drop-column", ids)

    def test_add_not_null_with_constant_default_is_fine(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:4
            SET LOCAL lock_timeout = '5s';
            ALTER TABLE invoices ADD COLUMN currency text NOT NULL DEFAULT 'EUR';
            --rollback ALTER TABLE invoices DROP COLUMN currency;
        """))
        self.assertEqual(set(), ids)

    def test_volatile_default(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:5
            ALTER TABLE invoices ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid();
            --rollback ALTER TABLE invoices DROP COLUMN public_id;
        """))
        self.assertIn("volatile-default", ids)

    def test_now_default_is_not_volatile(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:5
            ALTER TABLE invoices ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
            --rollback ALTER TABLE invoices DROP COLUMN created_at;
        """))
        self.assertNotIn("volatile-default", ids)

    def test_set_not_null_and_default_null_value(self):
        ids, ctx = run_hook(self.H, "src/main/resources/db/changelog/0006.xml", d("""
            <databaseChangeLog>
              <changeSet id="6" author="bob">
                <addNotNullConstraint tableName="invoices" columnName="currency" defaultNullValue="EUR"/>
              </changeSet>
            </databaseChangeLog>
        """))
        self.assertIn("set-not-null-scan", ids)
        self.assertIn("defaultNullValue", ctx)

    def test_destructive_ops(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:7
            ALTER TABLE invoices DROP COLUMN legacy_code;
            ALTER TABLE invoices RENAME COLUMN total TO amount;
            ALTER TABLE invoices ALTER COLUMN amount TYPE bigint;
            DROP TABLE invoice_tmp;
            --rollback not required
        """))
        self.assertTrue({"drop-column", "rename", "alter-column-type", "drop-table"} <= ids, ids)

    def test_fk_and_check(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:8
            ALTER TABLE orders ADD CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES customers(id);
            ALTER TABLE orders ADD CONSTRAINT total_pos CHECK (total >= 0);
            --rollback ALTER TABLE orders DROP CONSTRAINT fk_cust;
        """))
        self.assertIn("fk-without-not-valid", ids)
        self.assertIn("check-without-not-valid", ids)

    def test_fk_and_check_not_valid_ok(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:8
            SET LOCAL lock_timeout = '5s';
            ALTER TABLE orders ADD CONSTRAINT fk_cust FOREIGN KEY (customer_id) REFERENCES customers(id) NOT VALID;
            ALTER TABLE orders ADD CONSTRAINT total_pos CHECK (total >= 0) NOT VALID;
            --rollback ALTER TABLE orders DROP CONSTRAINT fk_cust;
        """))
        self.assertEqual(set(), ids)

    def test_backfill_in_migration(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:9
            UPDATE invoices SET currency = 'EUR' WHERE currency IS NULL;
            --rollback not required
        """))
        self.assertIn("data-change-in-migration", ids)

    def test_reference_insert_is_fine(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:10
            INSERT INTO currencies (code) VALUES ('EUR'), ('USD');
            --rollback DELETE FROM currencies WHERE code IN ('EUR', 'USD');
        """))
        self.assertEqual(set(), ids)

    def test_missing_rollback(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:11
            CREATE TABLE audit_log (id bigint PRIMARY KEY);
        """))
        self.assertIn("no-rollback", ids)

    def test_edit_of_existing_changeset(self):
        original = d("""
            --liquibase formatted sql
            --changeset alice:1
            CREATE TABLE a (id bigint PRIMARY KEY);
            --rollback DROP TABLE a;
        """)
        current = original.replace("id bigint PRIMARY KEY", "id bigint PRIMARY KEY, name text")
        ids = run_hook(self.H, CHANGELOG, current, tool="Edit", tool_input_extra={
            "old_string": "id bigint PRIMARY KEY);", "new_string": "id bigint PRIMARY KEY, name text);"})[0]
        self.assertIn("edited-existing-changeset", ids)

    def test_appending_new_changeset_reports_only_new_one(self):
        original = d("""
            --liquibase formatted sql
            --changeset alice:1
            CREATE INDEX idx_old ON orders (x);
            --rollback DROP INDEX idx_old;
        """)
        addition = d("""
            --changeset alice:2
            CREATE TABLE b (id bigint PRIMARY KEY);
            --rollback DROP TABLE b;
        """)
        ids = run_hook(self.H, CHANGELOG, original + addition, tool="Write", original=original)[0]
        self.assertEqual(set(), ids)  # old changeset's plain index is not re-reported

    def test_lock_timeout_note(self):
        ids = self.ids(d("""
            --liquibase formatted sql
            --changeset alice:12
            ALTER TABLE orders ADD COLUMN note text;
            --rollback ALTER TABLE orders DROP COLUMN note;
        """))
        self.assertEqual({"no-lock-timeout"}, ids)

    def test_non_migration_file_ignored(self):
        ids = run_hook(self.H, "src/main/resources/templates/report.sql", "UPDATE x SET y = 1;")[0]
        self.assertEqual(set(), ids)


class ComponentHook(unittest.TestCase):
    H = "check_backend_component.py"

    def ids(self, rel, content):
        return run_hook(self.H, rel, content)[0]

    SVC = "src/main/java/com/acme/order/OrderService.java"
    CTRL = "src/main/java/com/acme/order/OrderController.java"
    ENT = "src/main/java/com/acme/order/entity/Order.java"

    def test_transactional_private_and_side_effect(self):
        ids = self.ids(self.SVC, d("""
            @Service
            public class OrderService {
                @Transactional
                private void hidden() {}

                @Transactional
                public void pay(long id) {
                    var o = repo.findById(id).orElseThrow();
                    paymentClient.post().uri("/charge").retrieve();
                    o.markPaid();
                }
            }
        """))
        self.assertIn("transactional-private", ids)
        self.assertIn("side-effect-in-transaction", ids)

    def test_clean_service(self):
        ids = self.ids(self.SVC, d("""
            @Service
            public class OrderService {
                private static final Logger log = LoggerFactory.getLogger(OrderService.class);
                @Transactional
                public void pay(long id) {
                    var o = repo.findById(id).orElseThrow();
                    o.markPaid();
                    outbox.save(OutboxEvent.paymentRequested(o));
                }
                public void load() {
                    try { doIt(); } catch (IOException e) { log.warn("load.failed", e); throw new UncheckedIOException(e); }
                }
            }
        """))
        self.assertEqual(set(), ids)

    def test_swallowed_exceptions(self):
        ids = self.ids(self.SVC, d("""
            public class OrderService {
                void a() { try { x(); } catch (IOException e) {} }
                void b() { try { x(); } catch (Exception e) { counter++; } }
                void c() { try { x(); } catch (Exception e) { e.printStackTrace(); } }
            }
        """))
        self.assertTrue({"empty-catch", "broad-catch-swallowed", "stdout-logging"} <= ids, ids)

    def test_controller(self):
        ids = self.ids(self.CTRL, d("""
            import com.acme.order.entity.Order;
            @RestController
            @RequestMapping("/orders")
            public class OrderController {
                @PutMapping("/{id}")
                public Order update(@PathVariable long id, @RequestBody Order order) { return service.save(order); }
                @GetMapping
                public List<Order> all() { return orderRepository.findAll(); }
            }
        """))
        self.assertTrue({"request-body-not-validated", "entity-as-request-body", "no-visible-authz",
                         "unbounded-findall"} <= ids, ids)

    def test_controller_ok(self):
        ids = self.ids(self.CTRL, d("""
            @RestController
            public class OrderController {
                @PreAuthorize("@orderAccess.canEdit(#id, authentication)")
                @PutMapping("/orders/{id}")
                public OrderView update(@PathVariable long id, @Valid @RequestBody UpdateOrderRequest req) {
                    return service.update(id, req);
                }
            }
        """))
        self.assertEqual(set(), ids)

    def test_listener_and_scheduled(self):
        ids = self.ids("src/main/java/com/acme/order/Jobs.java", d("""
            public class Jobs {
                @KafkaListener(topics = "orders")
                public void on(OrderCreated e) { service.handle(e); }
                @Scheduled(cron = "0 0 * * * *")
                public void nightly() { service.run(); }
            }
        """))
        self.assertTrue({"listener-no-dedup", "kafka-error-handling", "scheduled-no-lock"} <= ids, ids)

    def test_listener_and_scheduled_ok(self):
        ids = self.ids("src/main/java/com/acme/order/Jobs.java", d("""
            public class Jobs {
                @RetryableTopic(attempts = "4", backoff = @Backoff(delay = 1000, multiplier = 2))
                @KafkaListener(topics = "orders")
                public void on(OrderCreated e) { processedEvents.insertIfAbsent(e.eventId()); }
                @DltHandler public void dlt(OrderCreated e) { log.error("order.dlt eventId={}", e.eventId()); }
                @Scheduled(cron = "0 0 * * * *")
                @SchedulerLock(name = "nightly", lockAtMostFor = "PT30M")
                public void nightly() { service.run(); }
            }
        """))
        self.assertEqual(set(), ids)

    def test_http_client_without_timeout(self):
        ids = self.ids("src/main/java/com/acme/pay/PayClient.java", d("""
            public class PayClient {
                private final RestTemplate rt = new RestTemplate();
                public void charge(Charge c) { rt.postForObject(url, c, Void.class); }
            }
        """))
        self.assertIn("http-client-no-timeout", ids)
        self.assertIn("outbound-post-no-idempotency", ids)

    def test_entity(self):
        ids = self.ids(self.ENT, d("""
            @Entity
            @Data
            public class Order {
                @Id @GeneratedValue(strategy = GenerationType.IDENTITY) private Long id;
                @ManyToOne private Customer customer;
                @OneToMany(fetch = FetchType.EAGER) private List<Line> lines;
                @Enumerated private Status status;
                private double totalAmount;
                private LocalDateTime createdAt;
            }
        """))
        self.assertTrue({"lombok-on-entity", "eager-to-one", "fetch-eager", "enum-ordinal", "float-money",
                         "timestamp-type", "identity-ids"} <= ids, ids)

    def test_entity_ok(self):
        ids = self.ids(self.ENT, d("""
            @Entity
            @Getter
            public class Order {
                @Id @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "order_seq") private Long id;
                @ManyToOne(fetch = FetchType.LAZY, optional = false) private Customer customer;
                @Enumerated(EnumType.STRING) private Status status;
                private BigDecimal totalAmount;
                private Instant createdAt;
                @Version private long version;
            }
        """))
        self.assertEqual(set(), ids)

    def test_config(self):
        ids = self.ids("src/main/resources/application.yml", d("""
            spring:
              jpa:
                hibernate:
                  ddl-auto: update
                show-sql: true
        """))
        self.assertEqual({"ddl-auto", "open-in-view", "show-sql"}, ids)

    def test_config_ok(self):
        ids = self.ids("src/main/resources/application.yml", d("""
            spring:
              jpa:
                open-in-view: false
                hibernate:
                  ddl-auto: validate
        """))
        self.assertEqual(set(), ids)

    def test_tests_are_skipped(self):
        ids = self.ids("src/test/java/com/acme/OrderServiceTest.java", "class T { void a(){ try{}catch(Exception e){} } }" * 3)
        self.assertEqual(set(), ids)

    def test_package_named_testimonials_not_skipped(self):
        ids = self.ids("src/main/java/com/acme/testimonials/Svc.java",
                       "class S { void a(){ try { x(); } catch (IOException e) {} } }")
        self.assertIn("empty-catch", ids)


class SecurityHook(unittest.TestCase):
    H = "check_security.py"

    def ids(self, rel, content):
        return run_hook(self.H, rel, content)[0]

    J = "src/main/java/com/acme/Repo.java"

    def test_sql_injection_variants(self):
        ids = self.ids(self.J, d('''
            class Repo {
                List<User> a(String n) { return em.createQuery("select u from User u where u.name = '" + n + "'").getResultList(); }
                List<User> b(String n) { return jdbc.query(String.format("SELECT * FROM users WHERE name = '%s'", n), mapper); }
                List<User> c(String n) { return jdbc.query("""
                    SELECT * FROM users WHERE name = '%s'
                    """.formatted(n), mapper); }
            }
        '''))
        self.assertTrue({"sql-concat", "sql-format", "sql-formatted-textblock"} <= ids, ids)

    def test_parameterized_sql_ok(self):
        ids = self.ids(self.J, d('''
            class Repo {
                List<User> a(String n) { return em.createQuery("select u from User u where u.name = :n", User.class).setParameter("n", n).getResultList(); }
                void log(Exception e) { log.warn("Update failed: " + e.getMessage()); }
            }
        '''))
        self.assertEqual(set(), ids)

    def test_spring_security_config(self):
        ids = self.ids("src/main/java/com/acme/SecurityConfig.java", d('''
            class SecurityConfig {
                SecurityFilterChain chain(HttpSecurity http) throws Exception {
                    return http.csrf(AbstractHttpConfigurer::disable)
                        .authorizeHttpRequests(a -> a.requestMatchers("/admin/**").hasRole("ADMIN").anyRequest().permitAll())
                        .build();
                }
                PasswordEncoder enc() { return NoOpPasswordEncoder.getInstance(); }
                WebMvcConfigurer cors() { return r -> r.addMapping("/**").allowedOrigins("*").allowCredentials(true); }
            }
        '''))
        self.assertTrue({"csrf-disabled", "permit-all-catchall", "weak-password-encoder", "cors-wildcard"} <= ids, ids)

    def test_secure_config_ok(self):
        ids = self.ids("src/main/java/com/acme/SecurityConfig.java", d('''
            class SecurityConfig {
                SecurityFilterChain chain(HttpSecurity http) throws Exception {
                    return http.authorizeHttpRequests(a -> a.requestMatchers("/actuator/health").permitAll()
                        .anyRequest().authenticated()).build();
                }
                PasswordEncoder enc() { return PasswordEncoderFactories.createDelegatingPasswordEncoder(); }
            }
        '''))
        self.assertEqual(set(), ids)

    def test_misc_java(self):
        ids = self.ids(self.J, d('''
            class X {
                void a() throws Exception {
                    var tm = new TrustManager[]{ new X509TrustManager() {
                        public void checkServerTrusted(X509Certificate[] c, String t) {} } };
                    new ObjectInputStream(in).readObject();
                    new SpelExpressionParser().parseExpression(userInput);
                    String token = Long.toHexString(new Random().nextLong());
                    log.info("login user={} password={}", user, password);
                    Runtime.getRuntime().exec("convert " + file);
                    MessageDigest.getInstance("MD5");
                }
                // String apiKey = "sk_live_abcdefghijklmnop1234"; (comment must be ignored)
                private String clientSecret = "s3cr3t-value-123";
            }
        '''))
        self.assertTrue({"tls-disabled", "unsafe-deserialization", "spel-injection", "insecure-random", "log-leak",
                         "command-exec", "weak-hash", "secret-literal"} <= ids, ids)
        self.assertNotIn("secret-shape", ids)

    def test_application_config(self):
        ids = self.ids("src/main/resources/application.yml", d('''
            spring:
              datasource:
                password: SuperSecret123
            management:
              endpoints:
                web:
                  exposure:
                    include: "*"
            server:
              error:
                include-stacktrace: always
        '''))
        self.assertEqual({"secret-literal", "actuator-exposed", "error-details-exposed"}, ids)

    def test_application_config_ok(self):
        ids = self.ids("src/main/resources/application.properties", d('''
            spring.datasource.password=${DB_PASSWORD}
            jwt.token-ttl=3600
            app.security.token-required=true
            management.endpoints.web.exposure.include=health,info,prometheus
        '''))
        self.assertEqual(set(), ids)


if __name__ == "__main__":
    unittest.main()
