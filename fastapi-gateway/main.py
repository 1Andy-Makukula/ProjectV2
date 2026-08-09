"""
KithLy Auxiliary API Gateway -- SCAFFOLD ONLY, NOT IMPLEMENTED.

This service does not do anything yet. It has no database client, no queue
client, and no routes beyond the two below.

It previously reported {"status": "healthy", "database_connected": true,
"queue_connected": true} from /healthz. Those values were hardcoded -- nothing
in this file has ever opened a connection to anything. A health check that
always answers healthy is worse than no health check at all: a monitor pointed
at it reports green forever, including while every dependency is down, and the
first sign of trouble is a customer rather than an alert.

So /healthz now answers 501. An unimplemented service should be unmistakably
unimplemented to anything that asks.

If this gateway is ever built out, the health check must actually check:
execute a trivial query against the database, ping the queue, and report each
independently. Until then, leave it saying no.

See Nextsteps.md for the intended role of this service and worker-engine.
"""
import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI(
    title="KithLy Auxiliary API Gateway (scaffold)",
    description=(
        "Placeholder for a future traffic gateway. Not implemented -- all "
        "endpoints report 501. No traffic should be routed here."
    ),
    version="0.0.0-scaffold",
)

# 501 Not Implemented, not 503. 503 means "temporarily unavailable, try again",
# which invites retries and backs off as though this were a transient fault.
# There is nothing here to come back to yet.
NOT_IMPLEMENTED = 501


@app.get("/")
def read_root() -> JSONResponse:
    return JSONResponse(
        status_code=NOT_IMPLEMENTED,
        content={
            "service": "KithLy Auxiliary API Gateway",
            "implemented": False,
            "detail": (
                "Scaffold only. This service performs no work and holds no "
                "connections. See Nextsteps.md."
            ),
            "env": os.getenv("FASTAPI_ENV", "development"),
        },
    )


@app.get("/healthz")
def health_check() -> JSONResponse:
    """
    Deliberately unhealthy.

    Reporting healthy would be a lie, and the previous version's hardcoded
    database_connected/queue_connected flags are the exact shape of lie that
    survives into production monitoring unnoticed.
    """
    return JSONResponse(
        status_code=NOT_IMPLEMENTED,
        content={
            "status": "not_implemented",
            "implemented": False,
            # Deliberately absent rather than false: this service does not
            # check these things at all, and reporting false would imply it
            # looked and found them down.
            "detail": (
                "This scaffold does not connect to a database or a queue and "
                "cannot report on either. Do not treat a response from this "
                "endpoint as a health signal."
            ),
        },
    )
