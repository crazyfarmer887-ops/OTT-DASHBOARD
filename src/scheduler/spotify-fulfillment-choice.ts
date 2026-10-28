import { extractGbutsSpotifyCredentials, type GbutsChatMessage, type SpotifyCredentials } from '../lib/gbuts-spotify';
import { explicitYouTubeBuyerEmails } from '../lib/youtube-buyer-email';

/** Clear literal account pairs take precedence over model interpretation. GButs/Everyview only. */
export async function extractSpotifyFulfillmentCredentials(messages: readonly GbutsChatMessage[], buyer: number,
  fallback: (messages: readonly GbutsChatMessage[], buyer: number) => Promise<SpotifyCredentials | null>): Promise<SpotifyCredentials | null> {
  return extractGbutsSpotifyCredentials(messages, buyer) || fallback(messages, buyer);
}
export function spotifyExistingDetailsPrompt(messages: readonly GbutsChatMessage[], buyer: number): { suffix: string; text: string } | null {
  const entries = messages.filter(m => m.senderSeq === buyer && m.messageType === 'TEXT').sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  const isExisting = (m: GbutsChatMessage) => /^(?:①|1\s*번|기존\s*계정|내\s*계정)(?:\s*으로)?(?:\s*(?:이요|요|할게요|부탁드립니다|초대해주세요|해주세요|선택))?[.!~\s]*$/.test(m.message.trim());
  const selectedIndex = entries.findLastIndex(isExisting);
  const selectedExisting = selectedIndex >= 0;
  const currentEntries = selectedExisting ? entries.slice(selectedIndex) : entries;
  const email = currentEntries.some(m => explicitYouTubeBuyerEmails(m.message).length === 1);
  if (!email && !selectedExisting) return null;
  return email
    ? {suffix:'existing-password',text:'기존 Spotify 계정으로 진행하겠습니다. 이메일은 확인했습니다. 해당 Spotify 계정의 비밀번호도 이 1:1 채팅에 남겨주세요. 다른 서비스의 비밀번호는 보내지 마세요. 새 계정을 원하시면 “새 계정 발급”이라고 남겨주세요.'}
    : {suffix:'existing-details',text:'기존 Spotify 계정으로 초대받으실 이메일과 비밀번호를 이 1:1 채팅에 남겨주세요.\nID: 이메일\n비밀번호: Spotify 비밀번호\n\n새 계정을 원하시면 “새 계정 발급”이라고 남겨주세요.'};
}
