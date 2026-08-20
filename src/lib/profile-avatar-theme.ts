export const PROFILE_AVATAR_PALETTE = [
  { background: '#7C3AED', foreground: '#FFFFFF', accent: '#DDD6FE' },
  { background: '#2563EB', foreground: '#FFFFFF', accent: '#BFDBFE' },
  { background: '#DB2777', foreground: '#FFFFFF', accent: '#FBCFE8' },
  { background: '#059669', foreground: '#FFFFFF', accent: '#A7F3D0' },
  { background: '#EA580C', foreground: '#FFFFFF', accent: '#FED7AA' },
  { background: '#4F46E5', foreground: '#FFFFFF', accent: '#C7D2FE' },
] as const;

export type ProfileAvatarTheme = (typeof PROFILE_AVATAR_PALETTE)[number];

export function profileNameHash(profileName: string): number {
  return Array.from(String(profileName || '(미확인)')).reduce(
    (hash, character) => ((hash * 31) + (character.codePointAt(0) || 0)) >>> 0,
    2166136261,
  );
}

export function getProfileAvatarTheme(profileName: string): ProfileAvatarTheme {
  return PROFILE_AVATAR_PALETTE[profileNameHash(profileName) % PROFILE_AVATAR_PALETTE.length];
}
