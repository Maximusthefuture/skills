# agent-network-mcp — Implementation Plan

## 1. Goal

Build a local MCP server that allows multiple AI coding agents to collaborate on the same software development task.

Initial target clients:

- Qwen CLI
- Claude Code
- Codex CLI

The first implementation must support two independent agent processes.

The MCP server must coordinate:

1. DISCUSS
2. IMPLEMENT
3. SYNC
4. DONE

The most important design goal is to prevent agents from incorrectly manipulating the workflow.

### Core principle

The LLM must NOT control the workflow state machine.

The MCP server controls:

- current phase
- task state
- agreement
- assignments
- implementation status
- synchronization
- phase transitions
- events
- waiting

The LLM only performs work and uses a very small set of MCP tools.

---

# 2. MVP Constraints

Do NOT implement:

- SQLite
- PostgreSQL
- Redis
- Kafka
- HTTP API
- WebSocket
- Web UI
- GitHub integration
- GitLab integration
- cloud storage
- distributed deployment
- authentication
- authorization
- central LLM orchestrator

Use only:

- Node.js
- TypeScript
- `@modelcontextprotocol/sdk`
- Zod
- Vitest
- Node.js filesystem APIs

Transport:

- stdio

Persistence:

- filesystem

---

# 3. Repository Structure

Create:

```text
agent-network-mcp/
├── src/
│   ├── index.ts
│   │
│   ├── mcp/
│   │   ├── server.ts
│   │   ├── tools.ts
│   │   └── instructions.ts
│   │
│   ├── domain/
│   │   ├── agent.ts
│   │   ├── task.ts
│   │   ├── agreement.ts
│   │   ├── implementation.ts
│   │   ├── sync.ts
│   │   ├── message.ts
│   │   └── event.ts
│   │
│   ├── services/
│   │   ├── AgentManager.ts
│   │   ├── TaskManager.ts
│   │   ├── AgreementManager.ts
│   │   ├── PhaseManager.ts
│   │   ├── ImplementationManager.ts
│   │   ├── SyncManager.ts
│   │   └── EventManager.ts
│   │
│   ├── storage/
│   │   ├── FileStore.ts
│   │   ├── AgentStore.ts
│   │   ├── TaskStore.ts
│   │   ├── MessageStore.ts
│   │   └── EventStore.ts
│   │
│   └── validation/
│       └── schemas.ts
│
├── tests/
│   ├── storage/
│   ├── services/
│   ├── mcp/
│   └── integration/
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
└── .gitignore
```

---

# 4. Environment Configuration

Agent identity MUST come from environment variables.

Required:

```text
AGENT_ID
NETWORK_DIR
```

Optional:

```text
AGENT_TYPE
AGENT_ROLE
```

Example:

```text
AGENT_ID=backend
AGENT_TYPE=qwen
AGENT_ROLE=backend
NETWORK_DIR=/path/to/project/.agent-network
```

Never allow the caller to provide `from`, `agentId`, or equivalent identity fields in MCP tool arguments.

The MCP server must derive the current agent from `AGENT_ID`.

---

# 5. Filesystem Layout

Use:

```text
.agent-network/
├── network.json
├── agents/
│   ├── backend.json
│   └── reviewer.json
│
└── tasks/
    └── task-001/
        ├── task.json
        ├── agreement.json
        │
        ├── implementations/
        │   ├── backend.json
        │   └── reviewer.json
        │
        ├── sync/
        │   ├── sync-001.json
        │   └── sync-002.json
        │
        ├── messages/
        │   ├── msg-001.json
        │   └── msg-002.json
        │
        └── events/
            ├── event-001.json
            └── event-002.json
```

Add:

```gitignore
.agent-network/
```

---

# 6. FileStore

Implement a generic filesystem storage abstraction.

Responsibilities:

- read JSON
- write JSON
- update JSON
- list files
- atomic writes
- path validation

Every write must be atomic.

Use:

```text
temporary file
    ↓
fs.rename()
```

Do not directly overwrite important state files.

Protect against:

- `../`
- absolute paths
- Windows path traversal
- invalid IDs
- writing outside `NETWORK_DIR`

All paths must be resolved and verified to remain inside `NETWORK_DIR`.

---

# 7. Domain Models

## Agent

```ts
interface Agent {
    id: string;
    type: string;
    role?: string;

    status:
        | "ONLINE"
        | "WORKING"
        | "WAITING"
        | "OFFLINE";

    registeredAt: string;
    lastSeenAt: string;
}
```

## Task

```ts
type Phase =
    | "DISCUSS"
    | "IMPLEMENT"
    | "SYNC"
    | "DONE";

interface Task {
    id: string;
    title: string;
    description: string;
    phase: Phase;
    status: "ACTIVE" | "COMPLETED";
    agents: string[];
    createdAt: string;
    updatedAt: string;
}
```

## Agreement

```ts
interface Agreement {
    taskId: string;
    summary: string;

    assignments: {
        agentId: string;
        responsibility: string;
    }[];

    decisions: string[];
    interfaces: string[];

    approvedBy: string[];

    createdAt: string;
    updatedAt: string;
}
```

## Implementation

```ts
interface Implementation {
    taskId: string;
    agentId: string;

    status:
        | "IN_PROGRESS"
        | "READY_FOR_SYNC";

    summary: string;
    filesChanged: string[];

    completedAt?: string;
}
```

## SyncReport

```ts
interface SyncReport {
    id: string;
    taskId: string;
    agentId: string;

    status:
        | "PASS"
        | "NEEDS_FIX";

    findings: {
        severity:
            | "INFO"
            | "WARNING"
            | "ERROR";

        description: string;
        relatedAgent?: string;
        files?: string[];
    }[];

    createdAt: string;
}
```

## Message

```ts
interface Message {
    id: string;
    taskId: string;

    from: string;
    to: string;

    content: string;

    createdAt: string;
    readAt?: string;
}
```

## Event

```ts
interface Event {
    id: string;
    type: string;

    taskId?: string;
    targetAgent?: string;

    payload: unknown;

    createdAt: string;
}
```

---

# 8. State Machine

Implement a single `PhaseManager`.

Allowed transitions:

```text
DISCUSS
   │
   │ agreement ready
   ▼
IMPLEMENT
   │
   │ all implementations READY_FOR_SYNC
   ▼
SYNC
   │
   ├── NEEDS_FIX ──────► IMPLEMENT
   │
   └── all PASS ───────► DONE
```

Forbidden transitions include:

```text
DISCUSS → DONE
DISCUSS → SYNC
IMPLEMENT → DONE
IMPLEMENT → DISCUSS
SYNC → DISCUSS
```

The LLM must never be able to explicitly set the phase.

There must be no MCP tool:

```text
change_phase
set_phase
force_sync
force_complete
```

---

# 9. Agreement Rules

DISCUSS can transition to IMPLEMENT only when:

1. Agreement exists.
2. Every participating agent has an assignment.
3. Every required agent has approved the agreement.
4. Agreement contains enough information to begin implementation.

Example:

```json
{
    "assignments": [
        {
            "agentId": "backend",
            "responsibility": "Implement authentication API"
        },
        {
            "agentId": "reviewer",
            "responsibility": "Implement validation"
        }
    ]
}
```

If not ready, return an actionable error.

Example:

```json
{
    "error": "AGREEMENT_NOT_READY",
    "message": "Waiting for reviewer approval.",
    "pending": ["reviewer"],
    "nextAction": "wait"
}
```

---

# 10. Implementation Rules

An agent may only complete implementation if:

1. Current phase is IMPLEMENT.
2. Agent has an assignment.
3. Agent is completing its own assignment.

Completion changes its implementation status to:

```text
READY_FOR_SYNC
```

The MCP automatically checks all participating agents.

If all are ready:

```text
IMPLEMENT → SYNC
```

No explicit phase-change call is needed.

---

# 11. Sync Rules

During SYNC, agents inspect:

- other agents' implementation
- shared interfaces
- agreement
- changed files
- integration compatibility

An agent can report:

```text
PASS
```

or:

```text
NEEDS_FIX
```

Example:

```json
{
    "status": "NEEDS_FIX",
    "findings": [
        {
            "severity": "ERROR",
            "description": "API response does not match agreed contract.",
            "relatedAgent": "backend",
            "files": [
                "src/auth/AuthController.java"
            ]
        }
    ]
}
```

If at least one required sync report is `NEEDS_FIX`:

```text
SYNC → IMPLEMENT
```

If all required agents report `PASS`:

```text
SYNC → DONE
```

---

# 12. MCP Tool API

Expose exactly five tools.

Do not add more tools unless there is a demonstrated problem that cannot be solved with these five.

## Tool 1: `swarm_context`

Purpose:

Return everything the agent needs to decide what to do next.

Example response:

```json
{
    "task": {
        "id": "task-001",
        "title": "Authentication",
        "phase": "IMPLEMENT",
        "status": "ACTIVE"
    },

    "agent": {
        "id": "backend",
        "role": "backend"
    },

    "assignment": {
        "responsibility": "Implement authentication API"
    },

    "otherAgents": [
        {
            "id": "reviewer",
            "role": "reviewer",
            "status": "WORKING"
        }
    ],

    "pendingMessages": [],

    "agreement": {
        "summary": "...",
        "decisions": [],
        "interfaces": []
    },

    "implementation": {
        "status": "IN_PROGRESS"
    },

    "allowedActions": [
        "send_message",
        "complete",
        "wait"
    ],

    "nextAction": "IMPLEMENT"
}
```

This tool should be safe to call at any time.

---

# 13. Tool 2: `send_message`

Schema:

```ts
{
    to: string;
    message: string;
}
```

Do NOT accept:

```text
from
agentId
createdAt
messageId
phase
```

MCP derives all metadata.

Validate:

- recipient exists
- recipient is part of task
- message is not empty

Create a message file.

Create:

```text
MESSAGE_CREATED
```

event.

---

# 14. Tool 3: `propose`

Schema:

```ts
{
    content: string;
}
```

Only valid during DISCUSS.

The MCP must associate the proposal with the current agent.

The proposal may update the agreement.

If called during another phase:

```json
{
    "error": "INVALID_PHASE",
    "message": "propose is only available during DISCUSS.",
    "phase": "IMPLEMENT",
    "nextAction": "implement"
}
```

---

# 15. Tool 4: `complete`

This tool intentionally has phase-dependent semantics.

## DISCUSS

```text
complete()
```

means:

```text
approve current agreement
```

## IMPLEMENT

```json
{
    "result": "Implemented authentication API",
    "filesChanged": [
        "src/auth/AuthController.java"
    ]
}
```

means:

```text
READY_FOR_SYNC
```

## SYNC

```json
{
    "status": "PASS"
}
```

or:

```json
{
    "status": "NEEDS_FIX",
    "findings": [...]
}
```

The MCP decides what this means based on the current phase.

The tool must reject invalid arguments for the current phase.

---

# 16. Tool 5: `wait`

Purpose:

Allow the agent to stop consuming tokens while there is nothing useful to do.

Behavior:

1. Check filesystem for relevant events/messages.
2. If an event exists, return immediately.
3. Otherwise register a waiter.
4. Wait for filesystem changes.
5. Re-read state.
6. Return relevant event/context.

Use `fs.watch()` as the wake-up mechanism.

The filesystem remains the source of truth.

Never rely on watcher state for correctness.

---

# 17. Agent Instructions

Expose MCP instructions similar to:

```text
You are participating in a multi-agent software development task.

IMPORTANT RULES:

1. Always call swarm_context before deciding what to do.
2. Never assume the current phase.
3. Never attempt to change the phase manually.
4. Only perform actions allowed by swarm_context.
5. During DISCUSS, do not implement code.
6. During IMPLEMENT, work only on your assignment.
7. During SYNC, inspect other agents' work.
8. If you have nothing useful to do, call wait().
9. Do not continuously poll.
10. Do not fabricate information about other agents.
11. Use send_message when coordination is required.
12. Use complete only when the current phase allows it.
13. After completing an action, call swarm_context again.
```

---

# 18. Error Design

MCP errors must be designed for LLM consumption.

Bad:

```text
Error: invalid state transition
```

Good:

```json
{
    "error": "INVALID_PHASE",
    "message": "Implementation cannot be completed during DISCUSS.",
    "currentPhase": "DISCUSS",
    "nextAction": "discuss"
}
```

Every recoverable tool error should contain:

```text
error
message
current state
nextAction
```

Where relevant also include:

```text
pending
allowedActions
```

---

# 19. Event System

Implement these event types:

```text
AGENT_REGISTERED
MESSAGE_CREATED

AGREEMENT_UPDATED
AGREEMENT_APPROVED

PHASE_CHANGED

IMPLEMENTATION_STARTED
IMPLEMENTATION_COMPLETED

SYNC_REQUIRED
SYNC_REPORT_CREATED

TASK_COMPLETED
```

Each event must be an individual file.

Do not maintain one global mutable `events.json`.

---

# 20. Agent Waiting

Implement a shared event/wait mechanism.

Concept:

```text
Agent
  │
  │ wait()
  ▼
MCP
  │
  ├── event exists ──► return
  │
  └── no event
          │
          ▼
       fs.watch
          │
          ▼
      filesystem changed
          │
          ▼
      re-read state
          │
          ▼
       return event
```

Support timeout.

Example:

```json
{
    "status": "TIMEOUT",
    "nextAction": "wait"
}
```

---

# 21. Concurrency

Assume multiple MCP processes may write to the same network directory.

Avoid shared mutable files wherever possible.

Prefer:

```text
messages/msg-UUID.json
events/event-UUID.json
sync/sync-UUID.json
```

over:

```text
messages.json
events.json
sync.json
```

Use atomic file creation/writes.

Generated IDs must be unique.

Do not rely on in-memory state for correctness.

---

# 22. Crash Recovery

The server must be stateless with respect to persistent workflow state.

After:

```text
MCP process killed
```

and:

```text
MCP process restarted
```

it must reconstruct all state from:

```text
.agent-network/
```

Test:

1. create task
2. send messages
3. approve agreement
4. change phase
5. kill MCP
6. restart MCP
7. call swarm_context
8. verify identical state

---

# 23. Unit Tests

Implement tests for:

## FileStore

- read
- write
- atomic write
- invalid path
- path traversal
- malformed JSON

## AgentManager

- register
- duplicate registration
- status update
- lastSeen

## TaskManager

- create task
- load task
- invalid task

## AgreementManager

- proposal
- approval
- incomplete agreement
- all agents approved

## PhaseManager

Test valid transitions:

```text
DISCUSS → IMPLEMENT
IMPLEMENT → SYNC
SYNC → IMPLEMENT
SYNC → DONE
```

Test invalid transitions.

## MessageManager

- create message
- recipient validation
- unique IDs
- message persistence

## EventManager

- create event
- read event
- target agent
- event persistence

---

# 24. MCP Tool Tests

Test every tool independently.

### swarm_context

Test:

- DISCUSS
- IMPLEMENT
- SYNC
- DONE
- pending messages
- assignments
- allowedActions

### send_message

Test:

- valid recipient
- invalid recipient
- empty message
- identity comes from environment

### propose

Test:

- valid DISCUSS
- invalid IMPLEMENT
- invalid SYNC

### complete

Test:

- DISCUSS approval
- IMPLEMENT completion
- SYNC PASS
- SYNC NEEDS_FIX
- invalid phase

### wait

Test:

- immediate event
- filesystem event
- timeout
- restart recovery

---

# 25. Integration Test

Create two agents:

```text
backend
reviewer
```

Workflow:

```text
1. backend registers
2. reviewer registers

3. create task

4. DISCUSS

5. backend calls propose()

6. reviewer receives message/event

7. reviewer approves

8. backend approves

9. MCP automatically transitions to IMPLEMENT

10. backend implements assignment

11. reviewer implements assignment

12. MCP automatically transitions to SYNC

13. reviewer finds incompatibility

14. reviewer submits NEEDS_FIX

15. MCP automatically transitions to IMPLEMENT

16. backend fixes issue

17. implementations become READY_FOR_SYNC

18. MCP automatically transitions to SYNC

19. backend PASS

20. reviewer PASS

21. MCP automatically transitions to DONE
```

---

# 26. Tool Misuse Test

This test is especially important.

Simulate agents performing incorrect actions:

```text
complete during DISCUSS without agreement
propose during IMPLEMENT
propose during SYNC
complete without assignment
send message to nonexistent agent
send message to unrelated task
wait when action is required
complete SYNC without findings/status
attempt invalid phase transition
```

Expected behavior:

- MCP never corrupts state.
- MCP returns actionable errors.
- Agent can recover using `swarm_context()`.

---

# 27. Real Qwen CLI Test

Create two Qwen CLI instances.

Example configuration:

```json
{
    "mcpServers": {
        "agent-network": {
            "command": "node",
            "args": [
                "/path/to/agent-network-mcp/dist/index.js"
            ],
            "env": {
                "AGENT_ID": "backend",
                "AGENT_TYPE": "qwen",
                "AGENT_ROLE": "backend",
                "NETWORK_DIR": "/path/to/project/.agent-network"
            }
        }
    }
}
```

Second process:

```text
AGENT_ID=reviewer
AGENT_ROLE=reviewer
```

Both must use the same:

```text
NETWORK_DIR
```

---

# 28. First Real Task

Do NOT test with a large project.

Use a tiny task:

```text
Implement a REST endpoint for user registration.

backend:
- implement REST controller
- implement service

reviewer:
- define validation
- inspect backend implementation
```

The purpose is to verify:

- tool usage
- communication
- state transitions
- waiting
- sync
- recovery

not coding complexity.

---

# 29. Acceptance Criteria

The MVP is complete only when all of these are true:

### Architecture

- [ ] filesystem is the source of truth
- [ ] no database
- [ ] no external infrastructure
- [ ] MCP controls workflow state
- [ ] LLM cannot directly change phase

### Tools

- [ ] `swarm_context`
- [ ] `send_message`
- [ ] `propose`
- [ ] `complete`
- [ ] `wait`

### Workflow

- [ ] DISCUSS works
- [ ] agreement works
- [ ] assignments work
- [ ] IMPLEMENT works
- [ ] SYNC works
- [ ] NEEDS_FIX works
- [ ] repeated IMPLEMENT/SYNC works
- [ ] DONE works

### Reliability

- [ ] atomic writes
- [ ] path traversal protection
- [ ] concurrent message creation
- [ ] crash recovery
- [ ] watcher restart recovery

### Agent usability

- [ ] every tool has simple schemas
- [ ] errors contain `nextAction`
- [ ] context contains `allowedActions`
- [ ] agent instructions are explicit
- [ ] agent does not need to understand internal state machine

### Testing

- [ ] unit tests
- [ ] MCP tool tests
- [ ] integration tests
- [ ] misuse tests
- [ ] crash recovery test
- [ ] real Qwen CLI test

---

# 30. Implementation Order

Implement strictly in this order:

```text
1. Project setup
       ↓
2. FileStore
       ↓
3. Domain models + Zod schemas
       ↓
4. AgentManager
       ↓
5. TaskManager
       ↓
6. AgreementManager
       ↓
7. PhaseManager
       ↓
8. ImplementationManager
       ↓
9. SyncManager
       ↓
10. MessageStore
       ↓
11. EventManager
       ↓
12. swarm_context
       ↓
13. send_message
       ↓
14. propose
       ↓
15. complete
       ↓
16. wait
       ↓
17. filesystem watcher
       ↓
18. unit tests
       ↓
19. MCP integration tests
       ↓
20. crash recovery
       ↓
21. tool misuse tests
       ↓
22. two-process test
       ↓
23. real Qwen CLI test
```

Do not implement the UI before step 23 succeeds.

---

# 31. Final Design Principle

The MCP server should be intentionally restrictive.

The ideal agent experience is:

```text
swarm_context()
      ↓
"What should I do?"
      ↓
MCP tells the agent exactly what is allowed
      ↓
agent performs one meaningful action
      ↓
complete() / send_message() / propose()
      ↓
swarm_context()
      ↓
wait() if blocked
```

The agent should never need to reason about:

```text
phase transitions
distributed state
event persistence
other agents' lifecycle
synchronization state
```

Those are MCP responsibilities.

The first MVP should optimize for:

**predictability > flexibility**

**simple tools > many tools**

**deterministic state machine > LLM orchestration**

**filesystem persistence > infrastructure**

**actionable errors > generic exceptions**