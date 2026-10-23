---
type: llm
focus: trace
weight: 1
---

The 'only NEW can be cancelled' check lives in OrderService (not in the controller), and the 409 is produced by an exception in the exception package handled in GlobalExceptionHandler
