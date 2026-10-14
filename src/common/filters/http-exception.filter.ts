import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { RateLimitExceededException } from "../exceptions/rate-limit-exceeded.exception";

interface ErrorPayload {
  statusCode: number;
  error: string;
  message: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    if (response.headersSent) return;

    const status = this.statusCode(exception);
    const payload =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const error = this.errorName(status, payload);
    const message = this.safeMessage(status, payload);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled ${exception instanceof Error ? exception.name : "exception"} at ${request.method} ${request.path}`,
      );
    }

    const body: ErrorPayload = {
      statusCode: status,
      error,
      message,
      path: request.originalUrl.split("?")[0],
    };
    if (exception instanceof RateLimitExceededException) {
      response.setHeader("Retry-After", exception.retryAfterSeconds.toString());
    }
    response.status(status).json(body);
  }

  private statusCode(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (exception && typeof exception === "object" && "status" in exception) {
      const status = (exception as { status?: unknown }).status;
      if (typeof status === "number" && status >= 400 && status <= 599)
        return status;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private errorName(status: number, payload: unknown): string {
    if (payload && typeof payload === "object" && "error" in payload) {
      const error = (payload as { error?: unknown }).error;
      if (typeof error === "string" && error.length > 0) return error;
    }
    if (status === HttpStatus.NOT_FOUND) return "Not Found";
    if (status === HttpStatus.BAD_REQUEST) return "Bad Request";
    if (status === HttpStatus.UNAUTHORIZED) return "Unauthorized";
    if (status === HttpStatus.FORBIDDEN) return "Forbidden";
    if (status === HttpStatus.CONFLICT) return "Conflict";
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) return "Payload Too Large";
    return status >= 500 ? "Internal Server Error" : "HTTP Error";
  }

  private safeMessage(status: number, payload: unknown): string {
    if (status >= 500) return "Internal server error";
    if (status === HttpStatus.NOT_FOUND) return "Resource not found";
    if (status === HttpStatus.PAYLOAD_TOO_LARGE)
      return "Request body exceeds the 64 KiB limit";
    if (payload && typeof payload === "object" && "message" in payload) {
      const message = (payload as { message?: unknown }).message;
      if (Array.isArray(message))
        return `Invalid request: ${message.map(String).join("; ")}`;
      if (typeof message === "string") return message;
    }
    if (typeof payload === "string") return payload;
    return "Request could not be processed";
  }
}
