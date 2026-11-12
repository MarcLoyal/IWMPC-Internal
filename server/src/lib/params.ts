import { AppError } from './errors';

/** Reads a numeric id from the URL. */
export function idParam(value: string, what = 'This record'): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(404, `${what} was not found.`);
  return id;
}
