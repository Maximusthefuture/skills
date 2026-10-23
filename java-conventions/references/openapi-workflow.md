# OpenAPI workflow in detail

**Open when:** the change adds a new `*Api` interface, touches generator settings, the controller has no interface yet, or the user asks for an endpoint outside the spec.

## Reading the generator settings first

Look at the plugin configuration before editing — it decides names and packages:

| Setting | What it changes |
|---|---|
| `inputSpec` | where the spec is |
| `apiPackage`, `modelPackage` | packages of the generated interfaces and models — imports in the controller and mapper |
| `modelNameSuffix` (often `Dto`) | `Order` in the spec → `OrderDto` in Java |
| `useTags` | `true`: one interface per tag (`tags: [orders]` → `OrdersApi`); `false`: one per path prefix |
| `skipDefaultInterface` | `false` (default): methods are `default` returning 501 — a forgotten implementation compiles; `true`: abstract — the compiler finds it |
| `useSpringBoot3`, `useJakartaEe` | `jakarta.*` vs `javax.*` imports |
| `openApiNullable`, `useOptional` | whether optional fields are `JsonNullable<T>` / `Optional<T>` |

Do not change these settings as part of a feature: every setting renames or reshapes all generated classes. If one blocks the task, ask.

## Adding an operation

1. Add the path and operation to the spec. Give it an `operationId` — it becomes the Java method name; without it the generator invents one from the path.
2. Put request and response schemas in `components/schemas` and reference them with `$ref`. Inline schemas produce names like `GetOrder200Response`.
3. Describe the error responses the endpoint really returns (400, 404, 409 …) with the project's error schema.
4. Generate, read the interface, implement with `@Override` (SKILL.md, steps 2–5).
5. Tests call the endpoint by the path from the spec (`@WebMvcTest` + `MockMvc`), so a wrong mapping fails a test, not production.

## A new tag → a new interface

A new tag gives a new `*Api` interface. Create a new controller `<Tag>Controller implements <Tag>Api` in `controller/`. Do not add the second interface to an existing controller (`implements OrdersApi, RefundsApi`) — one controller per interface keeps them findable by name.

## Name clash between a model and an entity

The spec has `Order`, the entity is `Order`, and `modelNameSuffix` is not set — two classes with the same simple name.

1. Follow what the project already does (an entity named `OrderEntity`, or a suffix on models).
2. No precedent — ask the user which way; suggest `modelNameSuffix=Dto`, because it is set once and covers every future model.
3. Never solve it with fully qualified names in the code.

## Controllers without an interface

The project has old controllers with hand-written `@GetMapping`:

- do not migrate them unasked — that is a separate task with its own risk (paths, parameter names, response codes may differ from the spec);
- a **new** endpoint in such a controller still goes through the spec: describe it, generate, implement in a controller for the generated interface;
- an existing endpoint of the old controller gets a small change — change it in place and mention in the report that it is outside the spec.

## The user asks for an endpoint without the spec

Say once that it will be invisible to clients of the spec and that the generated interface will not catch signature drift, and ask whether to add it to the spec. They insist — do it with `@GetMapping` in a controller that does not implement an `*Api`, and record it in the report.

Actuator and infrastructure endpoints (`/actuator/**`, webhooks verified by a signature filter, if the project keeps them out of the spec) are not part of the public API — follow the project.

## Contract changes that break clients

Say so in the report, with the field and the client impact:

- renaming or removing a field, an operation or an enum value;
- making an optional field `required` in a request, or `nullable` in a response;
- changing a type or format (`integer` → `string`, `date-time` → `date`);
- changing a status code or a path.

Adding an optional request field, a new response field or a new operation is compatible.
