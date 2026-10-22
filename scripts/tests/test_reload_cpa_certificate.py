"""Offline regression tests for the macOS CPA certificate reload guard.

All files belong to a temporary fixture. No real launch agent, certificate,
credential, subprocess or network endpoint is accessed, including on Windows.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import ssl
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.dont_write_bytecode = True


def load_reloader():
    source = Path(__file__).resolve().parents[1] / 'reload-cpa-certificate.py'
    spec = importlib.util.spec_from_file_location('cpa_certificate_reloader_test', source)
    module = importlib.util.module_from_spec(spec)
    # fcntl is absent on Windows. Only main() uses it; mock its documented
    # constants and flock API so both reconcile() and main() can run offline.
    try:
        import fcntl  # noqa: F401
        replacement = {}
    except ImportError:
        replacement = {'fcntl': types.SimpleNamespace(
            LOCK_EX=2, LOCK_NB=4, flock=mock.Mock())}
    with mock.patch.dict(sys.modules, replacement):
        spec.loader.exec_module(module)
    return module


reloader = load_reloader()


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='test-cpa-reload-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / 'home'
        pair = self.root / 'certificate-pair'
        state = self.root / 'state'
        pair.mkdir()
        state.mkdir()
        self.cert = pair / 'fullchain.pem'
        self.key = pair / 'privkey.pem'
        self.cert.write_bytes(
            b'-----BEGIN CERTIFICATE-----\nfixture-leaf\n-----END CERTIFICATE-----\n'
            b'-----BEGIN CERTIFICATE-----\nfixture-chain\n-----END CERTIFICATE-----\n')
        self.key.write_text('fixture-private-key-not-real')
        self.config = self.root / 'config.yaml'
        self.config.write_text(
            'tls:\n  enable: true\n  cert: "' + str(self.cert)
            + '"\n  key: "' + str(self.key) + '"\n')
        self.args = types.SimpleNamespace(
            label='test.cpa', config=self.config, cert=self.cert, key=self.key,
            state_dir=state, port=18317, domain='cpa.example.test', check_only=False)
        self.plist = self.home / 'Library' / 'LaunchAgents' / 'test.cpa.plist'
        self.plist.parent.mkdir(parents=True)
        self.plist.write_bytes(plistlib.dumps({
            'Label': self.args.label,
            'ProgramArguments': ['fixture-cpa', '-config', str(self.config)]}))
        self.marker = state / 'cpa-cert-reload-attempt.json'
        self.expected = hashlib.sha256(b'fixture-leaf-der').hexdigest()
        self.patch(reloader.Path, 'home', return_value=self.home)
        self.patch(reloader.os, 'getuid', return_value=501, create=True)
        self.patch(reloader.os, 'geteuid', return_value=501, create=True)
        self.patch(reloader.ssl, 'PEM_cert_to_DER_cert', return_value=b'fixture-leaf-der')
        self.decode = self.patch(reloader.ssl._ssl, '_test_decode_cert', return_value={
            'subjectAltName': (('DNS', self.args.domain),)})
        self.command = self.patch(reloader, 'command', side_effect=self.fake_command)
        self.probe = self.patch(reloader, 'probe', side_effect=[
            ('old-certificate-fingerprint', False), (self.expected, True)])
        self.busy = self.patch(reloader, 'busy', return_value=False)
        self.sleep = self.patch(reloader.time, 'sleep')
        self.patch(reloader.time, 'time', return_value=10_000)
        # Fail closed if a future implementation escapes a mocked boundary.
        self.patch(reloader.subprocess, 'run', side_effect=AssertionError('real subprocess forbidden'))
        self.patch(reloader.socket, 'create_connection', side_effect=AssertionError('real network forbidden'))

    def patch(self, target, name, **kwargs):
        patcher = mock.patch.object(target, name, **kwargs)
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def fake_command(self, argv):
        if argv[:2] == ['/usr/bin/openssl', 'x509']:
            if '-checkend' in argv:
                return b''
            if '-pubkey' in argv:
                return b'fixture-public-key\n'
        if argv[:2] == ['/usr/bin/openssl', 'pkey']:
            return b'fixture-public-key\n'
        if argv[:2] == ['/usr/bin/openssl', 'verify']:
            self.assertIn('-purpose', argv)
            self.assertEqual(argv[argv.index('-purpose') + 1], 'sslserver')
            self.assertEqual(argv[argv.index('-CAfile') + 1], '/etc/ssl/cert.pem')
            self.assertIn(b'fixture-chain', Path(argv[argv.index('-untrusted') + 1]).read_bytes())
            self.assertIn(b'fixture-leaf', Path(argv[-1]).read_bytes())
            return b'fixture-chain-ok'
        if argv == ['/bin/launchctl', 'print', 'gui/501/test.cpa']:
            return b'fixture service = {\n\tpid = 123\n}\n'
        if argv == ['/usr/sbin/lsof', '-nP', '-t', '-a', '-p', '123',
                    '-iTCP:' + str(self.args.port), '-sTCP:LISTEN']:
            return b'123\n'
        if argv == ['/bin/launchctl', 'kickstart', '-k', 'gui/501/test.cpa']:
            return b''
        self.fail('unexpected local command: ' + repr(argv))

    def restarts(self):
        return [entry for entry in self.command.call_args_list
                if entry.args[0][:2] == ['/bin/launchctl', 'kickstart']]

    def assert_deferred(self, event):
        self.assertEqual(reloader.reconcile(self.args), {'event': event})
        self.assertEqual(self.restarts(), [])
        self.assertFalse(self.marker.exists())
        self.assertEqual(self.probe.call_count, 1)

    def test_current_trusted_certificate_never_restarts(self):
        self.probe.side_effect = None
        self.probe.return_value = (self.expected, True)
        self.assertEqual(reloader.reconcile(self.args), {
            'event': 'current', 'fingerprint': self.expected})
        self.command.assert_not_called()
        self.busy.assert_not_called()
        self.sleep.assert_not_called()
        self.assertFalse(self.marker.exists())

    def test_matching_but_untrusted_certificate_is_not_current(self):
        self.probe.side_effect = None
        self.probe.return_value = (self.expected, False)
        with self.assertRaisesRegex(RuntimeError, '^served-certificate-not-trusted$'):
            reloader.reconcile(self.args)
        self.command.assert_not_called()

    def test_busy_first_inspection_defers_without_restart_or_marker(self):
        self.busy.return_value = True
        self.assert_deferred('busy-deferred')
        self.busy.assert_called_once_with(self.args.port, '123')
        self.sleep.assert_not_called()

    def test_connection_opened_during_grace_period_defers(self):
        self.busy.side_effect = [False, True]
        self.assert_deferred('busy-deferred')
        self.assertEqual(self.busy.call_count, 2)
        self.sleep.assert_called_once_with(2)

    def test_same_fingerprint_with_recent_attempt_obeys_cooldown(self):
        previous = {'fingerprint': self.expected, 'attemptedAt': 9_999}
        self.marker.write_text(json.dumps(previous))
        self.assertEqual(reloader.reconcile(self.args), {'event': 'retry-cooldown'})
        self.assertEqual(json.loads(self.marker.read_text()), previous)
        self.assertEqual(self.restarts(), [])
        self.busy.assert_not_called()

    def test_expired_or_different_attempt_does_not_block_new_reload(self):
        for fingerprint, attempted_at in [(self.expected, 6_400), ('other-certificate', 9_999)]:
            with self.subTest(fingerprint=fingerprint, attempted_at=attempted_at):
                self.marker.write_text(json.dumps({
                    'fingerprint': fingerprint, 'attemptedAt': attempted_at}))
                self.probe.side_effect = [('old', False), (self.expected, True)]
                self.assertEqual(reloader.reconcile(self.args)['event'], 'reloaded')

    def test_check_only_validates_chain_without_restart_or_marker(self):
        self.args.check_only = True
        self.assertEqual(reloader.reconcile(self.args), {
            'event': 'reload-needed', 'fingerprint': self.expected})
        self.assertTrue(any(call.args[0][1] == 'verify' for call in self.command.call_args_list))
        self.assertEqual(self.restarts(), [])
        self.busy.assert_not_called()
        self.assertFalse(self.marker.exists())

    def test_config_changed_during_grace_period_defers(self):
        def change_config(_seconds):
            self.config.write_text(self.config.read_text() + '# concurrent edit\n')
        self.sleep.side_effect = change_config
        self.assert_deferred('config-change-deferred')

    def test_certificate_changed_during_grace_period_defers(self):
        def change_certificate(_seconds):
            self.cert.write_bytes(self.cert.read_bytes() + b'\nchanged\n')
        self.sleep.side_effect = change_certificate
        self.assert_deferred('certificate-change-deferred')

    def test_success_requires_new_fingerprint_and_strict_trust(self):
        def restart_checks_marker(argv):
            if argv[:2] == ['/bin/launchctl', 'kickstart']:
                self.assertEqual(json.loads(self.marker.read_text()), {
                    'fingerprint': self.expected, 'attemptedAt': 10_000})
            return self.fake_command(argv)
        self.command.side_effect = restart_checks_marker
        self.assertEqual(reloader.reconcile(self.args), {
            'event': 'reloaded', 'fingerprint': self.expected})
        self.assertEqual(len(self.restarts()), 1)
        self.assertEqual(self.probe.call_args_list, [
            mock.call(self.args.port, self.args.domain),
            mock.call(self.args.port, self.args.domain)])
        commands = [call.args[0] for call in self.command.call_args_list]
        self.assertLess(next(i for i, args in enumerate(commands) if args[1] == 'verify'),
                        next(i for i, args in enumerate(commands) if args[:2] == ['/bin/launchctl', 'kickstart']))

    def test_reload_does_not_report_success_for_untrusted_or_old_certificate(self):
        for result in [(self.expected, False), ('old-certificate', True)]:
            with self.subTest(result=result):
                if self.marker.exists():
                    self.marker.unlink()
                self.command.reset_mock()
                self.probe.reset_mock()
                self.probe.side_effect = [('old-certificate', False)] + [result] * 20
                with self.assertRaisesRegex(RuntimeError, '^reload-strict-tls-verification-failed$'):
                    reloader.reconcile(self.args)
                self.assertEqual(len(self.restarts()), 1)
                self.assertEqual(self.probe.call_count, 21)
                self.assertEqual(json.loads(self.marker.read_text())['fingerprint'], self.expected)

    def test_reload_connection_errors_are_retried_then_fail_closed(self):
        self.probe.side_effect = [('old', False)] + [OSError('fixture-offline')] * 20
        with self.assertRaisesRegex(RuntimeError, '^reload-strict-tls-verification-failed$'):
            reloader.reconcile(self.args)
        self.assertEqual(self.probe.call_count, 21)
        self.assertEqual(len(self.restarts()), 1)
        self.assertTrue(self.marker.exists())

    def test_restart_command_failure_retains_cooldown_marker(self):
        def reject_restart(argv):
            if argv[:2] == ['/bin/launchctl', 'kickstart']:
                raise RuntimeError('local-command-failed')
            return self.fake_command(argv)
        self.command.side_effect = reject_restart
        with self.assertRaisesRegex(RuntimeError, '^local-command-failed$'):
            reloader.reconcile(self.args)
        self.assertTrue(self.marker.exists())
        self.probe.side_effect = [('old-certificate', False)]
        self.assertEqual(reloader.reconcile(self.args), {'event': 'retry-cooldown'})
        self.assertEqual(len(self.restarts()), 1)

    def test_job_config_guard_rejects_other_configuration(self):
        self.plist.write_bytes(plistlib.dumps({
            'Label': self.args.label, 'ProgramArguments': ['fixture-cpa', '-config', 'other.yaml']}))
        with self.assertRaisesRegex(RuntimeError, '^cpa-job-config-mismatch$'):
            reloader.reconcile(self.args)
        self.command.assert_not_called()
        self.probe.assert_not_called()

    def test_tls_path_guard_rejects_reconfigured_certificates(self):
        self.config.write_text(self.config.read_text().replace(str(self.cert), 'other-fullchain.pem'))
        with self.assertRaisesRegex(RuntimeError, '^cpa-tls-path-changed$'):
            reloader.reconcile(self.args)
        self.probe.assert_not_called()
        self.command.assert_not_called()

    def test_service_identity_must_match_the_listening_process(self):
        for status, listener, reason in [
            (b'fixture service without a pid', b'123\n', 'cpa-job-not-running'),
            (b'\tpid = 123\n', b'999\n', 'cpa-listener-identity-mismatch'),
            (b'\tpid = 123\n', b'123\n999\n', 'cpa-listener-identity-mismatch')
        ]:
            with self.subTest(reason=reason, listener=listener):
                self.probe.side_effect = [('old', False)]
                def identity_command(argv):
                    if argv[:2] == ['/bin/launchctl', 'print']:
                        return status
                    if argv[0] == '/usr/sbin/lsof':
                        return listener
                    return self.fake_command(argv)
                self.command.side_effect = identity_command
                with self.assertRaisesRegex(RuntimeError, '^' + reason + '$'):
                    reloader.reconcile(self.args)
                self.assertEqual(self.restarts(), [])
                self.assertFalse(self.marker.exists())
        self.busy.assert_not_called()

    def test_wrong_domain_or_missing_chain_never_restarts(self):
        self.decode.return_value = {'subjectAltName': (('DNS', 'other.example.test'),)}
        with self.assertRaisesRegex(RuntimeError, '^certificate-domain-mismatch$'):
            reloader.reconcile(self.args)
        self.assertEqual(self.restarts(), [])
        self.decode.return_value = {'subjectAltName': (('DNS', self.args.domain),)}
        self.cert.write_bytes(b'-----BEGIN CERTIFICATE-----\nleaf\n-----END CERTIFICATE-----\n')
        self.probe.side_effect = [('old', False)]
        with self.assertRaisesRegex(RuntimeError, '^full-certificate-chain-required$'):
            reloader.reconcile(self.args)
        self.assertEqual(self.restarts(), [])
        self.busy.assert_not_called()

    def test_invalid_chain_never_restarts_or_writes_marker(self):
        def reject_chain(argv):
            if argv[:2] == ['/usr/bin/openssl', 'verify']:
                raise RuntimeError('local-command-failed')
            return self.fake_command(argv)
        self.command.side_effect = reject_chain
        with self.assertRaisesRegex(RuntimeError, '^local-command-failed$'):
            reloader.reconcile(self.args)
        self.assertEqual(self.restarts(), [])
        self.assertFalse(self.marker.exists())
        self.busy.assert_not_called()

    def test_marker_replace_failure_never_restarts_and_cleans_temporary_file(self):
        previous = {'fingerprint': 'previous', 'attemptedAt': 1}
        self.marker.write_text(json.dumps(previous))
        with mock.patch.object(reloader.os, 'replace', side_effect=OSError('fixture-disk-error')):
            with self.assertRaisesRegex(OSError, '^fixture-disk-error$'):
                reloader.reconcile(self.args)
        self.assertEqual(json.loads(self.marker.read_text()), previous)
        self.assertEqual(list(self.args.state_dir.glob('.cpa-reload-attempt-*')), [])
        self.assertEqual(self.restarts(), [])

    def test_root_and_mixed_uid_are_rejected_before_file_or_network_access(self):
        for uid, effective in [(0, 0), (501, 0)]:
            with self.subTest(uid=uid, effective=effective):
                with mock.patch.object(reloader.os, 'getuid', return_value=uid), \
                     mock.patch.object(reloader.os, 'geteuid', return_value=effective):
                    with self.assertRaisesRegex(RuntimeError, '^run-as-cpa-login-user$'):
                        reloader.reconcile(self.args)
        self.probe.assert_not_called()
        self.command.assert_not_called()

    def test_main_returns_failure_without_leaking_unexpected_error_details(self):
        argv = ['reload-cpa-certificate.py', '--config', str(self.config), '--cert', str(self.cert),
                '--key', str(self.key), '--state-dir', str(self.args.state_dir),
                '--label', self.args.label, '--domain', self.args.domain]
        output = io.StringIO()
        with mock.patch.object(sys, 'argv', argv), \
             mock.patch.object(reloader.fcntl, 'flock'), \
             mock.patch.object(reloader.os, 'umask'), \
             mock.patch.object(reloader, 'reconcile', side_effect=ValueError('sensitive fixture contents')), \
             contextlib.redirect_stdout(output):
            self.assertEqual(reloader.main(), 1)
        self.assertEqual(json.loads(output.getvalue()), {'event': 'check-failed', 'reason': 'ValueError'})


if __name__ == '__main__':
    unittest.main()
