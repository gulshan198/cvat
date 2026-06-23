from functools import wraps
from typing import Callable, ParamSpec, TypeVar

from django.conf import settings
from django.db import DatabaseError, connection
from psycopg2 import Error as PsycopgError
from psycopg2.errors import LockNotAvailable
from rest_framework import status
from rest_framework.exceptions import APIException

P = ParamSpec("P")
R = TypeVar("R")


class DatabaseResourceBusyApiException(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = (
        "This resource is currently busy with another operation. " "Please try again in a moment."
    )
    default_code = "database_resource_busy"


def find_psycopg_cause(
    exc: DatabaseError,
) -> PsycopgError | None:
    """Return the deepest underlying psycopg exception from a Django database error."""

    seen: set[int] = set()

    def find_deepest(current: BaseException) -> PsycopgError | None:
        if id(current) in seen:
            return None

        seen.add(id(current))

        nested_causes = [
            nested for nested in (current.__cause__, current.__context__) if nested is not None
        ]

        for nested in nested_causes:
            nested_psycopg_cause = find_deepest(nested)
            if nested_psycopg_cause is not None:
                return nested_psycopg_cause

        if isinstance(current, PsycopgError):
            return current

        return None

    return find_deepest(exc)


def set_local_lock_timeout(
    timeout_seconds: str | None = None,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(func: Callable[P, R]) -> Callable[P, R]:
        @wraps(func)
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SET LOCAL lock_timeout = %s;",
                    [
                        (
                            timeout_seconds
                            if timeout_seconds is not None
                            else settings.CVAT_POSTGRES_TRANSACTION_LOCK_TIMEOUT_SECONDS
                        )
                        * 1000
                    ],
                )

            return func(*args, **kwargs)

        return wrapper

    return decorator


def raise_resource_busy_api_exception_on_lock_not_available(func: Callable[P, R]) -> Callable[P, R]:
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return func(*args, **kwargs)
        except DatabaseError as exc:
            if isinstance(find_psycopg_cause(exc=exc), LockNotAvailable):
                raise DatabaseResourceBusyApiException from exc
            raise

    return wrapper
