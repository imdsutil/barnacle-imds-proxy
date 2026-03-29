IMAGE?=barnacle-imds-proxy
TAG?=latest
PROXY_IMAGE?=$(IMAGE)-proxy

BUILDER=buildx-multi-arch

# Extract description from description.json
DESCRIPTION=$(shell bash scripts/extract-description.sh)

INFO_COLOR = \033[0;36m
NO_COLOR   = \033[m
COVERAGE_MIN ?= 80

# ─── Build ────────────────────────────────────────────────────────────────────

build: build-backend build-proxy build-ui ## Build all components

build-backend: ## Build backend Go binary
	cd backend && go build ./...

build-proxy: ## Build proxy Go binary
	cd proxy && go build ./...

build-ui: ## Build UI (TypeScript compile + Vite bundle)
	cd ui && pnpm build

build-extension: ## Build service image to be deployed as a desktop extension
	docker build --tag=$(IMAGE):$(TAG) --build-arg DESCRIPTION="$(DESCRIPTION)" .
	docker build --tag=$(PROXY_IMAGE):$(TAG) -f Dockerfile.proxy .

install-extension: build-extension ## Install the extension
	docker extension install -f $(IMAGE):$(TAG)

update-extension: build-extension ## Update the extension (or install if not present)
	@docker extension ls | grep -q $(IMAGE) && docker extension update -f $(IMAGE):$(TAG) || docker extension install -f $(IMAGE):$(TAG)

uninstall-extension: ## Uninstall the extension
	docker extension uninstall $(IMAGE):$(TAG)

prepare-buildx: ## Create buildx builder for multi-arch build, if not exists
	docker buildx inspect $(BUILDER) || docker buildx create --name=$(BUILDER) --driver=docker-container --driver-opt=network=host

push-extension: prepare-buildx ## Build & Upload extension image to hub. Do not push if tag already exists: make push-extension tag=0.1
	docker pull $(IMAGE):$(TAG) && { echo "Failure: Tag already exists"; exit 1; } || docker buildx build --push --builder=$(BUILDER) --platform=linux/amd64,linux/arm64 --build-arg TAG=$(TAG) --build-arg DESCRIPTION="$(DESCRIPTION)" --build-arg PROXY_IMAGE=$(PROXY_IMAGE):$(TAG) --tag=$(IMAGE):$(TAG) .
	docker pull $(PROXY_IMAGE):$(TAG) && { echo "Failure: Proxy tag already exists"; exit 1; } || docker buildx build --push --builder=$(BUILDER) --platform=linux/amd64,linux/arm64 --tag=$(PROXY_IMAGE):$(TAG) -f Dockerfile.proxy .

# ─── Development ──────────────────────────────────────────────────────────────

run-test-server: ## Run the test HTTP server for local development (default port 8080)
	@echo "$(INFO_COLOR)Starting test server on http://localhost:8080$(NO_COLOR)"
	@echo "$(INFO_COLOR)Configure the extension to use: http://host.docker.internal:8080$(NO_COLOR)"
	cd test-server && go run main.go

run-test-server-port: ## Run the test HTTP server on a custom port: make run-test-server-port PORT=9000
	@echo "$(INFO_COLOR)Starting test server on http://localhost:$(PORT)$(NO_COLOR)"
	@echo "$(INFO_COLOR)Configure the extension to use: http://host.docker.internal:$(PORT)$(NO_COLOR)"
	cd test-server && go run main.go -port=$(PORT)

# ─── Tests ────────────────────────────────────────────────────────────────────

test: test-coverage test-race test-stress ## Run all tests with coverage, race detection, and stress. Set VERBOSE_TESTS=1 to show detailed logs.

test-backend: ## Run backend tests
	@echo "$(INFO_COLOR)Running backend tests...$(NO_COLOR)"
	cd backend && go test -v ./...

test-proxy: ## Run proxy tests
	@echo "$(INFO_COLOR)Running proxy tests...$(NO_COLOR)"
	cd proxy && go test -v ./...

test-ui: ## Run UI tests with Vitest
	@echo "$(INFO_COLOR)Running UI tests...$(NO_COLOR)"
	cd ui && pnpm test

# ─── Coverage ─────────────────────────────────────────────────────────────────

test-coverage: test-backend-coverage test-proxy-coverage test-ui-coverage ## Run coverage for backend, proxy, and UI

test-backend-coverage: ## Run backend tests with coverage
	@echo "$(INFO_COLOR)Running backend coverage...$(NO_COLOR)"
	cd backend && go test ./... -coverprofile=coverage.out
	cd backend && go tool cover -func=coverage.out | awk '/^total:/{if ($$3+0 < $(COVERAGE_MIN)) {print "Backend coverage below $(COVERAGE_MIN)%"; exit 1}}'

test-proxy-coverage: ## Run proxy tests with coverage
	@echo "$(INFO_COLOR)Running proxy coverage...$(NO_COLOR)"
	cd proxy && go test ./... -coverprofile=coverage.out
	cd proxy && go tool cover -func=coverage.out | awk '/^total:/{if ($$3+0 < $(COVERAGE_MIN)) {print "Proxy coverage below $(COVERAGE_MIN)%"; exit 1}}'

test-ui-coverage: ## Run UI tests with coverage
	@echo "$(INFO_COLOR)Running UI coverage...$(NO_COLOR)"
	cd ui && pnpm test --coverage

# ─── Race detection ───────────────────────────────────────────────────────────

test-race: test-backend-race test-proxy-race ## Run backend and proxy tests with race detector

test-backend-race: ## Run backend tests with race detector
	@echo "$(INFO_COLOR)Running backend tests with race detector...$(NO_COLOR)"
	cd backend && go test -race -v ./...

test-proxy-race: ## Run proxy tests with race detector
	@echo "$(INFO_COLOR)Running proxy tests with race detector...$(NO_COLOR)"
	cd proxy && go test -race -v ./...

# ─── Stress ───────────────────────────────────────────────────────────────────

test-stress: test-backend-stress test-proxy-stress ## Run stress tests with high concurrent load

test-backend-stress: ## Run backend stress tests
	@echo "$(INFO_COLOR)Running backend stress tests...$(NO_COLOR)"
	cd backend && go test -v -run="Stress" ./...

test-proxy-stress: ## Run proxy stress tests
	@echo "$(INFO_COLOR)Running proxy stress tests...$(NO_COLOR)"
	cd proxy && go test -v -run="Stress" ./...

# ─── Integration & E2E ────────────────────────────────────────────────────────

test-integration: test-backend-integration ## Run all integration tests

test-backend-integration: ## Run backend integration tests
	@echo "$(INFO_COLOR)Running backend integration tests...$(NO_COLOR)"
	cd backend && go test -v -tags=integration -run Integration ./...

test-e2e: ## Run end-to-end test against a running extension (start test server first)
	@echo "$(INFO_COLOR)Running e2e tests...$(NO_COLOR)"
	bats scripts/test-e2e.sh

# ─── Benchmarks ───────────────────────────────────────────────────────────────

bench: bench-backend bench-proxy ## Run all benchmarks

bench-backend: ## Run backend benchmarks
	@echo "$(INFO_COLOR)Running backend benchmarks...$(NO_COLOR)"
	cd backend && go test -bench=. -benchmem -run=^$$ ./...

bench-proxy: ## Run proxy benchmarks
	@echo "$(INFO_COLOR)Running proxy benchmarks...$(NO_COLOR)"
	cd proxy && go test -bench=. -benchmem -run=^$$ ./...

# ─── Regression ───────────────────────────────────────────────────────────────

regression: lint test test-integration ## Run comprehensive regression test suite

regression-ci: lint test-coverage test-integration ## Run regression suite for CI (coverage + integration, no race/stress)

# ─── Lint ─────────────────────────────────────────────────────────────────────

lint: lint-go ## Run all linting checks

lint-go: lint-backend lint-proxy ## Run go vet on all Go code

lint-backend: ## Run go vet on backend code including tests
	@echo "$(INFO_COLOR)Linting backend code...$(NO_COLOR)"
	cd backend && go vet ./...

lint-proxy: ## Run go vet on proxy code including tests
	@echo "$(INFO_COLOR)Linting proxy code...$(NO_COLOR)"
	cd proxy && go vet ./...

lint-fix: ## Run pre-commit checks on all files
	pre-commit run --all-files

# ─── Utilities ────────────────────────────────────────────────────────────────

clean: ## Remove generated coverage files
	rm -f backend/coverage.out proxy/coverage.out

help: ## Show this help
	@echo Please specify a build target. The choices are:
	@grep -E '^[0-9a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "$(INFO_COLOR)%-30s$(NO_COLOR) %s\n", $$1, $$2}'

setup: ## Install pre-commit hooks
	# Check if .venv exists with stale paths (e.g., from directory rename) and remove it
	@if [ -f .venv/bin/pre-commit ]; then \
		SHEBANG=$$(head -1 .venv/bin/pre-commit 2>/dev/null || echo ""); \
		EXPECTED="$$(pwd)/.venv/bin/python"; \
		if [ -n "$$SHEBANG" ] && ! echo "$$SHEBANG" | grep -q "$$EXPECTED"; then \
			echo "Detected stale .venv with incorrect paths. Removing..."; \
			rm -rf .venv; \
		fi; \
	fi
	# Installation priority: uv -> pyenv -> pip -> brew.
	# uv path uses a local .venv to keep dependencies contained.
	@echo "Installing pre-commit framework..."
	@command -v pre-commit >/dev/null 2>&1 || ( \
		: "uv: create .venv if missing, then install into it"; \
		if command -v uv >/dev/null 2>&1; then \
			[ -d .venv ] || uv venv .venv; \
			uv pip install --python .venv/bin/python pre-commit && exit 0; \
		fi; \
		: "pyenv: requires a selected Python (pyenv local/global)"; \
		if command -v pyenv >/dev/null 2>&1; then \
			if pyenv which python >/dev/null 2>&1; then \
				pyenv exec pip install pre-commit && exit 0; \
			else \
				echo "pyenv is installed but no Python is selected. Run: pyenv local <version>" >&2; \
			fi; \
		fi; \
		: "system pip"; \
		if command -v python3 >/dev/null 2>&1; then \
			python3 -m pip install pre-commit && exit 0; \
		fi; \
		if command -v pip >/dev/null 2>&1; then \
			pip install pre-commit && exit 0; \
		fi; \
		if command -v brew >/dev/null 2>&1; then \
			brew install pre-commit && exit 0; \
		fi; \
		echo "Could not install pre-commit. Install uv, pyenv, pip, or brew and run \"make setup\" again." >&2; \
		exit 1; \
	)
	@if [ -x .venv/bin/pre-commit ]; then .venv/bin/pre-commit install; else pre-commit install; fi
	@echo "Setup complete! Hooks are now active."

.PHONY: build build-backend build-proxy build-ui \
        build-extension install-extension update-extension uninstall-extension prepare-buildx push-extension \
        run-test-server run-test-server-port \
        test test-backend test-proxy test-ui \
        test-coverage test-backend-coverage test-proxy-coverage test-ui-coverage \
        test-race test-backend-race test-proxy-race \
        test-stress test-backend-stress test-proxy-stress \
        test-integration test-backend-integration test-e2e \
        bench bench-backend bench-proxy \
        regression regression-ci \
        lint lint-go lint-backend lint-proxy lint-fix \
        clean help setup
