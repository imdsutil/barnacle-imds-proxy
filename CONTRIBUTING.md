# Contributing

## Prerequisites

- Go 1.24+
- Node.js 24+ and pnpm
- Docker Desktop (with extensions enabled)
- Make

See [DEVELOPMENT.md](DEVELOPMENT.md) for build instructions, test commands, and local setup.

## Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Run `make lint` and `make test`
4. Commit and open a pull request

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <subject>

[optional body explaining why]

[optional footer, e.g. Closes #123]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`

Rules:
- Subject line under 120 characters
- Imperative mood: "add" not "added"
- No period at end of subject
- Body explains the "why", not just the "what"

## Code style

**Go**: Standard `gofmt` formatting. Run `go vet` before committing (pre-commit handles this automatically). Write table-driven tests. Use `t.Parallel()` for independent tests.

**TypeScript/React**: Functional components with hooks. Match existing code style. Write tests for UI components.

**Coverage**: Aim for >80% on new code.

## License

By contributing, you agree your contributions will be licensed under Apache 2.0.
