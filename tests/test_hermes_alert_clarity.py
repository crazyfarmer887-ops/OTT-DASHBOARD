import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
import json
spec = importlib.util.spec_from_file_location('clarity_monitor', Path(__file__).resolve().parents[1] / 'deploy/hermes_ops/monitor.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
class AlertClarityTests(unittest.TestCase):
    def test_auth_blocker_requires_owner_action_and_does_not_claim_a_fix(self):
        state = {'started_at': 100}
        text, recovered = m.decide([m.issue('GOOGLE_SIGNIN_REQUIRED')], state, {}, False, 200)
        self.assertTrue(text.startswith('🔴 [조치 필요]'))
        self.assertIn('로그인 연결을 복구', text)
        self.assertIn('복구 전에는 자동 초대가 멈춥니다', text)
        self.assertFalse(recovered)
        self.assertEqual(m.decide([m.issue('GOOGLE_SIGNIN_REQUIRED')], state, {}, False, 300), ('', False))
    def test_confirmed_completion_is_explicit_and_running_checks_stay_silent(self):
        text, _ = m.decide([], {'started_at': 100}, {'last_invite_at': '2026-10-28T01:00:00Z'}, False, 200)
        self.assertTrue(text.startswith('🟢 [처리 완료]'))
        self.assertIn('내 할 일: 없음', text)
        self.assertEqual(m.decide([], {}, {}, True, 200), ('', False))
    def test_action_notification_never_calls_or_appends_freeform_kilo_summary(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(m.os.environ, {'GBUTS_OPS_MONITOR_ROOT': folder}), \
            patch.object(m, 'collect_google', return_value=([m.issue('GOOGLE_SIGNIN_REQUIRED')], {}, False)), \
            patch.object(m, 'kilo_summary', return_value='자동 해결됐으니 할 일 없습니다.') as kilo, patch('builtins.print') as output:
            m.main('google')
            kilo.assert_not_called()
            message = output.call_args.args[0]
            self.assertTrue(message.startswith('🔴 [조치 필요]'))
            self.assertNotIn('자동 해결됐으니', message)
            self.assertNotIn('요약:', message)
            self.assertEqual(json.loads((Path(folder) / 'google.json').read_text())['summary_mode'], 'deterministic')
if __name__ == '__main__': unittest.main()
