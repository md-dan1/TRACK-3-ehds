# One image for the orchestrator (access body) and the hospital nodes (hospital_node).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY core core
COPY orchestrator orchestrator
COPY node node
ENV PYTHONPATH=/app/core:/app/orchestrator:/app/node PYTHONUNBUFFERED=1
EXPOSE 8000
