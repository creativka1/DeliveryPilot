export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "INVALID_REQUEST",
  ) {
    super(message);
  }
}
export const invariant: (
  condition: unknown,
  message: string,
  status?: number,
) => asserts condition = (condition, message, status = 400) => {
  if (!condition) throw new AppError(status, message);
};
