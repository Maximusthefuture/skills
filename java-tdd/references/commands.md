# Maven and Gradle commands

**Open when:** you need a command for one test, a class, an integration test or a module in a multi-module build.

Detect the build from the project root and use the wrapper (`./mvnw`, `./gradlew`), not a global installation. If `CLAUDE.md`/`CONTRIBUTING.md`/`README` describe their own commands — use those.

| What | Maven | Gradle |
|---|---|---|
| One test method | `./mvnw -q test -Dtest='FooServiceTest#rejectsX' -Dsurefire.failIfNoSpecifiedTests=false` | `./gradlew test --tests 'com.example.FooServiceTest.rejectsX'` |
| One class | `./mvnw -q test -Dtest=FooServiceTest -Dsurefire.failIfNoSpecifiedTests=false` | `./gradlew test --tests 'com.example.FooServiceTest'` |
| Integration test (Failsafe / a separate source set) | `./mvnw -q verify -Dit.test=FooIT` (also runs the module's unit tests) | `./gradlew integrationTest --tests 'com.example.FooIT'` |
| A module in multi-module | add `-pl <module> -am` | `./gradlew :<module>:test ...` |
| The full suite | `./mvnw verify` | `./gradlew check` |

Do not change sources while a build is running in the same working copy.
