---
name: java-extensibility-review
description: "Extensibility review of Java / Spring Boot code: what has to change when one more variant is added. Finds switch and if/else on type, status or string, instanceof chains, repeated branching on an enum, god services, constructors with many parameters — and using a catalog of the 22 GoF patterns and Java/Spring idioms (Map<String, Bean>, enum with behavior, sealed + switch, Specification) picks a pattern with before/after code and an honest estimate of whether it pays off. Runs in a separate context: pass the scope in the arguments — paths to classes or a package, a diff range or the code itself. Use on «много if else», «как убрать switch», «сделай расширяемым», «какой паттерн подходит», «вынести в стратегию», «ревью архитектуры класса», too many if/else, which pattern fits, design patterns, Open-Closed, replace conditional with polymorphism, /java-extensibility-review. Bugs and security — java-code-review."
context: fork
agent: general-purpose
background: false
compatibility: Claude Code. Serena MCP is recommended (semantic navigation and symbol-level edits); without it — Grep / Glob / Read. git — optional (diff review and change history).
---

# Java Extensibility Review — pattern orchestrator

A review of Java / Spring Boot code with one question: **what has to change when one more variant is added** (a payment method, document type, status, notification channel, provider, rule)? If the answer is "find and edit N places in existing classes", it is a refactoring candidate. If it is "add one class, bean or config line", the code is already extensible.

The task is to find **a few places where a pattern really pays off**, and to show exactly how. There is no need to put patterns everywhere. An unneeded pattern is a defect too: an interface and three classes instead of a clear 3-branch `switch` make the code worse.

## Running in a separate context

The skill runs in a separate subagent (`context: fork`) and does not see the conversation it was called from. Take the scope from the arguments: paths to files or a package, a diff range, pasted code. If the arguments have no path, no code and no range, return one line `NEEDS_CONTEXT: give the scope — paths to classes or a package, a diff range or code` and stop.

The answer goes to the caller in full, so it is the report of step 6: at most 80 lines, before/after code only for "Recommend" items, and brief. `--fix` mode only if it is in the arguments; then at the end list the changed files and the verification commands you ran.

## How the skill is organized

This file is the orchestrator. It describes the workflow and the **applicability catalog**: by which signs in the code each pattern is recognized and where its detailed description lives. Everything else is in `references/<group>/<pattern>.md`. For the 22 GoF patterns these have the essence, the structure (participants and their roles with a diagram), signs in Java/Spring code, when not to apply, before/after code, refactoring steps, pitfalls, pros and cons, related patterns. The files are self-contained; no external sources are needed.

Open a reference only for patterns whose signs you found in the code. Usually that is 1–4 files per review. Do not read the whole catalog: it burns context and pushes you to "find a use" for every pattern.

```
references/
  creational/   factory-method, abstract-factory, builder, prototype, singleton
  structural/   adapter, bridge, composite, decorator, facade, flyweight, proxy
  behavioral/   chain-of-responsibility, command, iterator, mediator, memento,
                observer, state, strategy, template-method, visitor
  java-idioms/  map-lookup, enum-with-behavior, sealed-switch, specification,
                null-object, configuration-over-code, polymorphic-json
```

## Workflow

### 1. Determine the scope

| Request | Scope |
|---|---|
| pasted code / a file path | that file, plus the classes it calls and that call it |
| a package/module path | all `.java` in it except tests |
| "my changes", a branch, a PR | the changed `.java`: `git diff --name-only <base>...HEAD -- '*.java'` |
| no details, a big project | ask for the scope; for a small one take all of `src/main/java` |
| `--fix` | apply the recommendations after the report (step 7) |

### 2. Find candidates yourself — with Serena

You find the candidates, not a script. A regex finds a `switch`, but it will not tell whether knowledge of the variant repeats across the code, whether the branches have dependencies and whether a pattern pays off. That takes understanding the code, so work semantically and read only the symbols you need, not whole files.

If **Serena MCP** is connected (the `mcp__serena__*` tools), use it. If not — do the same with Grep / Glob / Read. Before the first Serena call make sure the project is activated (`activate_project`, `check_onboarding_performed`).

**2.1. A map of the scope — `get_symbols_overview`** for every file or package from step 1. Structural smells show on the symbol map before reading method bodies:
- class names are a Cartesian product of two axes (`EmailOrderNotification`, `SmsInvoiceNotification`) → Bridge;
- a family of similar classes (`CsvImporter`, `XlsxImporter`, `XmlImporter`) → Template Method or composition;
- `*Utils`/`*Helper`/`*Manager` classes with dozens of methods, services with 30+ methods → Command, Facade;
- `getInstance`, static `INSTANCE` fields → Singleton;
- the enums in the scope — write them down, you need them in 2.3;
- an interface with a single implementation — note it, it is a "leave as is" candidate or a sign of a leaking Adapter.

**2.2. Targeted search — `search_for_pattern`** (limit `relative_path` to the review scope, exclude tests). This is not a detector but a way to quickly find places worth opening:

| What we look for | Pattern (regex) | Where to look next |
|---|---|---|
| branching chains | `else\s+if\s*\(` | map-lookup, strategy, chain-of-responsibility |
| switch | `switch\s*\(` | map-lookup, strategy, enum-with-behavior, state |
| type checks | `instanceof\s+[A-Z]` | sealed-switch, visitor |
| comparing string keys | `\.equals(IgnoreCase)?\("\|"\w+"\.equals\(` | map-lookup, strategy |
| statuses | `setStatus\(\|getStatus\(\)\s*[!=]=` | state |
| creation in branches | `(->\|return)\s*new\s+[A-Z]` | factory-method |
| singletons and a locator | `getInstance\(\|static\s+\S+\s+INSTANCE\|\.getBean\(` | singleton |
| homemade retries and cache | `Thread\.sleep\|retry\|attempt\|ConcurrentHashMap<` | decorator |
| manual JSON parsing | `readTree\(\|get\("type"\)` | polymorphic-json |
| a dynamic query | `createQuery\(\|\+=\s*"\s*(and\|AND\|where)` | specification |
| null checks of dependencies | `required\s*=\s*false\|!=\s*null\)\s*\w+\.` | null-object |
| manual pagination | `nextPageToken\|hasNext\(\)\|nextPageable\(` | iterator |
| bean cycles | `@Lazy\|allow-circular-references` | mediator |

`\|` in the table is Markdown escaping. Write `|` in the pattern itself.

**2.3. The main signal — where each variant is used (`find_referencing_symbols`).** For every enum or discriminator type from 2.1 (`PaymentType`, `OrderStatus`, `Channel`) find its references. If a `switch`/`if` on it appears in **two or more classes**, the knowledge of the variant is smeared across the code. That is the strongest argument for Strategy, an enum with behavior or Abstract Factory, stronger than the length of one `switch`. Check interfaces the same way: how many implementations they have and where they are chosen.

**2.4. Reading candidates — `find_symbol` with `include_body=true`** only for the methods and constructors that came up in 2.1–2.3. While reading the body, answer:
- Branches return values → map-lookup or an enum. Branches are logic with different beans → strategy. Conditions more complex than equality → chain-of-responsibility.
- How many dependencies does the constructor have, and are all needed in every call? 6+ dependencies of which one is used per type → strategy. A tail of side calls after `save()` → observer.
- A long parameter list or boolean flags → builder.
- Cache, retries, metrics mixed with the logic → decorator.

**2.5. Calling code — `find_referencing_symbols`** for a candidate method: how many places call it and how. You need this to estimate the cost of the refactoring and not to propose a breaking signature change.

Without Serena: Glob for `**/*.java` in the scope, Grep with the same patterns, `grep -rn "PaymentType\." src/main/java` instead of reference search, Read only the needed line ranges.

What not to do: do not read every file in full and do not turn the pattern table into a checklist "found a match — so it is a remark". A pattern match is a reason to open the code, not a finding.

### 3. Match the signs against the catalog

Start with the quick selection table, then check the candidate's applicability in the catalog. If two neighboring patterns fit, look at the "Often confused" table. Only then open the chosen pattern's reference.

### 4. Understand the context

- **Versions.** Java from `pom.xml`/`build.gradle`: `switch` expressions — since 14, `record` — since 16, sealed — since 17, pattern matching in `switch` — since 21. Spring Boot 2.x (`javax.*`) or 3.x (`jakarta.*`). Propose syntax the project can compile.
- **How often variants are added.** `git log --oneline -- <file> | head -20`, `git log -p -- <file>`. Branches added 5 times in a year are a strong argument. A switch untouched since 2019 is an argument to leave it.
- **How many places know about the variant.** The result of step 2.3 (`find_referencing_symbols` on the enum or type; without Serena — `grep -rn 'PaymentType\.\|"CARD"' src/main/java`). Edits in 1 place are normal, in 5 places — a problem.
- **Branch dependencies.** If branches use different beans, you need a Strategy over beans. If branches are pure calculations, a Map or an enum with behavior is enough.
- **Project conventions.** There already are `*Handler`, `*Strategy`, registries — propose doing the same, do not start a second mechanism. `CLAUDE.md` and neighboring classes are the source of truth.

### 5. Check whether it is worth it

For every candidate:

1. **The rule of three.** An abstraction pays off when there are ≥3 variants *and* they keep being added, or when one branching repeats in ≥2 places. 2–3 stable branches in one place — "leave as is".
2. **The axis of change.** New *types* are added more often — Strategy or polymorphism. New *operations* over a closed set of types are added more often — sealed + `switch` or Visitor. Getting the axis wrong makes the code worse.
3. **The gain in one sentence**, e.g.: "a new payment method is one `@Component`, existing files do not change". If the sentence does not come together, do not propose it.
4. **The cost.** Navigating N classes, implicit links through bean names, runtime errors instead of compile errors. The proposed option must close these risks: a key from an enum, a completeness check at startup, a clear error for an unknown key.
5. **Tests.** No tests on the current behavior — a characterization test is the first step of the recommendation.

Verdicts: **Recommend** (the axis of change is confirmed by history or repetition, the gain is clear) · **Could** (noticeably better but not urgent — do it the next time this code has to be touched) · **Leave as is** (looks like a candidate but will not pay off; mention it briefly so it is visible the place was looked at).

### 6. Write the report

Write in the user's language. Example code follows the project's style: Lombok or not, constructor injection, the same name suffixes.

```markdown
## Extensibility review: <what was looked at, e.g. "payments module, 23 files">

**Summary:** <1–2 sentences: the main extensibility problem and what the refactoring gives>

### 1. <title, e.g. "switch on PaymentType in 4 places"> — **Recommend**
**Where:** `PaymentService.java:58`, `RefundService.java:31`, `FeeCalculator.java:12`
**Now:** <what adding a new variant costs: "a new type = edits in 4 files, easy to forget one">
**Pattern:** <name> — <why it and not its neighbor from "Often confused">
**After:**
```java
// a minimal compilable sketch: the interface, one implementation, the registry/call site
```
**Gain:** <what "add a variant" means now>
**Cost/risks:** <what gets more complex and how that is covered>
**Steps:** <2–4 steps of a safe refactoring; the first is a test if there is none>

### 2. ... — **Could**

### Leave as is
- `StatusMapper.java:20` — a switch on 3 stable branches, unchanged for 2 years.

### What is already good
<1–2 sentences if there is a good extensible construct worth following>
```

Order the items by gain. Usually 1–5 items. If there are no good candidates, say so and list what you checked. That is a normal result.

Do not include: style; bugs and security (that is `java-code-review`'s job; something critical noticed along the way — one line at the end); abstractions "for the future" without signs of that future; a pattern for the sake of its name.

### 7. `--fix` mode

1. Take only the "Recommend" items (others — if the user named them explicitly).
2. No tests on the current behavior — first a characterization test, green on the old code.
3. Refactor in small steps without behavior change. The concrete steps are in the "Refactoring steps" section of the pattern's reference file. Keep the behavior for an unknown key or variant (or agree it explicitly with the user).
   With Serena edit by symbols, not line by line: `replace_symbol_body` — replace a method body (e.g. a `switch` with a registry call), `insert_after_symbol` — add a new class or method next to it, `rename_symbol` — a rename with references updated. Before changing a signature check all calls via `find_referencing_symbols`.
4. After every major step — build and module tests (`./mvnw -q test -pl <module>` / `./gradlew :<module>:test`). For bean registries add a test that the context starts and all enum values are covered.
5. Do not commit or push. Show `git diff` and list what is done and what is left.

---

## Quick selection by signs in the code

| Sign in the code | First candidate | Alternatives |
|---|---|---|
| `if/switch` on a string/enum, branches return a value | `java-idioms/map-lookup` | `java-idioms/enum-with-behavior` |
| `if/switch` on a type, branches are different logic with beans | `behavioral/strategy` | `creational/factory-method` (if branches do `new`) |
| One `switch` on an enum repeats in 2+ places | `behavioral/strategy` | `java-idioms/enum-with-behavior` |
| `instanceof` chains, a closed set of types | `java-idioms/sealed-switch` | `behavioral/visitor`, polymorphism |
| The behavior of many methods depends on a status; transition checks are smeared | `behavioral/state` | — |
| A long `validate()` / a sequence of handlers | `behavioral/chain-of-responsibility` | `structural/composite` (AND/OR rules) |
| After `save()` a tail of calls: mail, audit, analytics | `behavioral/observer` | `behavioral/mediator` |
| Services call each other in a circle, `@Lazy` against cycles | `behavioral/mediator` | `behavioral/observer` |
| `switch (action)` in a controller/consumer; operations must be queued, logged, retried | `behavioral/command` | — |
| The same algorithm "skeleton" in several classes | `behavioral/template-method` | `behavioral/strategy` (composing steps) |
| Manual pagination / tree traversal loops in several places | `behavioral/iterator` | — |
| Manual field backup and rollback, undo, "restore a version" | `behavioral/memento` | — |
| Cache/retries/metrics mixed with logic; `CachingRetryingClient` | `structural/decorator` | `structural/proxy` |
| Repeated access checks or lazy initialization at the start of methods | `structural/proxy` | `structural/decorator` |
| Provider SDK types in domain code | `structural/adapter` | `structural/facade` |
| The same orchestration of several subsystems in several places | `structural/facade` | `behavioral/mediator` |
| Class names are a Cartesian product (`EmailOrderNotification`, `SmsInvoiceNotification`) | `structural/bridge` | — |
| A tree: recursion with `instanceof Group / Item`, AND/OR rules, product bundles | `structural/composite` | `java-idioms/specification` |
| The profiler shows millions of identical immutable objects | `structural/flyweight` | — |
| `switch` branches create `new ConcreteX(...)`; beans passed into `new` by hand | `creational/factory-method` | `creational/abstract-factory` |
| Several `switch (provider/country)` choosing a matching client + mapper + validator | `creational/abstract-factory` | `behavioral/strategy` |
| A constructor/method with 5+ parameters, boolean flags | `creational/builder` | — |
| Manual field copying "make a copy of a tariff/template" | `creational/prototype` | — |
| `getInstance()`, `private static INSTANCE`, static access to the context | `creational/singleton` | → a plain Spring bean |
| `if (filter.x != null) query += …`, an explosion of `findByAAndBAndC` | `java-idioms/specification` | — |
| `if (x != null) x.do()`, empty `default -> {}` | `java-idioms/null-object` | — |
| Hardcoded tables (`if country == "DE" rate = 0.19`), `if (props.enabled)` flags | `java-idioms/configuration-over-code` | — |
| Manual parsing of a `type` field in JSON | `java-idioms/polymorphic-json` | — |

## Often confused

| Pair | How to tell them apart |
|---|---|
| Strategy ↔ State | A Strategy is chosen from outside (by request type) and does not know about other strategies. A State changes from inside over the object's life, and states know about transitions. |
| Strategy ↔ Template Method | Strategy is composition, a variant is substituted whole. Template Method is inheritance, individual steps of a fixed skeleton change. In doubt, choose composition. |
| Strategy ↔ Command | Strategy is *how* to do the same action. Command is *what* to do: a request as an object that can be queued, logged, retried. |
| Strategy ↔ sealed + switch / Visitor | Types are added — Strategy. Operations over a closed set of types are added — sealed + `switch` (Java 21) or Visitor (before 21). |
| Chain of Responsibility ↔ Decorator | A chain link may stop processing or not handle the request. A decorator always delegates further and only adds behavior. |
| Decorator ↔ Proxy | Both wrap an object with the same interface. A Decorator adds behavior and is assembled by the client in combinations. A Proxy controls access and lifecycle and is usually invisible to the client. |
| Adapter ↔ Facade | An Adapter turns *one* foreign interface into the needed one. A Facade simplifies working with *several* subsystems. |
| Adapter ↔ Bridge | An Adapter joins what already exists. A Bridge is laid down at design time so that two axes change independently. |
| Observer ↔ Mediator | The publisher in Observer does not know its subscribers. A Mediator knows the participants and coordinates them. |
| Factory Method ↔ Abstract Factory ↔ Builder | One object of the needed type — Factory Method. A consistent family of objects — Abstract Factory. One complex object step by step — Builder. |
| Composite ↔ Decorator | Composite is a tree of many children. Decorator is a chain of one nested object. |
| Memento ↔ Command (undo) | Memento stores a snapshot of state. Command stores an operation and can undo it. |

---

## Catalog: applicability and reference

Paths are relative to `references/` (add `.md`). A row gives applicability briefly. Detailed signs, code and risks are in the reference itself.

### Creational
| Pattern | Reference | Apply when | Do not apply when |
|---|---|---|---|
| Factory Method | `creational/factory-method` | `switch` branches do `new ConcreteX`, creation repeats; beans are passed into `new` by hand; unclear constructors → `of/from` | the objects are stateless (that is Strategy); there is one implementation |
| Abstract Factory | `creational/abstract-factory` | several `switch (provider/country)` choose a matching client + mapper + validator | one family per deployment (`@Profile`); a family of one object |
| Builder | `creational/builder` | 5+ parameters, telescoping constructors, boolean flags, assembly via setters | 2–4 required parameters → a constructor or a `record` |
| Prototype | `creational/prototype` | "duplicate a tariff/template", manual field copying, `clone()` | immutable objects; confusion with `@Scope("prototype")` |
| Singleton | `creational/singleton` | *find and remove:* `getInstance()`, `static INSTANCE`, a static `getBean` | libraries without DI, constants, stateless utilities |

### Structural
| Pattern | Reference | Apply when | Do not apply when |
|---|---|---|---|
| Adapter | `structural/adapter` | SDK types and exceptions in the domain; `if (provider == …)` with different clients; switching providers | one stable integration; an interface "just in case" |
| Bridge | `structural/bridge` | class names are a Cartesian product of two axes; a `switch` inside a `switch` | there is one axis of change (that is Strategy) |
| Composite | `structural/composite` | trees: AND/OR rules, bundles, categories; recursion with `instanceof Group/Item` | a flat structure or a small fixed depth |
| Decorator | `structural/decorator` | cache, retries, metrics mixed with logic; subclasses for combinations | `@Cacheable`/`@Retryable`/`@Observed` are enough |
| Facade | `structural/facade` | the same orchestration of subsystems or a complex library in several places | one-to-one method forwarding; a God facade |
| Flyweight | `structural/flyweight` | the profiler shows millions of identical immutable objects | no profiling data |
| Proxy | `structural/proxy` | repeated access checks, manual lazy initialization, hand-written HTTP clients | Spring AOP already provides it (`@PreAuthorize`, `@Lazy`, `@HttpExchange`) |

### Behavioral
| Pattern | Reference | Apply when | Do not apply when |
|---|---|---|---|
| Chain of Responsibility | `behavioral/chain-of-responsibility` | a long `validate()` of `if…throw`; choosing a handler by a complex condition; a pipeline of steps | simple field constraints → Bean Validation |
| Command | `behavioral/command` | `switch (action)` in an endpoint or consumer; operations must be queued, logged, retried, undone | 3–4 operations in a small service |
| Iterator | `behavioral/iterator` | copies of pagination loops (offset/cursor), `findAll()` on a big table, repeated tree traversal | plain in-memory collections |
| Mediator | `behavioral/mediator` | services call each other in a circle, `@Lazy` against cycles; a process without a single place | 2–3 participants with simple links |
| Memento | `behavioral/memento` | manual field backup and rollback; undo/redo; "restore a version" | a transaction gives the rollback; Envers is enough for audit |
| Observer | `behavioral/observer` | a tail of side effects after `save()`; a service depends on many unrelated services | the effect is a business invariant in the same transaction |
| State | `behavioral/state` | status transition checks are smeared; method behavior depends on the status | the status is just a label; an FSM engine without need |
| Strategy | `behavioral/strategy` | a `switch` on type with logic and beans in branches, repeated in several places; `Map<String, Bean>` | branches are pure calculations; 2–3 stable variants |
| Template Method | `behavioral/template-method` | a copied algorithm skeleton in several classes, the copies drift apart | steps combine in different ways → composition |
| Visitor | `behavioral/visitor` | operations over a stable hierarchy (AST, a document tree) on Java < 21 | Java 21+ (sealed + `switch`); types are added often |

### Java/Spring idioms (not GoF)
| Technique | Reference | Apply when |
|---|---|---|
| Map-lookup | `java-idioms/map-lookup` | branches only return a value or call a one-liner |
| Enum with behavior | `java-idioms/enum-with-behavior` | one `switch` on an enum in several places, branches without beans |
| sealed + switch | `java-idioms/sealed-switch` | `instanceof` chains, a closed set of types, operations are added |
| Specification | `java-idioms/specification` | `if (x != null) query += …`, an explosion of `findByAAndBAndC` |
| Null Object | `java-idioms/null-object` | `if (x != null)`, `required = false`, empty `default` |
| Configuration over code | `java-idioms/configuration-over-code` | hardcoded tables and thresholds, `if (props.enabled)` in several places |
| Polymorphic JSON | `java-idioms/polymorphic-json` | manual parsing of a `type` field in JSON |
