from typing import Any

from fastapi import HTTPException


def build_api_error(
    code: str,
    message: str,
    hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "message": message,
    }

    if hint:
        error["hint"] = hint

    if details:
        error["details"] = details

    return error



def create_api_exception(
    status_code: int,
    code: str,
    message: str,
    hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=build_api_error(code, message, hint, details),
    )



def raise_api_error(
    status_code: int,
    code: str,
    message: str,
    hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    raise create_api_exception(status_code, code, message, hint, details)

