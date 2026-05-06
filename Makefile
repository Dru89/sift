# Sift — Makefile
#
# Common targets for building, installing, and developing sift.
# Run `make help` to see available targets.

SHELL := /bin/bash

# Paths
SKILL_INSTALL_DIR  := $(HOME)/.agents/skills/sift

.PHONY: help build clean install install-skill install-cli link unlink dev test

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Build ────────────────────────────────────────────────────

build: ## Build all packages (core, cli, agent skill)
	npm run build

clean: ## Remove all build artifacts
	npm run clean

test: ## Run all tests
	npm test

# ─── Install ──────────────────────────────────────────────────

install: build install-cli install-skill ## Build and install everything
	@echo ""
	@echo "  Done. Start a new agent session to pick up changes."

install-cli: build link ## Build and link the CLI globally

link: ## Link the sift CLI globally (npm link)
	cd packages/cli && npm link

unlink: ## Unlink the sift CLI
	cd packages/cli && npm unlink -g

install-skill: build ## Install the agent skill (SKILL.md + MCP server)
	@if command -v npx >/dev/null 2>&1; then \
		npx skills add . -g -y; \
	else \
		echo "  Skipping skill install (npx not found)"; \
	fi

# ─── Development ──────────────────────────────────────────────

dev: ## Watch for changes and rebuild (core + cli)
	npm run build --workspace=packages/core && \
	npm run build --workspace=packages/cli & \
	npm run dev --workspace=skills/sift
