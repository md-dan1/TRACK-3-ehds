# SPE image: the gateway (default command) and the per-session containers it starts (spe_service.app).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY spe_service spe_service
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "spe_service.gateway:app", "--host", "0.0.0.0", "--port", "8000"]
