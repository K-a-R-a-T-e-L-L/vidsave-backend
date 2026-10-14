import { SetMetadata } from "@nestjs/common";
import { AdminRole } from "../entities/admin-user.entity";

export const ADMIN_ROLES_KEY = "admin-roles";
export const RequireAdminRoles = (...roles: AdminRole[]) =>
  SetMetadata(ADMIN_ROLES_KEY, roles);
