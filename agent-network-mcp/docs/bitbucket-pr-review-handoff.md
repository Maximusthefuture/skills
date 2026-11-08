# Bitbucket PR review: handoff for the next agent

## Current state

The PR review page is a demo in the Agent Network UI. The provider boundary is in `src/bitbucket/provider.ts`; `MockBitbucketProvider` supplies one repository, one PR, one diff and commit-pinned file content. The page and routes are in `src/ui/page2.ts` and `src/ui/server.ts`.

The page can select a repository, PR and runner names, show a diff, return a clearly labelled mock finding, and show an expandable, persisted review history. Review records are stored in the current project's network as `bitbucket-reviews.json`. A new record starts as `running`; the operator must manually select `completed` or `failed` in the expanded record. Do not reintroduce automatic completion.

The review POST and history GET/status APIs are currently mock-backed. Selecting runner checkboxes does **not** start those agents. The PR list and finding are fixtures, not Bitbucket data. README now states these limitations.

## Goal for the next implementation

Replace the mock path with real, read-only Bitbucket access and actual independent review sessions, while keeping the existing provider/UI boundary and operator-controlled status. Keep history records and findings available after refresh. Never publish comments to Bitbucket or execute PR code unless the user explicitly changes that scope.

## Implementation steps

1. Inspect the target Bitbucket MCP server's real tool names, input schemas and response shapes. Do not guess them. Implement a real `BitbucketProvider` adapter for repository listing, PR listing/details, diff retrieval and file reads pinned to the PR's source/target commits. Keep those server-specific details out of the UI.
2. Replace fixture data with the adapter while preserving the provider interface. Handle pagination, permission failures, missing or truncated diffs, binary files, renames and PR SHA changes. Keep credentials server-side and out of browser responses and logs.
3. Replace the mock finding with one independent, read-only review session per selected runner. Give each reviewer the same immutable PR snapshot and allow file reads only through the provider. Do not provide shell, write, merge, comment-publishing or other side-effect tools. Persist per-runner progress, findings, errors and the snapshot SHAs.
4. Preserve the manual status control. Starting analysis may set the record to `running`; only the operator's selection sets `completed` or `failed`. Distinguish analysis completion from the operator's review status if both states need to be represented.
5. Expand the tests in `test/unit/bitbucketReview.test.ts` for provider contract mapping, pagination/errors, immutable SHAs, review lifecycle, status changes, persisted findings and partial reviewer failures. Run `npm run typecheck`, the focused test and the broader test suite; report unrelated environment failures separately.

## User decisions already made

- Support Bitbucket Cloud and Data Center through a replaceable provider interface; start with MCP. Direct REST implementations are not part of v1.
- Let the operator choose a repository/PR and start a review manually.
- Review results stay in this UI; do not post comments to Bitbucket.
- Multiple selected agents independently review the full PR.
- Give reviewers PR files through the provider at pinned commits; do not create a local checkout or run PR code.
- Highlight agent findings in the UI. Do not invent independent risk heuristics.
- Keep the completed status operator-controlled.
- The concrete MCP server remains unselected; verify its capabilities before implementing the adapter.

## Working constraints

The user explicitly asked to avoid the agent-network MCP for implementation and requested direct work. Follow that preference. A temporary runner configuration was used to launch two Codex test runners; it lives under the OS temp directory and is not part of the repository's permanent configuration. Confirm their current state before relying on them.
