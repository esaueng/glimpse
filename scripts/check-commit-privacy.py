"""Check public Git metadata without embedding a personal denylist."""
import os
import re
import subprocess
import sys


def public_identity(name, email):
    if name == 'GitHub' and email == 'noreply@github.com':
        return True
    match = re.fullmatch(r'(?:[0-9]+\+)?([A-Za-z0-9-]+(?:\[bot\])?)@users\.noreply\.github\.com', email)
    return bool(match and name.casefold() == match.group(1).casefold())


def main():
    assert public_identity('example-user', '123+example-user@users.noreply.github.com')
    assert not public_identity('Private Person', '123+example-user@users.noreply.github.com')
    assert not public_identity('example-user', 'person@example.invalid')
    base = os.environ.get('PR_BASE_SHA')
    head = os.environ.get('PR_HEAD_SHA') or 'HEAD'
    revisions = subprocess.check_output(['git', 'rev-list', f'{base}..{head}' if base else head], text=True).splitlines()
    for revision in revisions:
        data = subprocess.check_output(['git', 'show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce', revision], text=True).strip().split('\0')
        if not (public_identity(data[0], data[1]) and public_identity(data[2], data[3])):
            sys.exit('Commit metadata does not use matching public GitHub handles and noreply addresses. Run git-privacy-guard verify. Details redacted.')
    print(f'Checked {len(revisions)} commits for public metadata.')


if __name__ == '__main__':
    main()
