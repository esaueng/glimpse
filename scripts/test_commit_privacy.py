"""Regressions for public GitHub merge identities and private metadata rejection."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('commit_privacy', Path(__file__).with_name('check-commit-privacy.py'))
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)


class PublicIdentityTests(unittest.TestCase):
    def test_github_merge_and_approved_display_name(self):
        self.assertTrue(privacy.public_identity('GitHub', 'noreply@github.com'))
        self.assertTrue(privacy.public_identity('Peter', '171875562+petergstfsn@users.noreply.github.com'))
        self.assertTrue(privacy.public_identity('petergstfsn', '171875562+petergstfsn@users.noreply.github.com'))

    def test_display_name_exception_is_scoped_to_approved_login(self):
        self.assertFalse(privacy.public_identity('Peter', '123+example-user@users.noreply.github.com'))
        self.assertFalse(privacy.public_identity('Private Person', '171875562+petergstfsn@users.noreply.github.com'))

    def test_private_addresses_and_fake_github_identity_are_rejected(self):
        self.assertFalse(privacy.public_identity('Peter', 'person@example.invalid'))
        self.assertFalse(privacy.public_identity('GitHub', 'person@example.invalid'))
        self.assertFalse(privacy.public_identity('petergstfsn', 'person@example.invalid'))


if __name__ == '__main__':
    unittest.main()
