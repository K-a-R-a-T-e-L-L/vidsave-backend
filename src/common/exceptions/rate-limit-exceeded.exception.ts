import { HttpException, HttpStatus } from "@nestjs/common";

export class RateLimitExceededException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: "Too Many Requests",
        message: "Too many login attempts. Try again later.",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
