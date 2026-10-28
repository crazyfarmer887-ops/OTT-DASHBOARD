import { assertGbutsOttCredentials, type GbutsOttCredentials } from './gbuts-disney-delivery';
import { emailVerifyDisneyMailboxUrl } from './disney-mailbox';

export const NETFLIX_MAILBOX_FORMAT = 'netflix-mailbox-v1' as const;
export function buildGbutsNetflixMailboxText(value: GbutsOttCredentials, profile: number): string {
  assertGbutsOttCredentials(value);
  const mailbox = emailVerifyDisneyMailboxUrl(value.id);
  if (!mailbox || value.emailAccessUrl !== mailbox || !/^\d{6}$/.test(value.emailAccessPin || '')
    || !Number.isInteger(profile) || profile < 1 || profile > 5) throw Error('넷플릭스 이메일 인증 주소·PIN·프로필을 확인해주세요.');
  return `[계정 정보]\nID : ${value.id}\nPW : ${value.password}\n프로필 : ${profile}번\n\n[이메일 인증]\n${mailbox}\n이메일 PIN : ${value.emailAccessPin}\n로그인·가구 인증이 필요하면 위 주소에서 최신 인증 메일을 확인하세요.\n계정 이메일·비밀번호·결제 정보는 변경하지 마세요.`;
}
