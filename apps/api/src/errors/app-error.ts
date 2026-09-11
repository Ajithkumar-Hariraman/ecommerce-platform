// Messages on this type must be deliberately safe for clients.
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
    if (!Number.isInteger(statusCode) || statusCode < 400 || statusCode > 599) {
      throw new RangeError(
        "AppError statusCode must be an integer from 400 to 599.",
      );
    }
  }
}
