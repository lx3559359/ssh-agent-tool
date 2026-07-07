from __future__ import annotations

import re
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent

SUSPICIOUS_MOJIBAKE_FRAGMENTS = (
    "\ufffd",
    "\u701a\u641e\u5131\u9359",
    "\u93c9\u256b\u7c8e",
    "\u95ba\u56e7\u74e8",
    "\u95bb\u6940\u724a",
    "\u5a11\u6493\ue0c8",
    "\u940e\u7470\ue633",
    "\u5a23\u56e6\u7e42",
    "\u6fe1\ue0b2\u5093",
    "\u95b8\ufe36\u6f98",
    "\u745c\u7248\u6338",
    "\u95b8\u6b09\u57b9",
    "\u95ba\u582b\u5259",
    "\u95b9\u57ab\u6338",
    "\u95b8\u6385\u7a11",
    "\u95ba\u4f7a\u5897",
    "\u9420\u56e7\ufe65",
    "\u5a62\u60f0\u7cbe\u7479",
    "\u7f02\u509a\u642b",
    "\u95b3",
    "\u9207",
    "\u7ed1\u4f80\u632c",
    "\u74d2\u545b\u6928",
    "\u7481\u3088\u7629",
    "\u7035\u55ca\u722c",
    "\u6d93\u7ed8",
    "\u93c2\u56e6\u6b22",
    "\u6fbe\u8fa8\u89e6",
    "\u93b5\u64b3\u7d1d",
    "\u9435\u528d",
    "\u6b7f",
    "\u9369",
    "\u7d09\u4fca\u6327",
    "\u74d2\u5459",
    "\u7481\u4ec8",
    "\u7ed1\u4f80",
    "\u4f80\u6327",
    "\u74d2\u545b\u6928",
    "\u7481\u8fa8",
    "\u93b5",
    "\u93c2",
    "\u935a\u59e9",
    "\u7f01",
    "\u93c8",
    "\u95bf",
    "\u701b",
    "\u95bf\u6b12",
    "\u95bf\u6b0f",
    "\u935a\u55d8",
    "\u7d09\u4f80\u6327",
    "\u74d2\u545b\u6928",
    "\u7481\u8fa8",
    "\u9369\u55d8",
    "\u95b8",
    "\u935a",
    "\u7039",
    "\u9361",
    "\u9f99",
    "\u93c8\u701b",
    "\u7487",
    "\u7f01\u4f83",
    "\u7f02",
    "\u93c2\u6ee6",
    "\u9351",
    "\u6b0f",
    "\u5a34",
    "\u95c0",
    "\u73a0",
    "\u9357",
    "\u6d93",
    "\u5a34\u3129",
    "\u5a34\u568e",
    "\u9359",
    "\u9357\u545b",
    "\u7db0",
    "\u7efb",
    "\u6d7c",
    "\u93c2\u570e",
    "\u7470",
    "\u9375",
    "\u93c2",
    "\u7d1d",
    "\u5b29",
    "\u6e5d",
    "\u93c1",
    "\u93c8\u701b",
    "\u7e0b",
    "\u93c8\u701b",
    "\u93c8",
    "\u9358",
    "\u7d11",
    "\u74d2",
    "\u9359",
    "\u93c2\u56e6",
    "\u5a09",
    "\u93b5",
    "\u7d1d",
    "\u9352",
    "\u5a09",
    "\u6b11",
    "\u9366",
    "\u4e35\u679f",
    "\u951b\u6b7f",
    "\u7ec9\u4f80\u631c",
    "\u74d2\u546e\u6902",
    "\u7481\u3088\u7609",
    "\u7035\u55d9\u721c",
    "\u6d93\u7ed8\u6e80\u7035\u55db\u631c",
    "\u74ba\ue21a\u7dde",
    "\u6d93\u5d88\u5158",
    "\u6d93\u8679\u2516",
    "\u93b5\u64b3\u7d11",
    "\u6fb6\u8fab\u89e6",
    "\u9429\ue1bc\u7d8d",
    "\u93c2\u56e6\u6b22",
    "\u5bb8\u53c9\u58a6\u5bee",
    "\u7487\u8bf2\u5f47",
    "\u6769\u612f\ue511",
    "\u7487\u5a43\u67c7",
    "\u7035\u714e\u56ad",
    "\u935a\ue21a\u59e9",
    "\u9350\u6394\u512b",
    "\u59ab\u20ac\u93cc",
    "\u5bb8\u30e5\u53ff",
    "\u93c3\u30e5\u7e54",
    "\u9359\ue21a\u5553",
    "\u93c1\u7248\u5d41",
    "\u7039\u3221\u57db\u7ed4\ue21a\u53c6\u9359",
)

SUSPICIOUS_MOJIBAKE_PATTERN = re.compile(
    "|".join(re.escape(fragment) for fragment in SUSPICIOUS_MOJIBAKE_FRAGMENTS)
)


def iter_python_files():
    ignored_dirs = {".venv", "node_modules", "dist", "build", "__pycache__"}
    for path in PROJECT_ROOT.rglob("*.py"):
        if path.name == Path(__file__).name:
            continue
        if path.name.startswith("test_"):
            continue
        if any(part in ignored_dirs for part in path.relative_to(PROJECT_ROOT).parts):
            continue
        yield path


class PythonLocalizationTests(unittest.TestCase):
    def test_mojibake_detector_flags_common_broken_chinese(self):
        samples = [
            "SSH Agent \u701a\u641e\u5131\u9359",
            "\u93c9\u256b\u7c8e\u25bb\u95c2\u9357\u71b8",
            "\u9423\u5c80\u6f70\u9359\u621d\u657e\u95bf\u6b12\u87a4\ufffd",
            "authType \u7d09\u4f80\u6327",
            "\u7481\u8fa8\ue7de\u7dde\u4e1b\u5d86\u5158\u4e3b\u2516\u9286",
            "\u93b5\u64b3\u7d1d\u7481\u8fa8\ue7de\u7dde\u6fbe\u8fa8\u89e6\u951b\u6b7ferror}",
            "\u7ec9\u4f80\u631c",
            "\u74ba\ue21a\u7dde\u6d93\u5d88\u5158\u6d93\u8679\u2516",
            "\u7487\u5a43\u67c7\u7035\u714e\u56ad\u6fb6\u8fab\u89e6",
            "\u935a\ue21a\u59e9\u9350\u6394\u512b\u59ab\u20ac\u93cc",
        ]

        for sample in samples:
            with self.subTest(sample=sample):
                self.assertRegex(sample, SUSPICIOUS_MOJIBAKE_PATTERN)

    def test_python_sources_do_not_contain_mojibake_user_text(self):
        hits = []
        for path in iter_python_files():
            relative = path.relative_to(PROJECT_ROOT)
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if SUSPICIOUS_MOJIBAKE_PATTERN.search(line):
                    if "assertNotIn" in line or "assertNotRegex" in line:
                        continue
                    hits.append(f"{relative}:{line_number}:{line.strip()}")

        self.assertEqual(hits, [])
