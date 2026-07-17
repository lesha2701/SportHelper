"""Common API error types with a consistent JSON error shape.

Response body: {"error": {"code": "<machine_code>", "message": "<human text>"}}
"""
from __future__ import annotations


class APIError(Exception):
    status_code: int = 400
    code: str = "bad_request"

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class UnauthorizedError(APIError):
    status_code = 401
    code = "unauthorized"


class ForbiddenError(APIError):
    status_code = 403
    code = "forbidden"


class NotFoundError(APIError):
    status_code = 404
    code = "not_found"


class AIServiceError(APIError):
    status_code = 502
    code = "ai_unavailable"
