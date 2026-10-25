import asyncio
import importlib.util
import json
import pathlib
import tempfile
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / 'server/memobase-assets/petpal_runtime.py'
spec = importlib.util.spec_from_file_location('petpal_memory_router', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_scoped_models_and_three_permits(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / 'routes.json'
            routes = {'a': {'allowed': True, 'providerId': 'one', 'authorizedProviderIds': ['one'], 'concurrency': 3, 'provider': {'model': 'qwen'}}, 'b': {'allowed': True, 'providerId': 'two', 'authorizedProviderIds': ['two'], 'concurrency': 2, 'provider': {'model': 'other'}}}
            def save():
                file.write_text(json.dumps({'schema': 'petpal-memory-models.v1', 'maxConcurrency': 3, 'routes': routes}))
            save()
            active = peak = 0
            results = []
            async def complete(provider, model, prompt, system, history, kwargs):
                nonlocal active, peak
                active += 1
                peak = max(peak, active)
                try:
                    await asyncio.sleep(.01)
                    results.append((provider['model'], prompt))
                    return provider['model']
                finally:
                    active -= 1
            router = module.Router(file, complete)
            async def work(uid):
                async with router.scope(uid):
                    return await asyncio.gather(*[router.call('unused', uid) for _ in range(5)])
            await asyncio.gather(work('a'), work('b'))
            self.assertEqual(peak, 3)
            self.assertTrue(all(model == ('qwen' if uid == 'a' else 'other') for model, uid in results))
            routes['a']['allowed'] = False
            save()
            with self.assertRaises(RuntimeError):
                await work('a')
            self.assertEqual(active, 0)

    async def test_revocation_after_queueing_and_failure_release(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / 'routes.json'
            record = {'allowed': True, 'providerId': 'one', 'authorizedProviderIds': ['one'], 'concurrency': 1, 'provider': {'model': 'qwen'}}
            def save():
                file.write_text(json.dumps({'schema':'petpal-memory-models.v1','maxConcurrency':3,'routes':{'a':record}}))
            save()
            started, release = asyncio.Event(), asyncio.Event()
            calls = 0
            async def complete(*args):
                nonlocal calls
                calls += 1
                started.set()
                await release.wait()
                raise RuntimeError('controlled failure')
            router = module.Router(file, complete)
            async with router.scope('a'):
                first = asyncio.create_task(router.call('unused', 'first'))
                await started.wait()
                second = asyncio.create_task(router.call('unused', 'second'))
                await asyncio.sleep(0)
                record['authorizedProviderIds'] = []
                save()
                release.set()
                outcomes = await asyncio.gather(first, second, return_exceptions=True)
                self.assertTrue(all(isinstance(x, RuntimeError) for x in outcomes))
                self.assertEqual(calls, 1)


if __name__ == '__main__':
    unittest.main()
