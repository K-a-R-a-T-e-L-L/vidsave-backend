import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiTags,
  ApiBody,
  ApiProduces,
  ApiResponse,
  type ApiBodyOptions,
} from "@nestjs/swagger";
import { z } from "zod";
import type { Request, Response } from "express";
import { CmsService, ContentKind } from "./cms.service";
import { LeadsService } from "./leads.service";
import {
  uuid,
  parseInput,
  categoryInput,
  postInput,
  projectInput,
  contactsInput,
  mediaUploadInput,
  leadInput,
  leadUpdate,
} from "./cms.validation";
import { AdminAuthGuard } from "../admin-auth/guards/admin-auth.guard";
import { AdminRoleGuard } from "../admin-auth/guards/admin-role.guard";
import { RequireAdminRoles } from "../admin-auth/decorators/admin-roles.decorator";
import { AdminRole } from "../admin-auth/entities/admin-user.entity";

function inputSchema(
  schema: z.ZodType,
): Extract<ApiBodyOptions, { schema: unknown }>["schema"] {
  return z.toJSONSchema(schema, {
    target: "openapi-3.0",
    unrepresentable: "any",
  }) as Extract<ApiBodyOptions, { schema: unknown }>["schema"];
}
function isContent(kind: string): kind is ContentKind {
  return ["posts", "projects", "blog-categories"].includes(kind);
}
const queryInput = z
  .object({
    page: z
      .string()
      .regex(/^[1-9][0-9]{0,3}$/)
      .optional(),
    limit: z
      .string()
      .regex(/^[1-9][0-9]{0,2}$/)
      .optional(),
    search: z.string().max(200).optional(),
    status: z.string().max(30).optional(),
    category: z.string().max(200).optional(),
  })
  .strict();
function idCheck(id: string) {
  if (!uuid.safeParse(id).success) throw new NotFoundException();
}

@ApiTags("CMS administration")
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminRoleGuard)
@RequireAdminRoles(AdminRole.ADMIN)
@Controller("admin/cms")
export class CmsAdminController {
  constructor(private readonly cms: CmsService) {}
  @Get(":kind")
  @Header("Cache-Control", "no-store")
  list(@Param("kind") kind: string, @Query() query: Record<string, string>) {
    query = parseInput(queryInput, query);
    if (isContent(kind)) return this.cms.list(kind, query);
    if (kind === "contacts") return this.cms.contacts();
    if (kind === "leads") return this.cms.leads(query);
    if (kind === "dashboard") return this.cms.dashboard();
    throw new NotFoundException();
  }
  @Get("media/:id/file")
  @ApiProduces("image/webp")
  @ApiResponse({
    status: 200,
    content: { "image/webp": { schema: { type: "string", format: "binary" } } },
  })
  async image(@Param("id") id: string, @Res() res: Response) {
    idCheck(id);
    const bytes = await this.cms.mediaFile(id, false);
    res
      .set({
        "Content-Type": "image/webp",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      })
      .send(Buffer.from(bytes));
  }
  @Get(":kind/:id")
  @Header("Cache-Control", "no-store")
  get(@Param("kind") kind: string, @Param("id") id: string) {
    idCheck(id);
    if (isContent(kind))
      return this.cms
        .content(kind, id)
        .then((c) => this.cms.serialize(kind, c));
    if (kind === "leads") return this.cms.getLead(id);
    throw new NotFoundException();
  }
  @Post(":kind")
  @ApiBody({
    description:
      "Select the schema for the resource kind. Rich text must be validated Tiptap JSON; upload bytes are base64, actual images are limited to 8 MiB.",
    schema: {
      oneOf: [
        inputSchema(categoryInput),
        inputSchema(postInput),
        inputSchema(projectInput),
        inputSchema(mediaUploadInput),
      ],
    },
  })
  create(@Param("kind") kind: string, @Body() body: unknown) {
    if (isContent(kind)) return this.cms.saveContent(kind, body);
    if (kind === "media") return this.cms.upload(body);
    throw new NotFoundException();
  }
  @Patch(":kind")
  @ApiBody({ schema: inputSchema(contactsInput) })
  settings(@Param("kind") kind: string, @Body() body: unknown) {
    if (kind === "contacts") return this.cms.saveContacts(body);
    throw new NotFoundException();
  }
  @Patch(":kind/:id")
  @ApiBody({
    schema: {
      oneOf: [
        inputSchema(categoryInput),
        inputSchema(postInput),
        inputSchema(projectInput),
        inputSchema(leadUpdate),
      ],
    },
  })
  update(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    idCheck(id);
    if (isContent(kind)) return this.cms.saveContent(kind, body, id);
    if (kind === "leads") return this.cms.updateLead(id, body);
    throw new NotFoundException();
  }
  @Delete(":kind/:id")
  @HttpCode(200)
  async remove(@Param("kind") kind: string, @Param("id") id: string) {
    idCheck(id);
    if (kind === "media") return this.cms.deleteMedia(id);
    if (kind === "posts" || kind === "projects")
      return this.cms.deleteContent(kind, id);
    if (kind === "blog-categories") {
      await this.cms.deleteCategory(id);
      return { deleted: true };
    }
    throw new NotFoundException();
  }
}

@ApiTags("public content")
@Controller("content")
export class CmsPublicController {
  constructor(
    private readonly cms: CmsService,
    private readonly leads: LeadsService,
  ) {}
  @Get("bootstrap") @Header("Cache-Control", "no-store") bootstrap() {
    return this.cms.bootstrap();
  }
  @Get("lead-config") @Header("Cache-Control", "no-store") leadConfig() {
    return this.leads.config();
  }
  @ApiBody({ schema: inputSchema(leadInput) })
  @Post("leads")
  @HttpCode(201)
  @Header("Cache-Control", "no-store")
  submit(@Body() body: unknown, @Req() req: Request) {
    return this.leads.submit(body, req.ip ?? "unknown");
  }
  @ApiProduces("image/webp")
  @ApiResponse({
    status: 200,
    content: { "image/webp": { schema: { type: "string", format: "binary" } } },
  })
  @Get("media/:id")
  async media(@Param("id") id: string, @Res() res: Response) {
    idCheck(id);
    const bytes = await this.cms.mediaFile(id, true);
    res
      .set({
        "Content-Type": "image/webp",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      })
      .send(Buffer.from(bytes));
  }
  @Get(":kind") @Header("Cache-Control", "no-store") list(
    @Param("kind") kind: string,
    @Query() query: Record<string, string>,
  ) {
    query = parseInput(queryInput, query);
    if (!isContent(kind)) throw new NotFoundException();
    return this.cms.list(kind, query, true);
  }
  @Get(":kind/:slug") @Header("Cache-Control", "no-store") detail(
    @Param("kind") kind: string,
    @Param("slug") slug: string,
  ) {
    if (!isContent(kind)) throw new NotFoundException();
    return this.cms.publicDetail(kind, slug);
  }
}
