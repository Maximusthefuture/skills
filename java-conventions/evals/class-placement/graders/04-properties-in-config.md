---
type: llm
focus: trace
weight: 1
---

Topic name and group id are bound through a @ConfigurationProperties class located in com.acme.shop.config, with values in application.yml or application.properties; the listener reads them from that class (not from ${...} placeholders or @Value)
