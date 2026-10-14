import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { AdminUser } from "../entities/admin-user.entity";

export type AuthenticatedAdmin = Pick<AdminUser, "id" | "email" | "role">;

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAdmin => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { adminUser?: AuthenticatedAdmin }>();
    if (!request.adminUser)
      throw new Error("Authenticated admin missing from request");
    return request.adminUser;
  },
);
