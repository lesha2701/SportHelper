# Build context must be the repo root (not backend/), because the app
# expects `database/` to sit next to `backend/` — see PROJECT_ROOT /
# DATABASE_DIR in backend/app/config.py and backend/app/database.py.
# docker-compose.yml sets `context: .` accordingly.
FROM python:3.12-slim

WORKDIR /app

# Install dependencies first so this layer is cached across code-only changes.
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY database/ database/

WORKDIR /app/backend

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')" || exit 1

# The bot process (a separate long-running container in docker-compose.yml)
# overrides this with: command: ["python", "run_bot.py"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
