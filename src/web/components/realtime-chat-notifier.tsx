import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellRing, Check, Volume2, VolumeX, X } from 'lucide-react';
import { useLocation } from 'wouter';
import {
  isRealtimeChatNotification,
  type RealtimeChatNotification,
} from '../../lib/realtime-chat-notification';
import { getAdminToken } from '../lib/admin-auth';
import { parseSseBuffer, type SseFrame } from '../lib/sse';

const ENABLED_STORAGE_KEY = 'aio.realtimeChatNotifications.enabled';
const CURSOR_STORAGE_KEY = 'aio.realtimeChatNotifications.cursor';
const MAX_STREAM_BUFFER_SIZE = 512 * 1024;

type ConnectionStatus = 'off' | 'auth' | 'connecting' | 'live' | 'reconnecting';
type BrowserPermission = NotificationPermission | 'unsupported' | 'insecure';

function readEnabledPreference(): boolean {
  try { return window.localStorage.getItem(ENABLED_STORAGE_KEY) !== 'false'; } catch { return true; }
}

function saveEnabledPreference(enabled: boolean): void {
  try { window.localStorage.setItem(ENABLED_STORAGE_KEY, String(enabled)); } catch {}
}

function readCursor(): string {
  try { return window.sessionStorage.getItem(CURSOR_STORAGE_KEY) || ''; } catch { return ''; }
}

function saveCursor(cursor: string): void {
  try { window.sessionStorage.setItem(CURSOR_STORAGE_KEY, cursor); } catch {}
}

function browserNotificationPermission(): BrowserPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return window.Notification.permission;
}

function parseChatFrame(frame: SseFrame): RealtimeChatNotification | null {
  if (frame.event !== 'chat') return null;
  try {
    const parsed: unknown = JSON.parse(frame.data);
    return isRealtimeChatNotification(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function formatNotificationTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function playTone(context: AudioContext): void {
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, context.currentTime);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  } catch {}
}

const STATUS_COPY: Record<ConnectionStatus, { label: string; color: string }> = {
  off: { label: '알림 꺼짐', color: '#9CA3AF' },
  auth: { label: '관리자 토큰 확인 필요', color: '#F59E0B' },
  connecting: { label: '실시간 연결 중', color: '#3B82F6' },
  live: { label: '실시간 연결됨', color: '#10B981' },
  reconnecting: { label: '재연결 중', color: '#F59E0B' },
};

export default function RealtimeChatNotifier() {
  const [location, navigate] = useLocation();
  const [enabled, setEnabled] = useState(readEnabledPreference);
  const [status, setStatus] = useState<ConnectionStatus>(enabled ? 'connecting' : 'off');
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<RealtimeChatNotification | null>(null);
  const [recent, setRecent] = useState<RealtimeChatNotification[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [permission, setPermission] = useState<BrowserPermission>(browserNotificationPermission);
  const audioContextRef = useRef<AudioContext | null>(null);
  const seenEventIdsRef = useRef<string[]>([]);
  const isChat = location === '/chat';

  const openChat = useCallback((notification: RealtimeChatNotification) => {
    setToast(null);
    setUnseenCount(0);
    setOpen(false);
    navigate(`/chat?room=${encodeURIComponent(notification.chatRoomUuid)}`);
  }, [navigate]);

  const handleIncoming = useCallback((notification: RealtimeChatNotification) => {
    if (seenEventIdsRef.current.includes(notification.id)) return;
    seenEventIdsRef.current.push(notification.id);
    if (seenEventIdsRef.current.length > 100) seenEventIdsRef.current.shift();

    setRecent((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 5));
    setUnseenCount((count) => count + 1);
    setToast(notification);

    if (audioContextRef.current && soundEnabled) playTone(audioContextRef.current);

    if (document.hidden && browserNotificationPermission() === 'granted') {
      const messageTime = new Date(notification.messageAt).getTime();
      const systemNotification = new window.Notification(`새 문의 · ${notification.buyerName}`, {
        body: `${notification.serviceType} · ${notification.accountLabel}\n${notification.message}`,
        icon: '/dashboard/favicon.ico',
        tag: notification.id,
        ...(Number.isFinite(messageTime) ? { timestamp: messageTime } : {}),
      });
      systemNotification.onclick = () => {
        window.focus();
        window.location.assign(`/dashboard/chat?room=${encodeURIComponent(notification.chatRoomUuid)}`);
        systemNotification.close();
      };
    }
  }, [soundEnabled]);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }

    let stopped = false;
    let activeController: AbortController | null = null;
    let retryDelay = 1_000;
    let rejectedToken = '';
    let rejectedAt = 0;

    const updateStatus = (next: ConnectionStatus) => {
      if (!stopped) setStatus(next);
    };

    const run = async () => {
      while (!stopped) {
        const token = getAdminToken();
        if (!token) {
          updateStatus('auth');
          await wait(1_000);
          continue;
        }
        if (token === rejectedToken && Date.now() - rejectedAt < 30_000) {
          updateStatus('auth');
          await wait(1_000);
          continue;
        }

        activeController = new AbortController();
        try {
          updateStatus('connecting');
          const cursor = readCursor();
          const headers = new Headers({ Accept: 'text/event-stream' });
          if (cursor) headers.set('Last-Event-ID', cursor);
          const response = await fetch('/api/chat/notifications/stream', {
            headers,
            cache: 'no-store',
            signal: activeController.signal,
          });

          if (response.status === 403 || response.status === 503) {
            rejectedToken = token;
            rejectedAt = Date.now();
            updateStatus('auth');
            await response.body?.cancel();
            continue;
          }
          if (!response.ok || !response.body) throw new Error(`실시간 알림 연결 실패 (${response.status})`);

          rejectedToken = '';
          retryDelay = 1_000;
          updateStatus('live');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > MAX_STREAM_BUFFER_SIZE) throw new Error('실시간 알림 데이터가 너무 큽니다.');
            const parsed = parseSseBuffer(buffer);
            buffer = parsed.remainder;
            for (const frame of parsed.frames) {
              if (frame.id) saveCursor(frame.id);
              const notification = parseChatFrame(frame);
              if (notification) handleIncoming(notification);
            }
          }
          buffer += decoder.decode();
          const finalFrames = parseSseBuffer(`${buffer}\n\n`).frames;
          for (const frame of finalFrames) {
            if (frame.id) saveCursor(frame.id);
            const notification = parseChatFrame(frame);
            if (notification) handleIncoming(notification);
          }
          if (!stopped) updateStatus('reconnecting');
        } catch (error) {
          if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) {
            console.warn('[RealtimeChatNotifier] stream disconnected', error);
            updateStatus('reconnecting');
          }
        } finally {
          activeController = null;
        }

        if (!stopped) {
          await wait(retryDelay);
          retryDelay = Math.min(15_000, retryDelay * 2);
        }
      }
    };

    void run();
    return () => {
      stopped = true;
      activeController?.abort();
    };
  }, [enabled, handleIncoming]);

  useEffect(() => {
    if (!toast) return;
    const toastId = toast.id;
    const timer = window.setTimeout(() => {
      setToast((current) => current?.id === toastId ? null : current);
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => {
    void audioContextRef.current?.close();
    audioContextRef.current = null;
  }, []);

  const toggleEnabled = () => {
    const next = !enabled;
    saveEnabledPreference(next);
    setEnabled(next);
    if (!next) setStatus('off');
  };

  const toggleSound = async () => {
    if (soundEnabled) {
      await audioContextRef.current?.close();
      audioContextRef.current = null;
      setSoundEnabled(false);
      return;
    }

    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = new AudioContextClass();
      await context.resume();
      audioContextRef.current = context;
      setSoundEnabled(true);
      playTone(context);
    } catch {}
  };

  const requestBrowserNotifications = async () => {
    const current = browserNotificationPermission();
    if (current === 'unsupported' || current === 'insecure') {
      setPermission(current);
      return;
    }
    try {
      setPermission(await window.Notification.requestPermission());
    } catch {
      setPermission(browserNotificationPermission());
    }
  };

  const permissionLabel = permission === 'granted'
    ? '브라우저 알림 허용됨'
    : permission === 'denied'
      ? '브라우저 설정에서 허용 필요'
      : permission === 'insecure'
        ? '유효한 HTTPS에서 사용 가능'
        : permission === 'unsupported'
          ? '브라우저 알림 미지원'
          : '브라우저 알림 켜기';
  const statusCopy = STATUS_COPY[status];

  return (
    <div style={{ position: 'fixed', right: 16, bottom: isChat ? 88 : 18, zIndex: 850, fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' }}>
      {toast && !open && (
        <div role="status" aria-live="polite" style={{ position: 'absolute', right: 0, bottom: 58, width: 'min(340px, calc(100vw - 32px))', background: '#fff', border: '1.5px solid #C4B5FD', borderRadius: 16, padding: 13, boxShadow: '0 18px 48px rgba(76,29,149,0.22)', color: '#1E1B4B' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
            <div style={{ width: 34, height: 34, borderRadius: 11, background: '#EDE9FE', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <BellRing size={17} color="#7C3AED" />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 900 }}>새 문의 · {toast.buyerName}</div>
              <div style={{ fontSize: 10, color: '#7C3AED', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{toast.serviceType} · {toast.accountLabel} · {formatNotificationTime(toast.messageAt)}</div>
            </div>
            <button type="button" onClick={() => setToast(null)} aria-label="알림 닫기" style={{ border: 0, background: 'transparent', color: '#9CA3AF', cursor: 'pointer', padding: 2 }}><X size={15} /></button>
          </div>
          <div style={{ fontSize: 12, color: '#4B5563', lineHeight: 1.45, marginTop: 9, wordBreak: 'break-word' }}>{toast.message}</div>
          <button type="button" onClick={() => openChat(toast)} style={{ marginTop: 10, width: '100%', border: 0, borderRadius: 10, background: '#7C3AED', color: '#fff', padding: '8px 10px', fontSize: 11, fontWeight: 900, cursor: 'pointer' }}>채팅방 바로가기</button>
        </div>
      )}

      {open && (
        <div style={{ position: 'absolute', right: 0, bottom: 58, width: 'min(340px, calc(100vw - 32px))', background: '#fff', border: '1px solid #DDD6FE', borderRadius: 16, padding: 14, boxShadow: '0 18px 48px rgba(30,27,75,0.2)', color: '#1E1B4B' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 900 }}>실시간 채팅 알림</div>
            <button type="button" onClick={() => setOpen(false)} aria-label="알림 설정 닫기" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#9CA3AF' }}><X size={16} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: 11, color: '#6B7280' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusCopy.color, boxShadow: status === 'live' ? `0 0 0 3px ${statusCopy.color}22` : 'none' }} />
            {statusCopy.label}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7, marginTop: 12 }}>
            <button type="button" onClick={toggleEnabled} aria-pressed={enabled} style={{ border: `1px solid ${enabled ? '#A78BFA' : '#D1D5DB'}`, borderRadius: 10, background: enabled ? '#F3F0FF' : '#F9FAFB', color: enabled ? '#6D28D9' : '#6B7280', padding: '8px 7px', fontSize: 10, fontWeight: 900, cursor: 'pointer' }}>
              {enabled ? '실시간 수신 ON' : '실시간 수신 OFF'}
            </button>
            <button type="button" onClick={() => void toggleSound()} aria-pressed={soundEnabled} style={{ border: `1px solid ${soundEnabled ? '#A78BFA' : '#D1D5DB'}`, borderRadius: 10, background: soundEnabled ? '#F3F0FF' : '#F9FAFB', color: soundEnabled ? '#6D28D9' : '#6B7280', padding: '8px 7px', fontSize: 10, fontWeight: 900, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}{soundEnabled ? '소리 ON' : '소리 켜기'}
            </button>
          </div>

          <button type="button" onClick={() => void requestBrowserNotifications()} disabled={permission === 'granted' || permission === 'denied' || permission === 'unsupported' || permission === 'insecure'} style={{ marginTop: 7, width: '100%', border: '1px solid #D1D5DB', borderRadius: 10, background: permission === 'granted' ? '#ECFDF5' : '#F9FAFB', color: permission === 'granted' ? '#047857' : '#6B7280', padding: '8px 9px', fontSize: 10, fontWeight: 800, cursor: permission === 'default' ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            {permission === 'granted' && <Check size={13} />}{permissionLabel}
          </button>

          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#6B7280', marginBottom: 7 }}>최근 실시간 알림</div>
            {recent.length === 0 ? (
              <div style={{ fontSize: 10, color: '#9CA3AF', padding: '5px 0' }}>새로 도착한 문의가 없어요.</div>
            ) : recent.slice(0, 3).map((notification) => (
              <button key={notification.id} type="button" onClick={() => openChat(notification)} style={{ width: '100%', border: 0, borderRadius: 9, background: '#FAFAFF', padding: '7px 8px', marginBottom: 5, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 10, fontWeight: 900, color: '#1E1B4B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notification.buyerName} · {notification.serviceType}</div>
                <div style={{ fontSize: 10, color: '#7C3AED', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notification.message}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <button type="button" onClick={() => { setOpen((current) => !current); setUnseenCount(0); }} aria-label="실시간 채팅 알림 열기" title={statusCopy.label} style={{ position: 'relative', width: 46, height: 46, borderRadius: '50%', border: '1px solid #C4B5FD', background: '#7C3AED', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 8px 24px rgba(124,58,237,0.3)' }}>
        <Bell size={20} />
        <span aria-hidden="true" style={{ position: 'absolute', right: 3, bottom: 3, width: 9, height: 9, borderRadius: '50%', background: statusCopy.color, border: '2px solid #fff' }} />
        {unseenCount > 0 && <span style={{ position: 'absolute', right: -4, top: -5, minWidth: 18, height: 18, borderRadius: 999, background: '#EF4444', color: '#fff', fontSize: 9, fontWeight: 900, display: 'grid', placeItems: 'center', padding: '0 3px', border: '2px solid #fff' }}>{Math.min(unseenCount, 99)}</span>}
      </button>
    </div>
  );
}
