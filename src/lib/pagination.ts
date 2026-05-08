/**
 * Parse page / pageSize query-string params with sensible defaults.
 * Returns `take` and `skip` values for Prisma, plus the parsed page info.
 *
 * If neither param is present, returns `undefined` so callers can skip pagination.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  defaultPageSize = 50,
): { take: number; skip: number; page: number; pageSize: number } | undefined {
  const rawPage = searchParams.get("page");
  const rawSize = searchParams.get("pageSize");

  if (!rawPage && !rawSize) return undefined;

  const page = Math.max(1, Number(rawPage) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, Number(rawSize) || defaultPageSize),
  );

  return {
    take: pageSize,
    skip: (page - 1) * pageSize,
    page,
    pageSize,
  };
}
