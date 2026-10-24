"""Step 4b — background worker registry."""

import asyncio
import logging
from collections.abc import Awaitable, Callable

logger = logging.getLogger(__name__)


class WorkerManager:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}

    def start(self, name: str, coro_factory: Callable[[], Awaitable[None]]) -> None:
        if name in self._tasks:
            raise ValueError(f"Worker '{name}' already started")
        self._tasks[name] = asyncio.create_task(coro_factory(), name=f"worker:{name}")

    @property
    def names(self) -> list[str]:
        return list(self._tasks)

    def is_healthy(self) -> bool:
        return all(not task.done() for task in self._tasks.values())

    async def stop(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()
