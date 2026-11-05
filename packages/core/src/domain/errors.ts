export class AppError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function fail(code = 'NOT_FOUND', status = 404, message = 'مورد درخواستی یافت نشد.'): never {
  throw new AppError(code, status, message);
}
