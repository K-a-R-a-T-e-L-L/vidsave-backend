import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequireAdminRoles } from "./decorators/admin-roles.decorator";
import { CreateAdminDto } from "./dto/admin-auth.dto";
import { AdminRole } from "./entities/admin-user.entity";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { AdminRoleGuard } from "./guards/admin-role.guard";
import { AdminAuthService } from "./services/admin-auth.service";

@ApiTags("admins")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminRoleGuard)
@RequireAdminRoles(AdminRole.ADMIN)
@Controller("admin/admins")
export class AdminsController {
  constructor(private readonly authService: AdminAuthService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list() {
    return this.authService.listAdmins();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header("Cache-Control", "no-store")
  create(@Body() body: CreateAdminDto) {
    return this.authService.createAdmin(body.email, body.password);
  }
}
