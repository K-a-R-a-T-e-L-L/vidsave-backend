import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_ROLES_KEY } from "../decorators/admin-roles.decorator";
import { AuthenticatedAdmin } from "../decorators/current-admin.decorator";
import { AdminRole } from "../entities/admin-user.entity";

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(
      ADMIN_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles?.length) return true;
    const request = context.switchToHttp().getRequest<{
      adminUser?: AuthenticatedAdmin;
    }>();
    return Boolean(
      request.adminUser && requiredRoles.includes(request.adminUser.role),
    );
  }
}
