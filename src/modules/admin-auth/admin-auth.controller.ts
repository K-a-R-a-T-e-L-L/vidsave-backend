import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import {
  CurrentAdmin,
  AuthenticatedAdmin,
} from "./decorators/current-admin.decorator";
import { AdminLoginDto, AdminRefreshDto } from "./dto/admin-auth.dto";
import { AdminAuthGuard } from "./guards/admin-auth.guard";
import { AdminAuthService } from "./services/admin-auth.service";

@ApiTags("admin-auth")
@Controller("admin/auth")
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  login(@Body() body: AdminLoginDto, @Req() request: Request) {
    return this.authService.login(
      body.email,
      body.password,
      request.ip ?? request.socket.remoteAddress ?? "unknown",
    );
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  refresh(@Body() body: AdminRefreshDto) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  async logout(@Body() body: AdminRefreshDto): Promise<void> {
    await this.authService.logout(body.refreshToken);
  }

  @Get("me")
  @UseGuards(AdminAuthGuard)
  @ApiBearerAuth()
  @Header("Cache-Control", "no-store")
  me(@CurrentAdmin() user: AuthenticatedAdmin): AuthenticatedAdmin {
    return user;
  }
}
