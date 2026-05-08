# Coding Standards

The reviewer agent reads this file when verifying AFK branches before merge. Customize it with project-specific style, testing, and architectural conventions. Keep it short — the reviewer scans, doesn't read.

## Style

<!-- Examples:
- camelCase for variables and functions, PascalCase for types and classes.
- Prefer named exports over default exports.
- No `any`. Use `unknown` + narrowing instead.
- Keep functions under ~40 lines; if longer, extract.
-->

## Testing

<!-- Examples:
- Every public function has at least one test exercising its behaviour.
- Tests describe behaviour, not implementation. Test names read like specifications.
- No mocking of internal collaborators; mock only at the system boundary.
- Integration tests live in `test/`, unit tests next to source as `*.test.ts`.
-->

## Architecture

<!-- Examples:
- One module per responsibility; resist deep coupling.
- Composition over inheritance.
- Avoid global state. Pass dependencies explicitly.
- Domain language matches the project's CONTEXT.md glossary.
-->
