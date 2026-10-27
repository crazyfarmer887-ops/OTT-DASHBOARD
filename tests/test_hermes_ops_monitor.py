import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'deploy/hermes_ops/monitor.py'
spec = importlib.util.spec_from_file_location('ops_monitor', SOURCE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
NOW = 1793100000


class OperationsMonitorTests(unittest.TestCase):
    def data(self, **values):
        return {'ok': True, 'enabled': True, 'safeMode': False, 'renewals': [], **values}

    def row(self, **values):
        return {'enabled': True, 'trigger': 'rank', 'rankThreshold': 5,
            'nextAt': '2026-10-27T12:00:00Z', **values}

    def test_healthy_and_unchanged_are_quiet(self):
        state = {'started_at': NOW}
        self.assertEqual(m.decide([], state, {}, False, NOW), ('', False))
        events = [m.issue('YOUTUBE_SIGNIN_REQUIRED')]
        self.assertIn('쿠키', m.decide(events, state, {}, False, NOW)[0])
        self.assertEqual(m.decide(events, state, {}, False, NOW + 300), ('', False))
        self.assertTrue(m.decide([], state, {}, False, NOW + 600)[1])
        self.assertEqual(m.decide([], state, {}, False, NOW + 900), ('', False))

    def test_transient_needs_two_distinct_completed_observations(self):
        state = {}; events = [m.issue('CHAIN_RECOVERY_PENDING')]
        self.assertFalse(m.decide(events, state, {'observation_at': 'first'}, False, NOW)[0])
        self.assertFalse(m.decide(events, state, {'observation_at': 'first'}, False, NOW + 1)[0])
        self.assertTrue(m.decide(events, state, {'observation_at': 'second'}, False, NOW + 300)[0])

    def test_running_does_not_consume_a_new_invite_or_clear_error(self):
        state = {'started_at': NOW - 3600, 'last_alert_codes': ['google:YOUTUBE_SIGNIN_REQUIRED']}
        meta = {'last_invite_at': '2026-10-27T12:00:00Z'}
        self.assertEqual(m.decide([], state, meta, True, NOW), ('', False))
        self.assertNotIn('last_invite_at', state)
        self.assertIn('실제 발송', m.decide([], state, meta, False, NOW)[0])
        self.assertFalse(m.decide([], state, meta, False, NOW + 300)[0])

    def test_paused_and_duplicate_display_policies_never_run(self):
        old = self.row(nextAt='2026-01-01T00:00:00Z')
        for d in [self.data(safeMode=True, renewals=[old]), self.data(enabled=False, renewals=[old]),
            self.data(renewals=[{**old, 'policySource': 'subscription-default'}])]:
            self.assertEqual(m.rank_check('ott', d, NOW), ([], False))
        self.assertEqual(m.rank_check('rank', self.data(workerEnabled=False), NOW), ([], False))

    def test_old_success_with_fresh_rank_check_is_healthy(self):
        d = self.data(renewals=[self.row(lastSuccess='2020-01-01T00:00:00Z', lastRank=1)])
        self.assertEqual(m.rank_check('youtube', d, NOW), ([], False))

    def test_invalid_settings_report_without_repair(self):
        d = self.data(renewals=[self.row(trigger='hourly', nextAt='2026-01-01T00:00:00Z')])
        events, run = m.rank_check('youtube', d, NOW)
        self.assertFalse(run)
        self.assertIn('POLICY_CONFIG', [e['code'] for e in events])
        with self.assertRaises(ValueError):
            m.rank_check('ott', {'ok': False}, NOW)

    def test_only_existing_due_queue_called_once_and_no_raw_data_in_events(self):
        calls = []
        old = self.data(renewals=[self.row(nextAt='2026-01-01T00:00:00Z', accountEmail='private@example.com', subscriptionCredential='secret')])
        def request(url, body=None, **kwargs):
            calls.append((url, body))
            if url.endswith('/youtube/renewals') and sum(x[0] == url for x in calls) == 1:
                return old
            return self.data(workerEnabled=True)
        env = {'PORT': '1234', 'AIO_ADMIN_TOKEN': 'private-token', 'GBUTS_OTT_SYNC_ENABLED': 'true'}
        with patch.object(m.subprocess, 'check_output', return_value='[GbutsSpotifySync] completed'):
            events, meta, _ = m.collect_rank(NOW, {}, request=request, runtime=lambda: env)
        self.assertEqual(meta['repairs'], ['youtube'])
        self.assertEqual([x[0] for x in calls if x[1] is not None], ['http://127.0.0.1:1234/api/gbuts/youtube/renewals/run'])
        self.assertFalse(events)

    def test_kilo_payload_is_rebuilt_from_allowlist(self):
        raw = {**m.issue('POLICY_ERROR', 'ott'), 'accountEmail': 'private@example.com', 'password': 'secret', 'log': 'raw'}
        payload = m.kilo_payload([raw]); serialized = json.dumps(payload)
        for secret in ['private@example.com', 'secret', 'password', 'accountEmail', 'raw']:
            self.assertNotIn(secret, serialized)
        self.assertEqual(payload['model'], 'kilo-auto/free')
        with self.assertRaises(ValueError):
            m.kilo_payload([m.issue('POLICY_ERROR', 'ott') | {'code': 'secret@example.com'}])

    def test_kilo_rate_limit_never_changes_provider_or_suppresses_alert(self):
        calls = []
        def unavailable(url, *args, **kwargs):
            calls.append(url); raise TimeoutError()
        events = [m.issue('YOUTUBE_SIGNIN_REQUIRED')]
        self.assertEqual(m.kilo_summary(events, request=unavailable), '')
        self.assertEqual(calls, [m.KILO_URL])
        self.assertIn('쿠키', m.decide(events, {}, {}, False, NOW)[0])

    def test_reasoning_only_free_response_gets_one_larger_free_retry(self):
        calls = []
        def request(url, payload, **kwargs):
            calls.append((url, payload))
            if len(calls) == 1:
                return {'choices': [{'finish_reason': 'length', 'message': {'content': None, 'reasoning': 'internal'}}]}
            return {'choices': [{'finish_reason': 'stop', 'message': {'content': '쿠키 세션\n확인이 필요합니다.'}}]}
        self.assertEqual(m.kilo_summary([m.issue('YOUTUBE_SIGNIN_REQUIRED')], request=request), '쿠키 세션 확인이 필요합니다.')
        self.assertEqual(len(calls), 2)
        self.assertGreater(calls[1][1]['max_tokens'], calls[0][1]['max_tokens'])
        self.assertTrue(all(url == m.KILO_URL and payload['model'] == 'kilo-auto/free' for url, payload in calls))

    def test_healthy_main_never_calls_kilo(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(m.os.environ, {'GBUTS_OPS_MONITOR_ROOT': folder}), \
            patch.object(m, 'collect_google', return_value=([], {}, False)), \
            patch.object(m, 'kilo_summary') as kilo, patch('builtins.print') as output:
            m.main('google'); kilo.assert_not_called(); output.assert_called_once_with('[SILENT]')
            self.assertEqual((Path(folder) / 'google.json').stat().st_mode & 0o777, 0o600)

    def test_pending_run_under_eight_minutes_is_not_a_new_failure(self):
        status = {'state': 'error', 'lastError': 'YOUTUBE_SIGNIN_REQUIRED', 'consecutiveErrors': 5}
        with patch.object(m.time, 'monotonic', return_value=1000):
            self.assertEqual(m.google_check(status, {'ActiveState': 'activating', 'ExecMainStartTimestampMonotonic': '900000000'}, NOW), ([], True))
            errors, pending = m.google_check(status, {'ActiveState': 'activating', 'ExecMainStartTimestampMonotonic': '100000000'}, NOW)
            self.assertFalse(pending); self.assertEqual(errors[0]['code'], 'GOOGLE_WORKER_STUCK')


if __name__ == '__main__':
    unittest.main()
