import asyncio
from datetime import date, timedelta
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_consensus import programme
import pipeline


class PipelineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.job = "consensus-test"
        pipeline.JOBS[self.job] = pipeline._new_job()
        self.data = programme()
        self.data["race"]["date"] = date.today().isoformat()
        self.pdf = {"date": date.today(), "path": "unused.pdf", "url": "https://example.test/programme.pdf"}
        self.session = MagicMock()
        # Une course existante doit rester intacte si la régénération échoue.
        self.session.execute = AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(id=42)))
        self.context = MagicMock()
        self.context.__aenter__ = AsyncMock(return_value=self.session)
        self.context.__aexit__ = AsyncMock(return_value=False)
        self.persist = AsyncMock(return_value=(42, 17))
        self.extract = AsyncMock(return_value=self.data)
        patches = [
            patch.object(pipeline, "_LOCK", asyncio.Lock()),
            patch.object(pipeline, "AsyncSessionLocal", return_value=self.context),
            patch.object(pipeline, "fetch_today_pmub_pdf", new=AsyncMock(return_value=self.pdf)),
            patch.object(pipeline, "analyze_pdf", new=self.extract),
            patch.object(pipeline, "_persist", new=self.persist),
            patch.object(pipeline, "logger"),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.addCleanup(pipeline.JOBS.pop, self.job, None)

    async def test_pipeline_persists_the_calculated_twenty_groups(self):
        await pipeline._run(self.job, force=True)
        self.assertEqual(pipeline.JOBS[self.job]["status"], "finished")
        self.persist.assert_awaited_once()
        saved = self.persist.await_args.args[0]
        self.assertEqual(len(saved["proposals"]), 20)
        self.assertEqual(saved["proposals"][0]["nums"], [13, 12, 14, 6, 3])
        self.session.delete.assert_not_called()

    async def test_old_pdf_is_rejected_before_ai_or_persistence(self):
        self.pdf["date"] -= timedelta(days=1)
        await pipeline._run(self.job, force=True)
        self.assertEqual(pipeline.JOBS[self.job]["status"], "error")
        self.extract.assert_not_awaited()
        self.persist.assert_not_awaited()
        self.session.delete.assert_not_called()

    async def test_extracted_wrong_date_is_rejected(self):
        self.data["race"]["date"] = "2000-01-01"
        await pipeline._run(self.job, force=True)
        self.assertEqual(pipeline.JOBS[self.job]["status"], "error")
        self.persist.assert_not_awaited()
        self.session.delete.assert_not_called()

    async def test_bad_signals_do_not_replace_existing_pronostic(self):
        self.data["partner_predictions"] = []
        await pipeline._run(self.job, force=True)
        self.assertEqual(pipeline.JOBS[self.job]["status"], "error")
        self.persist.assert_not_awaited()
        self.session.delete.assert_not_called()
