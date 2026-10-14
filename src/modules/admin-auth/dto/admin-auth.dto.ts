import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class AdminLoginDto {
  @ApiProperty({ example: "admin@example.com", maxLength: 320 })
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @MaxLength(320)
  @MinLength(1)
  email!: string;

  @ApiProperty({ maxLength: 256, writeOnly: true })
  @IsString()
  @MaxLength(256)
  password!: string;
}

export class AdminRefreshDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @MaxLength(256)
  refreshToken!: string;
}

export class CreateAdminDto {
  @ApiProperty({ example: "admin@example.com", maxLength: 320 })
  @IsEmail()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @MaxLength(320)
  email!: string;

  @ApiProperty({ minLength: 14, maxLength: 72, writeOnly: true })
  @IsString()
  @MinLength(14)
  password!: string;
}

export interface SafeAdminUser {
  id: string;
  email: string;
  role: "ADMIN" | "USER";
}

export interface AdminTokenPair {
  user: SafeAdminUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
}
