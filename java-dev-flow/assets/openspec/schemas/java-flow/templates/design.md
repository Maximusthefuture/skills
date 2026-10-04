# Design

## Context

<!-- Component type (endpoint, consumer, job, client), where it lives, expected load and latency budget. The motivation is in proposal.md, do not repeat it. -->

## Goals / Non-Goals

**Goals:**
<!-- What this design achieves -->

**Non-Goals:**
<!-- What is explicitly out of scope -->

## Decisions

### Data and invariants
<!-- Entities and relations; invariants → constraints (NOT NULL, UNIQUE, CHECK, FK); whether a changeset is needed and which -->

### Transaction boundary and build order
<!-- Where the transaction starts and ends. Slice order: changeset → entity and repository → service → controller or listener → error mapping → metrics -->

### Errors
<!-- Error → HTTP status / code / behavior; what happens when an external system fails -->

### Authorization
<!-- Who calls, which permission, how row access is limited (owner, tenant, RLS) -->

### Retries and concurrency
<!-- Idempotency key / deduplication / @Version / lock / outbox -->

### Observability
<!-- Logs at the boundary, metrics, health -->

### Extensibility
<!-- Only if the change adds a variant to an existing set: the java-extensibility-review verdict (leave as is / preparatory refactoring) and why. Otherwise delete the subsection. -->

## Risks / Trade-offs

<!-- [Risk] → mitigation -->

## Migration Plan

<!-- Changesets per migration-safety (CONCURRENTLY, NOT VALID, expand/contract), deploy order, rollback. Delete the section if the schema does not change. -->

## Open Questions

<!-- Only what can be decided later without changing specs, the approach and tasks. Delete the section if there are no questions. -->
