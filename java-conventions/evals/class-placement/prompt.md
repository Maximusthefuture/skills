---
tags: [skill-creator]
max_turns: 40
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

добавь консьюмер кафки на топик payment-completed: приходит {orderId, paymentId, paidAt}, заказ надо перевести в PAID (если он NEW, иначе игнор). имя топика и group id вынеси в настройки

Input files: pom.xml, src/, target/
