/**
 * `repo.query('UPDATE … RETURNING …')` TypeORM (postgres) da qatorlarni emas,
 * `[rows, rowCount]` ni qaytaradi (UPDATE/DELETE uchun). SELECT/INSERT esa
 * to'g'ridan-to'g'ri `rows`. Ikkalasini bir xil ko'rinishga keltiradi.
 */
export function returningRows<T>(result: unknown): T[] {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return Array.isArray(result) ? (result as T[]) : [];
}
