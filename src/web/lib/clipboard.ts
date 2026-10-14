export async function copyTextToClipboard(value: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
  } catch {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const area = document.createElement('textarea'); area.value = value; area.readOnly = true;
    area.style.cssText = 'position:fixed;opacity:0;left:0;top:0'; document.body.append(area);
    try {
      area.select(); area.setSelectionRange(0, value.length);
      if (!document.execCommand('copy')) throw new Error('값을 길게 눌러 직접 복사해주세요.');
    } finally { area.remove(); previous?.focus({ preventScroll: true }); }
  }
}
