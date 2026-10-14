import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Response } from "express";
import { HealthService } from "./health.service";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("live")
  @ApiOkResponse({ schema: { example: { status: "ok" } } })
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOkResponse({
    schema: { example: { status: "ready", database: "connected" } },
  })
  @ApiServiceUnavailableResponse({
    schema: { example: { status: "unavailable", database: "disconnected" } },
  })
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<
    | { status: "ready"; database: "connected" }
    | { status: "unavailable"; database: "disconnected" }
  > {
    const connected = await this.healthService.isDatabaseReady();
    response.status(connected ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return connected
      ? { status: "ready", database: "connected" }
      : { status: "unavailable", database: "disconnected" };
  }
}
