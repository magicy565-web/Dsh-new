"""Offline portable-delivery integrity and hostile-archive regression tests.

Run: python3 -m unittest discover -s miniprogram/test -p 'test_portable_delivery.py' -v
No project dependencies, accounts, browsers or network are used.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import portable_delivery as delivery


class PortableDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.compiled = self.repo / 'release/miniprogram'
        self.output = self.root / 'package'
        self.history = []
        files = {
            'README.md': b'Current portable fixture\n',
            '.env.example': b'API_KEY=\n',
            'scripts/check.sh': b'#!/bin/sh\nexit 0\n',
            'miniprogram/src/app.ts': b"const baseUrl = '';\n",
            'miniprogram/src/app.json': b'{"pages":[]}\n',
            'miniprogram/src/assets/icon.svg': b'<svg/>\n',
            'docs/validation/managed-commerce-sources.json': b'{"fixture":true}\n',
        }
        for prefix in delivery.PREFIXES:
            name = prefix + 'old.txt'
            files[name] = ('Historical ' + prefix).encode()
            self.history.append(name)
        for name, data in files.items():
            self.put(self.repo / name, data)
        (self.repo / 'scripts/check.sh').chmod(0o755)
        self.git('init', '--quiet')
        self.git('config', 'user.name', 'Portable fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'core.autocrlf', 'false')
        self.commit_all()
        # Historical working files AND their loose Git blobs are absent, as in
        # recovery. Packaging may read tree metadata, never these blob objects.
        for name in self.history:
            blob = self.git('rev-parse', self.commit + ':' + name).decode().strip()
            (self.repo / name).unlink()
            (self.repo / '.git/objects' / blob[:2] / blob[2:]).unlink()
        self.put(self.compiled / 'app.js', b"const baseUrl = '';\n")
        self.put(self.compiled / 'app.json', files['miniprogram/src/app.json'])
        self.put(self.compiled / 'assets/icon.svg', files['miniprogram/src/assets/icon.svg'])
        self.put(self.compiled / 'project.config.json', delivery.encode({
            'appid': 'touristappid', 'setting': {'urlCheck': True},
            'miniprogramRoot': './', 'compileType': 'miniprogram',
        }))
        self.put(self.compiled / 'package.json', b'{"type":"commonjs","private":true}\n')

    def put(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(0o644)

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], stderr=subprocess.PIPE)

    def commit_all(self):
        self.git('add', '-A')
        self.git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Offline fixture')
        self.commit = self.git('rev-parse', 'HEAD').decode().strip()

    def build_package(self):
        self.summary = delivery.package(self.repo, self.commit, self.compiled, self.output)
        self.source = self.output / self.summary['source']['file']
        self.client = self.output / self.summary['client']['file']
        self.expected = self.output / 'EXPECTED-GIT-TREE.json'
        return self.summary

    def verify(self, destination=None):
        return delivery.verify(self.source, self.client, self.expected, self.commit,
                               self.summary['client']['sha256'], destination)

    def rejected_package(self):
        with self.assertRaises((delivery.DeliveryError, OSError)):
            self.build_package()
        self.assertFalse(self.output.exists())

    def rewrite(self, path, mutate):
        with zipfile.ZipFile(path) as archive:
            entries = [(info, archive.read(info)) for info in archive.infolist()]
        entries = mutate(entries)
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path, 'w') as archive:
                for info, data in entries:
                    archive.writestr(info, data)

    def edit_json(self, path, target, update):
        def mutate(entries):
            result = []
            for info, data in entries:
                if info.filename == target:
                    value = json.loads(data)
                    update(value)
                    data = delivery.encode(value)
                result.append((info, data))
            return result
        self.rewrite(path, mutate)

    def append(self, path, name, data=b'extra', mode=0o100644):
        info = zipfile.ZipInfo(name)
        info.create_system = 3
        info.external_attr = mode << 16
        self.rewrite(path, lambda entries: entries + [(info, data)])

    def test_round_trip_without_historical_blob_contents(self):
        result = self.build_package()
        self.assertFalse(result['exactGitTree'])
        self.assertEqual(len(result['sourceExclusions']), len(delivery.PREFIXES))
        excluded = {row['path']: row for row in result['sourceExclusions']}
        for name in self.history:
            self.assertEqual(excluded[name]['reason'], 'historical-prefix:' + name.rsplit('/', 1)[0] + '/')
            self.assertRegex(excluded[name]['gitBlob'], r'^[a-f0-9]{40}$')
            self.assertEqual(excluded[name]['mode'], '100644')
        destination = self.root / 'verified'
        checked = self.verify(destination)
        self.assertTrue(checked['safeExtraction'])
        self.assertTrue(checked['expectedTreeMetadataMatchesPinnedCommit'])
        self.assertFalse(checked['exactGitTreeReconstructed'])
        self.assertFalse(checked['compiledEquivalenceVerified'])
        self.assertEqual(checked['sourceFiles'], 7)
        self.assertTrue((destination / 'source/Workspace-Agent/scripts/check.sh').stat().st_mode & stat.S_IXUSR)
        self.assertFalse((destination / 'source/Workspace-Agent/.git').exists())
        for name in self.history:
            self.assertFalse((destination / 'source/Workspace-Agent' / name).exists())

    def test_required_validation_fixture_is_included(self):
        self.build_package()
        source = delivery.decode((self.output / 'SOURCE-MANIFEST.json').read_bytes())
        names = {row['path'] for row in source['files']}
        self.assertIn('docs/validation/managed-commerce-sources.json', names)
        self.assertEqual(source['requiredInclusions'], list(delivery.REQUIRED_INCLUSIONS))

    def test_missing_required_validation_fixture_fails(self):
        (self.repo / 'docs/validation/managed-commerce-sources.json').unlink()
        self.rejected_package()

    def test_missing_current_source_fails(self):
        (self.repo / 'README.md').unlink()
        self.rejected_package()

    def test_altered_current_source_fails(self):
        (self.repo / 'README.md').write_bytes(b'Changed')
        self.rejected_package()

    def test_altered_current_source_mode_fails(self):
        (self.repo / 'scripts/check.sh').chmod(0o644)
        self.rejected_package()

    def test_source_symlink_fails(self):
        path = self.repo / 'README.md'
        original = path.read_bytes()
        path.unlink()
        self.put(self.root / 'original', original)
        path.symlink_to(self.root / 'original')
        self.rejected_package()

    def test_source_parent_symlink_fails(self):
        source = self.repo / 'scripts'
        source.rename(self.root / 'scripts')
        source.symlink_to(self.root / 'scripts', target_is_directory=True)
        self.rejected_package()

    def test_untracked_private_files_never_collected(self):
        self.put(self.repo / '.env', b'SECRET=do-not-package')
        self.put(self.repo / '.data/users.db', b'private fixture')
        self.build_package()
        with zipfile.ZipFile(self.source) as archive:
            self.assertFalse(any(name.endswith(('.env', 'users.db')) for name in archive.namelist()))

    def test_mutable_ref_is_rejected(self):
        self.commit = 'HEAD'
        self.rejected_package()

    def test_tracked_secret_and_runtime_paths_rejected(self):
        for name, content in [('.env', b'PRIVATE=example'), ('records.sqlite', b'runtime'),
                              ('credential.txt', b'sk-proj-' + b'a' * 50)]:
            with self.subTest(name=name):
                self.put(self.repo / name, content)
                self.commit_all()
                self.rejected_package()
                (self.repo / name).unlink()

    def test_compiled_missing_and_extra_files_rejected(self):
        self.put(self.compiled / 'unexpected.json', b'{}')
        self.rejected_package()
        (self.compiled / 'unexpected.json').unlink()
        (self.compiled / 'app.json').unlink()
        self.rejected_package()

    def test_compiled_copied_asset_must_match_git_source(self):
        (self.compiled / 'assets/icon.svg').write_bytes(b'<svg changed="yes"/>')
        self.rejected_package()

    def test_compiled_symlink_rejected(self):
        (self.compiled / 'other').symlink_to(self.repo / 'README.md')
        self.rejected_package()

    def test_compiled_directory_symlink_rejected(self):
        (self.compiled / 'other').symlink_to(self.repo / 'scripts', target_is_directory=True)
        self.rejected_package()

    def test_live_appid_urlcheck_and_base_url_rejected(self):
        config_path = self.compiled / 'project.config.json'
        original = config_path.read_bytes()
        for key, value in [('appid', 'wx-real-account'), ('setting', {'urlCheck': False}),
                           ('miniprogramRoot', '../outside')]:
            with self.subTest(key=key):
                config = json.loads(original)
                config[key] = value
                config_path.write_bytes(delivery.encode(config))
                self.rejected_package()
        config_path.write_bytes(original)
        for app in [b"const baseUrl = 'https://example.invalid';\n", b"const baseUrl = ''; baseUrl = 'live';\n",
                    b"const baseUrl = process.env.URL;\n"]:
            with self.subTest(app=app):
                (self.compiled / 'app.js').write_bytes(app)
                self.rejected_package()

    def test_output_directory_cannot_be_overwritten(self):
        self.output.mkdir()
        self.put(self.output / 'keep', b'keep')
        with self.assertRaises(delivery.DeliveryError):
            self.build_package()
        self.assertEqual((self.output / 'keep').read_bytes(), b'keep')

    def test_extraction_directory_cannot_be_overwritten(self):
        self.build_package()
        existing = self.root / 'existing'
        existing.mkdir()
        with self.assertRaises(delivery.DeliveryError):
            self.verify(existing)
        self.assertEqual(list(existing.iterdir()), [])

    def test_destination_symlink_ancestor_rejected(self):
        self.build_package()
        (self.root / 'alias').symlink_to(self.repo, target_is_directory=True)
        with self.assertRaises(delivery.DeliveryError):
            self.verify(self.root / 'alias/extracted')
        self.assertFalse((self.repo / 'extracted').exists())

    def test_unlisted_file_rejected_before_extraction(self):
        self.build_package()
        self.append(self.source, 'Workspace-Agent/unlisted.txt')
        destination = self.root / 'extracted'
        with self.assertRaises(delivery.DeliveryError):
            self.verify(destination)
        self.assertFalse(destination.exists())

    def test_missing_listed_file_rejected(self):
        self.build_package()
        self.rewrite(self.source, lambda entries: [(info, data) for info, data in entries
                                                  if info.filename != 'Workspace-Agent/README.md'])
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_tampered_source_file_rejected(self):
        self.build_package()
        self.rewrite(self.source, lambda entries: [(info, b'altered' if info.filename == 'Workspace-Agent/README.md' else data)
                                                  for info, data in entries])
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_tampered_source_and_rehashed_manifest_rejected(self):
        self.build_package()
        data = b'altered'
        self.rewrite(self.source, lambda entries: [(info, data if info.filename == 'Workspace-Agent/README.md' else body)
                                                  for info, body in entries])
        def update(manifest):
            for row in manifest['files']:
                if row['path'] == 'README.md':
                    row.update(bytes=len(data), sha256=delivery.sha256(data), gitBlob=delivery.git_hash('blob', data))
        self.edit_json(self.source, 'SOURCE-MANIFEST.json', update)
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_historical_exclusion_tampering_rejected(self):
        self.build_package()
        self.edit_json(self.source, 'SOURCE-MANIFEST.json',
                       lambda manifest: manifest['sourceExclusions'][0].update(reason='missing locally'))
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_historical_exclusion_omission_rejected(self):
        self.build_package()
        self.edit_json(self.client, 'BUILD-MANIFEST.json', lambda manifest: manifest['sourceExclusions'].pop())
        # Even if the ZIP checksum is known, its exclusion claims must be exact.
        self.summary['client']['sha256'] = delivery.sha256(self.client.read_bytes())
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_missing_included_path_cannot_be_declared_excluded(self):
        self.build_package()
        def update(manifest):
            row = next(row for row in manifest['files'] if row['path'] == 'README.md')
            manifest['files'].remove(row)
            manifest['sourceExclusions'].append({key: row[key] for key in ('path', 'mode', 'gitBlob')})
        self.edit_json(self.source, 'SOURCE-MANIFEST.json', update)
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_wrong_selected_commit_and_expected_tree_rejected(self):
        self.build_package()
        with self.assertRaises(delivery.DeliveryError):
            delivery.verify(self.source, self.client, self.expected, '0' * 40, self.summary['client']['sha256'])
        expected = json.loads(self.expected.read_bytes())
        expected['files'][0]['gitBlob'] = '0' * 40
        self.expected.write_bytes(delivery.encode(expected))
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_source_and_client_must_name_same_tree(self):
        self.build_package()
        self.edit_json(self.client, 'BUILD-MANIFEST.json', lambda manifest: manifest.update(sourceTree='0' * 40))
        self.summary['client']['sha256'] = delivery.sha256(self.client.read_bytes())
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_original_commit_tampering_rejected(self):
        self.build_package()
        self.rewrite(self.source, lambda entries: [(info, data + b'x' if info.filename == 'ORIGINAL-COMMIT.txt' else data)
                                                  for info, data in entries])
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_client_tampering_even_with_rehashed_manifest_rejected(self):
        self.build_package()
        changed = b"const baseUrl = '';\n// changed client\n"
        self.rewrite(self.client, lambda entries: [(info, changed if info.filename == 'app.js' else data)
                                                  for info, data in entries])
        def update(manifest):
            for row in manifest['files']:
                if row['path'] == 'app.js':
                    row.update(bytes=len(changed), sha256=delivery.sha256(changed))
        self.edit_json(self.client, 'BUILD-MANIFEST.json', update)
        with self.assertRaisesRegex(delivery.DeliveryError, 'Pinned client ZIP'):
            self.verify()

    def test_hostile_archive_paths_duplicates_symlinks_and_modes(self):
        self.build_package()
        original = self.source.read_bytes()
        cases = [('../escape', 0o100644), ('/absolute', 0o100644), ('C:/drive', 0o100644),
                 ('bad\\path', 0o100644), ('a//b', 0o100644), ('a/./b', 0o100644),
                 ('folder/', 0o040755), ('link', 0o120777), ('fifo', 0o010644),
                 ('bad-mode', 0o100777), ('Workspace-Agent/README.md', 0o100644),
                 ('workspace-agent/readme.MD', 0o100644), ('con.txt', 0o100644),
                 ('Workspace-Agent/README.md/child', 0o100644)]
        for name, mode in cases:
            with self.subTest(name=name):
                self.source.write_bytes(original)
                self.append(self.source, name, mode=mode)
                with self.assertRaises(delivery.DeliveryError):
                    self.verify()

    def test_duplicate_json_keys_rejected(self):
        with self.assertRaises(delivery.DeliveryError):
            delivery.decode(b'{"a":1,"a":2}')

    def test_manifest_boolean_types_are_not_interchangeable_with_integers(self):
        self.build_package()
        self.edit_json(self.source, 'SOURCE-MANIFEST.json', lambda manifest: manifest.update(exactGitTree=0))
        with self.assertRaises(delivery.DeliveryError):
            self.verify()

    def test_packaging_is_reproducible(self):
        self.build_package()
        second = delivery.package(self.repo, self.commit, self.compiled, self.root / 'package-again')
        self.assertEqual(second, self.summary)

    def test_cli_package_verify_and_help(self):
        package_command = [sys.executable, str(SCRIPTS / 'package-portable-checkpoint.py'),
                           '--repository', str(self.repo), '--commit', self.commit,
                           '--compiled', str(self.compiled), '--output', str(self.output)]
        self.summary = json.loads(subprocess.check_output(package_command))
        self.source = self.output / self.summary['source']['file']
        self.client = self.output / self.summary['client']['file']
        self.expected = self.output / 'EXPECTED-GIT-TREE.json'
        report = self.root / 'record.json'
        command = [sys.executable, str(SCRIPTS / 'verify-portable-checkpoint.py'),
                   '--source', str(self.source), '--client', str(self.client), '--expected-tree', str(self.expected),
                   '--commit', self.commit, '--client-sha256', self.summary['client']['sha256'],
                   '--destination', str(self.root / 'extracted'), '--record', str(report)]
        checked = json.loads(subprocess.check_output(command))
        self.assertEqual(json.loads(report.read_bytes()), checked)
        self.assertTrue(checked['safeExtraction'])
        again = subprocess.run(command, capture_output=True)
        self.assertEqual(again.returncode, 1)
        for script in ('package-portable-checkpoint.py', 'verify-portable-checkpoint.py'):
            self.assertIn(b'--commit', subprocess.check_output([sys.executable, str(SCRIPTS / script), '--help']))


if __name__ == '__main__':
    unittest.main()
