#!/usr/bin/env python3
"""Reload an idle macOS CPA after its managed TLS certificate changes.

No API credentials are read. TLS inspection never sends application data;
success always requires normal CA and hostname verification.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import socket
import ssl
import subprocess
import tempfile
import time


def command(args):
    result = subprocess.run(args, capture_output=True, timeout=10)
    if result.returncode:
        raise RuntimeError('local-command-failed')
    return result.stdout


def probe(port, domain):
    context = ssl.create_default_context(cafile='/etc/ssl/cert.pem')
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=3) as raw:
            with context.wrap_socket(raw, server_hostname=domain) as secure:
                return hashlib.sha256(secure.getpeercert(binary_form=True)).hexdigest(), True
    except ssl.SSLCertVerificationError:
        # Certificate metadata only. No HTTP requests or credentials use this context.
        inspect = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        inspect.check_hostname = False
        inspect.verify_mode = ssl.CERT_NONE
        with socket.create_connection(('127.0.0.1', port), timeout=3) as raw:
            with inspect.wrap_socket(raw, server_hostname=domain) as secure:
                return hashlib.sha256(secure.getpeercert(binary_form=True)).hexdigest(), False


def busy(port, pid):
    result = subprocess.run(['/usr/sbin/lsof', '-nP', '-t', '-a', '-p', str(pid), '-iTCP:' + str(port),
                             '-sTCP:ESTABLISHED'], capture_output=True, timeout=10)
    if result.returncode not in (0, 1) or result.stderr:
        raise RuntimeError('connection-inspection-failed')
    return bool(result.stdout.strip())


def reconcile(args):
    uid = os.getuid()
    if uid == 0 or os.geteuid() != uid:
        raise RuntimeError('run-as-cpa-login-user')
    plist = Path.home() / 'Library/LaunchAgents' / (args.label + '.plist')
    job = plistlib.loads(plist.read_bytes())
    argv = job.get('ProgramArguments', [])
    if job.get('Label') != args.label or not any(
        item in ('-config', '--config') and Path(argv[i + 1]).resolve() == args.config.resolve()
        for i, item in enumerate(argv[:-1])
    ):
        raise RuntimeError('cpa-job-config-mismatch')
    cfg = args.config.read_text()
    match = re.search(r'^tls:\s*\n((?:[ \t]+[^\n]*\n|[ \t]*\n)*)', cfg, re.M)
    tls = match.group(1) if match else ''
    for name, value in [('cert', args.cert), ('key', args.key)]:
        line = re.search(r'^\s+' + name + r':\s*"([^"\n]+)"\s*$', tls, re.M)
        if not line or Path(line.group(1)) != value:
            raise RuntimeError('cpa-tls-path-changed')
    if not re.search(r'^\s+enable:\s*true\s*$', tls, re.M):
        raise RuntimeError('cpa-tls-disabled')
    cert, key = args.cert.resolve(strict=True), args.key.resolve(strict=True)
    if cert.parent != key.parent:
        raise RuntimeError('certificate-pair-not-atomic')
    pem = cert.read_bytes()
    leaf = pem[:pem.index(b'-----END CERTIFICATE-----') + len(b'-----END CERTIFICATE-----')]
    expected = hashlib.sha256(ssl.PEM_cert_to_DER_cert(leaf.decode())).hexdigest()
    served, trusted = probe(args.port, args.domain)
    if served == expected:
        if not trusted:
            raise RuntimeError('served-certificate-not-trusted')
        return {'event': 'current', 'fingerprint': expected}
    command(['/usr/bin/openssl', 'x509', '-in', str(cert), '-checkend', '86400', '-noout'])
    decoded = ssl._ssl._test_decode_cert(str(cert))
    if ('DNS', args.domain) not in decoded.get('subjectAltName', ()):
        raise RuntimeError('certificate-domain-mismatch')
    public = command(['/usr/bin/openssl', 'x509', '-in', str(cert), '-pubkey', '-noout'])
    if public != command(['/usr/bin/openssl', 'pkey', '-in', str(key), '-pubout']):
        raise RuntimeError('certificate-key-mismatch')
    certificates = re.findall(br'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', pem, re.S)
    if len(certificates) < 2:
        raise RuntimeError('full-certificate-chain-required')
    with tempfile.TemporaryDirectory(prefix='.cpa-chain-', dir=str(args.state_dir)) as directory:
        leaf_path, chain_path = Path(directory) / 'leaf.pem', Path(directory) / 'chain.pem'
        leaf_path.write_bytes(certificates[0] + b'\n')
        chain_path.write_bytes(b'\n'.join(certificates[1:]) + b'\n')
        command(['/usr/bin/openssl', 'verify', '-purpose', 'sslserver', '-CAfile', '/etc/ssl/cert.pem',
                 '-untrusted', str(chain_path), str(leaf_path)])
    if args.check_only:
        return {'event': 'reload-needed', 'fingerprint': expected}
    marker = args.state_dir / 'cpa-cert-reload-attempt.json'
    if marker.exists():
        previous = json.loads(marker.read_text())
        if previous.get('fingerprint') == expected and time.time() - previous['attemptedAt'] < 3600:
            return {'event': 'retry-cooldown'}
    job_status = command(['/bin/launchctl', 'print', 'gui/' + str(uid) + '/' + args.label]).decode()
    identity = re.search(r'^\s+pid = ([1-9][0-9]*)\s*$', job_status, re.M)
    if not identity:
        raise RuntimeError('cpa-job-not-running')
    pid = identity.group(1)
    listeners = command(['/usr/sbin/lsof', '-nP', '-t', '-a', '-p', pid,
                         '-iTCP:' + str(args.port), '-sTCP:LISTEN']).decode().split()
    if listeners != [pid]:
        raise RuntimeError('cpa-listener-identity-mismatch')
    if busy(args.port, pid):
        return {'event': 'busy-deferred'}
    time.sleep(2)
    if busy(args.port, pid):
        return {'event': 'busy-deferred'}
    if args.cert.resolve() != cert or args.key.resolve() != key or cert.read_bytes() != pem:
        return {'event': 'certificate-change-deferred'}
    if args.config.read_text() != cfg:
        return {'event': 'config-change-deferred'}
    # Record before restart to avoid a restart loop if strict verification fails.
    descriptor, temporary = tempfile.mkstemp(prefix='.cpa-reload-attempt-', dir=str(args.state_dir))
    try:
        with os.fdopen(descriptor, 'w') as output:
            json.dump({'fingerprint': expected, 'attemptedAt': time.time()}, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, marker)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    command(['/bin/launchctl', 'kickstart', '-k', 'gui/' + str(uid) + '/' + args.label])
    for _ in range(20):
        try:
            actual, trusted = probe(args.port, args.domain)
            if trusted and actual == expected:
                return {'event': 'reloaded', 'fingerprint': expected}
        except (OSError, ssl.SSLError):
            pass
        time.sleep(.5)
    raise RuntimeError('reload-strict-tls-verification-failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['config', 'cert', 'key', 'state-dir']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--domain', required=True)
    parser.add_argument('--port', type=int, default=8317)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        with (args.state_dir / 'cpa-cert-reload.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                print(json.dumps({'event': 'already-running'}))
                return 0
            print(json.dumps(reconcile(args)))
        return 0
    except Exception as error:
        # Fixed local codes only: never disclose subprocess logs or config contents.
        reason = str(error) if type(error) is RuntimeError else type(error).__name__
        print(json.dumps({'event': 'check-failed', 'reason': reason}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
