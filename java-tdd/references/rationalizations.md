# Excuses and dead ends

**Open when:** you catch yourself wanting to skip a test or RED, or do not understand how to test something.

## Common excuses

| Excuse | In reality |
|---|---|
| "Too simple to test" | Simple code breaks too, and a test for a simple rule takes a minute. The exception is code without behavior (a getter, a pass-through), not "simple" code. |
| "I'll write the tests later" | A test written afterwards passes right away and proves nothing: you have not seen it catch a breakage. If the code already exists — see "If the code was written before the test". |
| "Tests after are the same thing, the spirit matters" | A test after answers "what does this code do", a test before — "what should it do". A test after checks the cases you remembered while writing the code, not the ones you would have discovered. |
| "I already checked by hand / with Postman" | A manual check is not reproducible, does not cover edge cases and does not guard against regression. |
| "It's easier to mock the repository" | A repository mock does not check SQL, constraints and the transaction. Write `@DataJpaTest` with Testcontainers. |
| "Testcontainers are slow, I'll use H2" | H2 lies about the dialect, types, locks and constraints. A green H2 says nothing about production. |
| "Docker won't start — I'll use `@EmbeddedKafka`" | The project chooses the infrastructure, not the environment. The project uses Testcontainers — say Docker is unavailable and name the tests that did not run in the report. |
| "I'll mock `KafkaTemplate` / call the listener method directly" | That does not check serialization, listener configuration, the error handler and the DLT. The broker in the test is real in both options — Testcontainers and `@EmbeddedKafka`. |
| "The test is hard to write" | Hard to test means hard to use. Listen to the test: simplify the interface, extract a dependency, inject a `Clock`. |
| "I need to explore first" | You may. Then throw the spike away and write through the cycle. |
| "The test failed — I'll adjust the expectation to the code" | If the expectation was wrong, that is a return to RED, and the test must fail again without the implementation. If it was right — fix the code. |

## When stuck

| Problem | What to do |
|---|---|
| You do not know how to test it | Write the desired API call and the assertion first; the rest follows. Or ask the user. |
| The test is too complex | The design is complex. Simplify the interface, split the class. |
| You have to mock everything | The coupling is too strong. Inject dependencies through the constructor, extract a port. |
| Huge setup | Extract a test data builder / fixture. Still huge — simplify the design. |
| You need access to private state | Check through public behavior or an observable effect (DB, event, HTTP response). |
