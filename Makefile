# ShopM — common dev commands. See §6 of docs/IMPLEMENTATION_PLAN.md.
# Recipes use docker-compose so behaviour is identical across machines.
DC := docker compose
BE := $(DC) exec backend
FE := $(DC) exec frontend

DC_PROD := docker compose -f docker-compose.prod.yml --env-file .env.prod

.DEFAULT_GOAL := help
.PHONY: help up down logs migrate makemigrations seed test test-be test-fe test-e2e lint fmt types shell \
        deploy deploy-down deploy-logs backup audit

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

up: ## Start the dev stack (db, redis, backend, frontend, worker)
	$(DC) up --build

down: ## Stop the stack
	$(DC) down

logs: ## Tail all logs
	$(DC) logs -f

migrate: ## Apply backend migrations
	$(BE) python manage.py migrate

makemigrations: ## Create new migrations
	$(BE) python manage.py makemigrations

seed: ## Load demo data (1 owner, 2 shops, a cashier each, sample catalog)
	$(BE) python manage.py seed

test: test-be test-fe ## Run backend + frontend unit tests

test-be: ## Backend tests (pytest)
	$(BE) pytest

test-fe: ## Frontend unit tests (vitest)
	$(FE) npm run test

test-e2e: ## End-to-end tests (Playwright). Needs `make up && make migrate && make seed` first
	$(FE) npm run test:e2e

lint: ## Lint both sides (ruff + black --check + eslint + prettier --check)
	$(BE) ruff check . && $(BE) black --check . && $(FE) npm run lint && $(FE) npm run format:check

fmt: ## Auto-format both sides
	$(BE) ruff check --fix . && $(BE) black . && $(FE) npm run format

types: ## Regenerate OpenAPI schema + frontend API types
	$(BE) python manage.py spectacular --file schema.yml
	$(FE) npm run gen:types

shell: ## Django shell
	$(BE) python manage.py shell

deploy: ## Build & start the production stack (needs .env.prod — see .env.prod.example)
	$(DC_PROD) up -d --build

deploy-down: ## Stop the production stack
	$(DC_PROD) down

deploy-logs: ## Tail production logs
	$(DC_PROD) logs -f

backup: ## Trigger a manual database backup (see docs/BACKUP.md)
	$(BE) python manage.py backup_db

audit: ## Dependency vulnerability audit (backend + frontend)
	$(BE) pip install pip-audit --quiet && $(BE) pip-audit
	$(FE) npm audit --audit-level=high
