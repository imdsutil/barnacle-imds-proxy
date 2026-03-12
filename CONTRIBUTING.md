# Contributing to IMDS Proxy

Thank you for your interest in contributing to the IMDS Proxy project!

## Getting Started

### Prerequisites

- **Go** 1.21 or later
- **Node.js** 18 or later with npm
- **Docker Desktop** (for testing the extension)
- **Make** (for build automation)

### Setup

1. Clone the repository
2. Run `make setup` to install pre-commit hooks and development tools
3. Run `make test` to verify everything works

## Development Workflow

### Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Run `make lint` to check code quality
4. Run `make test` to ensure all tests pass
5. Run `make regression` for comprehensive validation
6. Commit your changes (see commit guidelines below)
7. Push and create a pull request

### Running Tests

- `make test` - Run all tests (backend, proxy, UI)
- `make test-race` - Run tests with race detector
- `make test-stress` - Run stress tests with high concurrency
- `make bench` - Run performance benchmarks
- `make regression` - Run comprehensive test suite (lint + test + race + stress + bench)
- `VERBOSE_TESTS=1 make test` - Run tests with verbose output

### Linting

- `make lint` - Run all linting checks (go vet)
- `make lint-fix` - Run pre-commit hooks on all files
- Pre-commit hooks run automatically on `git commit`

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <subject>

[optional body]

[optional footer(s)]
```

### Types

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, no logic change)
- `refactor:` - Code refactoring (no feature/bug change)
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks
- `perf:` - Performance improvements
- `build:` - Build system or dependency changes
- `ci:` - CI/CD pipeline changes

### Guidelines

- **Keep subject line under 120 characters**
- **Use imperative mood**: "add" not "added" or "adds"
- **Don't capitalize** first letter of subject
- **No period** at end of subject line
- **Separate subject from body** with blank line
- **Include GitHub issue references** when applicable (e.g., `fixes #123`, `closes #456`)
- **Body should explain "why"** not just "what"

### Examples

Good:
```
feat: add support for IMDSv2 token caching

Implements in-memory caching for IMDSv2 tokens with configurable TTL.
This reduces latency for repeated metadata requests from the same
container.

Closes #42
```

Bad:
```
Added caching feature (addresses finding 4.2)
```

## Code Style

### Go

- Follow standard Go formatting (`gofmt`)
- Run `go vet` before committing (automated via pre-commit)
- Write table-driven tests where appropriate
- Use meaningful variable names

### TypeScript/React

- Follow existing code style
- Use functional components with hooks
- Write tests for UI components

### Testing Standards

- **Test coverage**: Aim for >80% coverage on new code
- **Test names**: Use descriptive names that explain what's being tested
- **Assertions**: Use meaningful error messages
- **Cleanup**: Always clean up test resources
- **Concurrency**: Use `t.Parallel()` for independent tests

#### Test Structure

```go
func TestFeatureName(t *testing.T) {
    // Setup
    // ...

    // Execute
    // ...

    // Assert
    if got != want {
        t.Errorf("function() = %v, want %v", got, want)
    }

    // Cleanup
    defer cleanup()
}
```

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

## Questions?

Feel free to open an issue for questions or clarifications.
