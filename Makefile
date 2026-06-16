# ShopM — common dev commands. See §6 of docs/IMPLEMENTATION_PLAN.md.
# Recipes use docker-compose so behaviour is identical across machines.
DC := docker compose
BE := $(DC) exec backend
FE := $(DC) exec frontend

.DEFAULT_GOAL := help
.PHONY: help up down logs migrate makemigrations seed test test-be test-fe test-e2e lint fmt types shell

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

test-e2e: ## End-to-end tests (Playwright)
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
