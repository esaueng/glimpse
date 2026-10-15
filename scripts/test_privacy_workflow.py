"""Run the standalone policy's synthetic regressions without any GitHub access."""
import os
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest


class StandalonePolicyTests(unittest.TestCase):
    def test_api_policy_regressions(self):
        workflow = (Path(__file__).resolve().parents[1] /
                    '.github/workflows/commit-privacy.yml').read_text()
        source = textwrap.dedent(workflow.split("python3 - <<'PY'\n", 1)[1])
        source = source.rsplit('\nPY', 1)[0]
        result = subprocess.run(
            [sys.executable, '-c', source], capture_output=True, text=True,
            env=dict(os.environ, COMMIT_PRIVACY_SELF_TEST='1'),
        )
        self.assertEqual(result.returncode, 0, 'Standalone privacy regressions failed.')
        self.assertIn('PASS: commit privacy regression checks', result.stdout)


if __name__ == '__main__':
    unittest.main()
