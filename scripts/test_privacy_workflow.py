"""Run the standalone policy's synthetic regressions without any GitHub access."""
import os
from pathlib import Path
import subprocess
import sys
import unittest


class StandalonePolicyTests(unittest.TestCase):
    def test_api_policy_regressions(self):
        script = (Path(__file__).resolve().parents[1] /
                  '.github/privacy/commit_privacy.py')
        result = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True,
            env=dict(os.environ, COMMIT_PRIVACY_SELF_TEST='1'),
        )
        self.assertEqual(result.returncode, 0, 'Standalone privacy regressions failed.')
        self.assertIn('PASS: commit privacy regression checks', result.stdout)


if __name__ == '__main__':
    unittest.main()
