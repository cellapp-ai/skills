export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}
export function ensure(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
