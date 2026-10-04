# VERIFY RED: what counts as the right failure

**Open when:** a new test failed and you need to tell whether it is RED or an error to fix first.

A correct RED is **a failure for the expected reason: the needed behavior does not exist yet.** Almost always it is an assertion failure: `AssertionFailedError`, `expected: 409 but was: 201`, `Expecting actual not to be empty`. Everything else, except one case in the table, is not RED but an error to remove before moving on:

| What you see | Not RED because | What to do |
|---|---|---|
| `cannot find symbol`, a compilation error | the test did not run | create a stub: a class/method with the needed signature, body `throw new UnsupportedOperationException()` or a default return value. Then run again |
| `UnsupportedOperationException` from the stub | a failure before the behavior is checked | acceptable as an intermediate step, but a stub returning `null`/`0`/empty is better — then the assertion fails and you see that it checks the value |
| `NoSuchBeanDefinitionException`, `Failed to load ApplicationContext` | the context did not start | fix the test configuration or pick a lower level |
| `Could not find a valid Docker environment` | Testcontainers did not start | Docker is unavailable — tell the user; do not pass it off as RED, do not replace Postgres with H2 or the Kafka container with `@EmbeddedKafka` |
| `ConditionTimeoutException` from Awaitility in a `@KafkaListener` test, and the log shows no trace of the listener receiving the record | the record did not reach the listener: `auto-offset-reset=latest`, another topic or group, a deserialization error | set `spring.kafka.consumer.auto-offset-reset=earliest`, check the topic and the log (`DeserializationException`, `ListenerExecutionFailedException`). RED is only a timeout after the listener stub received the record |
| 401/403 instead of the expected status | a failure in the security chain (CSRF, no authentication), not in the rule under test | add `@WithMockUser`/`jwt()`/`csrf()` so the test reaches the logic under test |
| 400 from JSON parsing instead of 400 from validation | a failure in the wrong check | fix the request body |
| An exception from the code under test that shows exactly the missing behavior (e.g. MockMvc rethrows an unhandled `EmailTakenException` because there is no handler yet) | this is **an acceptable RED**: the reason matters, not the failure type | make sure the exception is exactly the one you expected; any other is an error |
| The test is **green** right away | it checks behavior that already exists, or nothing | see below |

**The test is green right away?** In modes A and B this means the test does not check the new behavior: it already exists, the test checks a mock, or the assertion is a tautology. Rewrite the test. The exception is modes C and D, where a green test is expected, but they have their own proof: breaking the code.
