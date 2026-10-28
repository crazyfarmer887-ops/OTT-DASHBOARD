import { runWithExclusivePollLock } from './poll-daemon';

export const spotifySyncLockPath = () => process.env.SPOTIFY_NOTION_SYNC_LOCK_PATH
  || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/spotify-notion-sync.lock';

// Each single-flight worker contributes at most one queued cycle. Keep file locking
// for cross-process recovery tools, and FIFO admission so a slower worker cannot starve the other.
let tail: Promise<void> = Promise.resolve();

export function runWithSpotifyNotionLock(work: () => Promise<void>): Promise<boolean> {
  const result = tail.then(() => runWithExclusivePollLock(spotifySyncLockPath(), work));
  tail = result.then(() => undefined, () => undefined);
  return result;
}
