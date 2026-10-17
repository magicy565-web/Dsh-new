import unittest
from pathlib import Path
import yaml
ROOT = Path(__file__).resolve().parents[2]
class EntryContracts(unittest.TestCase):
    def test_backends_have_no_ports_or_external_network(self):
        for project, names in [('docling', ['docling']), ('medusa', ['api','postgres','redis'])]:
            base = yaml.safe_load((ROOT / f'acceptance/{project}/compose.yaml').read_text())
            for name in names:
                service = base['services'][name]
                self.assertNotIn('ports', service)
                self.assertTrue(all(base['networks'][n]['internal'] for n in service['networks']))
    def test_database_network_unreachable_from_ui(self):
        base = yaml.safe_load((ROOT / 'acceptance/medusa/compose.yaml').read_text())
        services = base['services']
        self.assertEqual(services['ui']['networks'], ['frontend','ingress'])
        self.assertTrue(base['networks']['frontend']['internal'])
        for db in ['postgres','redis']:
            self.assertFalse(set(services[db]['networks']) & set(services['ui']['networks']))
        self.assertEqual(services['api']['networks'], ['private','frontend'])
    def test_pinned_unprivileged_loopback_proxies(self):
        for project, name in [('docling','ingress'), ('medusa','ui')]:
            base = yaml.safe_load((ROOT / f'acceptance/{project}/compose.yaml').read_text())
            service = base['services'][name]
            self.assertEqual(service['user'], '101:101')
            self.assertTrue(service['read_only'])
            self.assertEqual(service['cap_drop'], ['ALL'])
            self.assertNotIn('secrets', service)
            self.assertTrue(all(p.startswith('127.0.0.1:') for p in service['ports']))
    def test_live_checker_refuses_missing_docker(self):
        import importlib.util
        from unittest.mock import patch
        spec = importlib.util.spec_from_file_location('live', ROOT / 'acceptance/ingress/check.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with patch.object(module.subprocess, 'check_output', side_effect=FileNotFoundError):
            with self.assertRaises(FileNotFoundError): module.run('docling')
if __name__ == '__main__': unittest.main()
