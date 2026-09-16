# Common contributor commands. The application remains runnable with the
# underlying Docker, Python, and npm commands when more control is needed.

.PHONY: help dev ui build lint check

help:
	@printf '%s\n' \
		'dev       Start the contributor development stack' \
		'ui        Start the Vite development server' \
		'build     Build the frontend and bundled image' \
		'check     Run lightweight source checks'

ui:
	cd ui && npm run dev

dev:
	docker compose -f docker-compose.dev.yml up postgres broker server

build:
	cd ui && npm ci && npm run build
	docker build -t mcplama:local .

lint:
	python3 -m compileall -q server/app
	cd ui && npm run build

check: lint
