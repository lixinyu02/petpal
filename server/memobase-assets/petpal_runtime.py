"""PetPal adapter for Memobase 0.0.42; account routing and bounded LLM work.

Upstream profile/database updates retain their original order. Only independent
LLM calls share permits. Credentials are loaded from a private read-only mount.
"""
import asyncio
import contextvars
import json
import pathlib
from contextlib import asynccontextmanager

CURRENT = contextvars.ContextVar("petpal_memory_route", default=None)


class Router:
    def __init__(self, filename, complete):
        self.filename = pathlib.Path(filename)
        self.complete = complete
        self.global_slots = asyncio.Semaphore(3)
        self.user_slots = {}

    def routes(self):
        data = self.filename.read_bytes()
        if len(data) > 2 * 1024 * 1024:
            raise RuntimeError("PETPAL_MEMORY_MODEL_CONFIG")
        value = json.loads(data)
        if value.get("schema") != "petpal-memory-models.v1" or value.get("maxConcurrency") != 3:
            raise RuntimeError("PETPAL_MEMORY_MODEL_CONFIG")
        return value["routes"]

    @asynccontextmanager
    async def scope(self, uid):
        uid = str(uid)  # FastAPI/Pydantic passes UUID objects to Memobase controllers.
        route = self.routes().get(uid)
        if not route or route.get("allowed") is not True or type(route.get("concurrency")) is not int or not 1 <= route["concurrency"] <= 3:
            raise RuntimeError("PETPAL_MEMORY_MODEL_UNAUTHORIZED")
        marker = CURRENT.set((uid, route))
        try:
            yield
        finally:
            CURRENT.reset(marker)

    async def call(self, model, prompt, system_prompt=None, history_messages=None, **kwargs):
        scope = CURRENT.get()
        if scope is None:  # Upstream startup sanity check, without account data.
            async with self.global_slots:
                return await self.complete(None, model, prompt, system_prompt, history_messages or [], kwargs)
        uid, route = scope
        current = self.routes().get(uid, {})
        if current.get("allowed") is not True or route.get("providerId") is not None and route["providerId"] not in current.get("authorizedProviderIds", []):
            raise RuntimeError("PETPAL_MEMORY_MODEL_UNAUTHORIZED")
        key = (uid, route["concurrency"])
        if key not in self.user_slots:
            if len(self.user_slots) > 4096:
                raise RuntimeError("PETPAL_MEMORY_MODEL_CAPACITY")
            self.user_slots[key] = asyncio.Semaphore(route["concurrency"])
        async with self.user_slots[key], self.global_slots:
            # Recheck after queueing so revoked scopes cannot start a later call.
            current = self.routes().get(uid, {})
            if current.get("allowed") is not True or route.get("providerId") is not None and route["providerId"] not in current.get("authorizedProviderIds", []):
                raise RuntimeError("PETPAL_MEMORY_MODEL_UNAUTHORIZED")
            return await self.complete(route.get("provider"), model, prompt, system_prompt, history_messages or [], kwargs)


def main():
    import api
    import uvicorn
    from openai import AsyncOpenAI
    from memobase_server.env import CONFIG
    from memobase_server import llms
    from memobase_server.llms.utils import exclude_special_kwargs
    from memobase_server.controllers.modal import BLOBS_PROCESS

    async def complete(provider, model, prompt, system, history, kwargs):
        _, kwargs = exclude_special_kwargs(kwargs)
        messages = ([{"role": "system", "content": system}] if system else []) + history + [{"role": "user", "content": prompt}]
        selected = provider or {"baseUrl": CONFIG.llm_base_url, "apiKey": CONFIG.llm_api_key, "model": model}
        try:
            async with AsyncOpenAI(base_url=selected["baseUrl"], api_key=selected["apiKey"], max_retries=0) as client:
                response = await client.chat.completions.create(model=selected["model"], messages=messages, timeout=120, **kwargs)
                text = response.choices[0].message.content
                if not isinstance(text, str):
                    raise RuntimeError()
                return text
        except Exception:
            raise RuntimeError("PETPAL_MEMORY_MODEL_FAILED") from None

    router = Router("/app/petpal-models/routes.json", complete)
    llms.FACTORIES["openai"] = router.call

    def wrap(process):
        async def scoped(uid, project, blobs):
            async with router.scope(uid):
                return await process(uid, project, blobs)
        return scoped

    for kind, process in list(BLOBS_PROCESS.items()):
        BLOBS_PROCESS[kind] = wrap(process)
    uvicorn.run(api.app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
