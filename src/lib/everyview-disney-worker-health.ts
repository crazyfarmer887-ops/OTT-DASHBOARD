/** Process-local heartbeats: a flag or persisted timestamp is not proof a worker is alive. */
export type DisneyWorkerKind = 'inventory' | 'cutoff' | 'recovery';
export type DisneyWorkerState = 'starting' | 'checked' | 'paused' | 'held' | 'error' | 'stopped';
export interface DisneyWorkerHeartbeat { pid:number;state:DisneyWorkerState;at:number }
const beats = new Map<DisneyWorkerKind,DisneyWorkerHeartbeat>();
export function markDisneyWorker(kind:DisneyWorkerKind,state:DisneyWorkerState,now=Date.now()):void {
  beats.set(kind,{pid:process.pid,state,at:now});
}
export function disneyWorkerHealthy(kind:DisneyWorkerKind,now=Date.now(),maxAgeMs=120_000):boolean {
  const b=beats.get(kind);return !!b&&b.pid===process.pid&&b.state==='checked'&&Number.isFinite(now)&&Number.isFinite(b.at)
    &&Number.isFinite(maxAgeMs)&&maxAgeMs>0&&b.at<=now&&now-b.at<=maxAgeMs;
}
