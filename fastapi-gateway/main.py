import os
from fastapi import FastAPI

app = FastAPI(
    title="KithLy Auxiliary API Gateway",
    description="Traffic gateway and telemetry routing layer for KithLy auxiliary services.",
    version="1.0.0"
)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "KithLy Auxiliary API Gateway",
        "env": os.getenv("FASTAPI_ENV", "production")
    }

@app.get("/healthz")
def health_check():
    return {
        "status": "healthy",
        "database_connected": True,
        "queue_connected": True
    }
