/**
 * So'rov kelgan IP manzilni aniqlaydi.
 *
 * Nega o'z helper'imiz bor: Express `req.ip` nginx/traefik ortida har doim
 * `127.0.0.1` qaytaradi, `x-forwarded-for` esa proxy bo'lmasa mijoz tomonidan
 * soxtalashtirilishi mumkin. Shuning uchun header'ga **faqat** `TRUST_PROXY=true`
 * bo'lganda ishonamiz (ya'ni oldida haqiqatan reverse proxy turganda).
 */
export function getClientIp(req: any): string | null {
  const trustProxy =
    String(process.env.TRUST_PROXY ?? '').toLowerCase() === 'true';

  if (trustProxy) {
    const forwarded = req?.headers?.['x-forwarded-for'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    // "client, proxy1, proxy2" — birinchisi haqiqiy mijoz
    const first = String(raw ?? '')
      .split(',')[0]
      ?.trim();
    if (first) return normalizeIp(first);

    const realIp = req?.headers?.['x-real-ip'];
    if (realIp) return normalizeIp(String(realIp));
  }

  const direct = req?.ip ?? req?.socket?.remoteAddress ?? null;
  return direct ? normalizeIp(String(direct)) : null;
}

/**
 * Ichki (private) tarmoq IP'simi. Bunday IP markazni ajratib turmaydi —
 * shuning uchun uni markaz "public IP"si sifatida saqlash mantiqsiz.
 */
export function isPrivateIp(ip: string): boolean {
  const value = normalizeIp(ip);
  if (value === '127.0.0.1' || value === '::1') return true;
  if (value.startsWith('10.') || value.startsWith('192.168.')) return true;
  if (value.startsWith('169.254.')) return true; // link-local
  // 172.16.0.0 – 172.31.255.255
  const parts = value.split('.');
  if (parts[0] === '172') {
    const second = Number(parts[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 unique-local / link-local
  if (/^f[cd][0-9a-f]{2}:/i.test(value) || /^fe80:/i.test(value)) return true;
  return false;
}

/** `::ffff:1.2.3.4` → `1.2.3.4`, IPv6 localhost → `127.0.0.1` */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed === '::1') return '127.0.0.1';
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}
