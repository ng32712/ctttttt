export function safeMediaUrl(
  rawUrl: string | undefined | null,
  fallback = '/assets/images/solobiz_os_showcase_1795209164172.jpg'
): string {
  if (!rawUrl) return fallback;
  const trimmed = rawUrl.trim();
  if (!trimmed || /[\r\n\0]/.test(trimmed)) return fallback;

  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('//') || trimmed.includes('..') || trimmed.includes('\\')) {
      return fallback;
    }
    if (trimmed.startsWith('/assets/') || trimmed.startsWith('/uploads/')) {
      return trimmed;
    }
    return fallback;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return fallback;
  } catch {
    return fallback;
  }
}
