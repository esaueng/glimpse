"""Exercise Gitleaks with generated, nonfunctional fixtures outside the source tree."""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / '.gitleaks.toml'


def scan(mode, path):
    result = subprocess.run([
        'gitleaks', mode, '.', '--config', str(CONFIG),
        '--gitleaks-ignore-path', os.devnull, '--ignore-gitleaks-allow',
        '--redact', '--no-banner', '--log-level', 'error',
        *(['--log-opts=--all --full-history'] if mode == 'git' else []),
    ], capture_output=True, cwd=path)
    if result.returncode not in (0, 1):
        raise SystemExit('Gitleaks could not complete a synthetic scan; details redacted.')
    return result.returncode


def git(path, *args):
    subprocess.run(['git', '-C', str(path), *args], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


with tempfile.TemporaryDirectory(prefix='glimpse-secret-scan-') as temporary:
    path = Path(temporary)
    # Public values, read from deployment config rather than duplicated in fixtures.
    audiences = set(re.findall(r'"ACCESS_AUD": "([a-f0-9]{64})"',
                              (ROOT / 'wrangler.jsonc').read_text()))
    fixture = path / 'wrangler.jsonc'
    for audience in audiences:
        fixture.write_text(f'"ACCESS_AUD": "{audience}"\n')
        if scan('dir', path) != 0:
            raise SystemExit('Public Access audience was incorrectly rejected.')
        generated = path / 'worker-configuration.d.ts'
        generated.write_text(f'\tACCESS_AUD: "{audience}";\n')
        if scan('dir', path) != 0:
            raise SystemExit('Generated public audience type was incorrectly rejected.')
        generated.unlink()

    if not audiences:
        raise SystemExit('No Access audiences found for regression fixtures.')

    # Same value under a credential key or another path must still be caught.
    fixture.write_text(f'api_key = "{audience}"\n')
    if scan('dir', path) != 1:
        raise SystemExit('Audience exception incorrectly suppressed a credential key.')
    fixture.write_text(f'"ACCESS_AUD": "{audience}"\n')
    fixture.rename(path / 'unapproved.txt')
    if scan('dir', path) != 1:
        raise SystemExit('Audience exception incorrectly suppressed another path.')
    (path / 'unapproved.txt').unlink()

    # Generate a fake credential at runtime; never commit a token-shaped fixture.
    fixture.write_text('api_key = "' + 'ghp_' + 'Ab3dE5fG7hJ9kL2mN4pQ6rS8tU1vW3xY5zA7' + '"\n')
    if scan('dir', path) != 1:
        raise SystemExit('Credential in deployment config was missed.')
    git(path, 'init', '--quiet')
    git(path, 'add', 'wrangler.jsonc')
    git(path, 'commit', '--quiet', '-m', 'Add synthetic scanner fixture')
    git(path, 'rm', '--quiet', 'wrangler.jsonc')
    git(path, 'commit', '--quiet', '-m', 'Remove synthetic scanner fixture')
    if scan('git', path) != 1:
        raise SystemExit('Credential deleted from the current tree was missed in history.')

print('PASS: public audience accepted; credential keys, other paths and deleted credentials rejected.')
