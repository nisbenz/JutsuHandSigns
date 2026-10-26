.PHONY: all run test install install-backend install-frontend clean

all: run

# Installs dependencies (only if missing) then starts both the backend and
# frontend. Just running `make` with no target does this.
run: install
	./run.sh

# Backend + frontend tests: no camera or model needed.
test: install-backend install-frontend
	cd backend && ../.venv/bin/python -m pytest -q tests
	cd web && npm test

install: install-backend install-frontend

install-backend:
	@if [ ! -d .venv ]; then \
		echo "Creating Python virtual environment..."; \
		python3 -m venv .venv; \
	fi
	./.venv/bin/pip install -q -r backend/requirements.txt

install-frontend:
	@if [ ! -d web/node_modules ]; then \
		cd web && npm install; \
	fi

clean:
	rm -rf .venv web/node_modules web/dist
