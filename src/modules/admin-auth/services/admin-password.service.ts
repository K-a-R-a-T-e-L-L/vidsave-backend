import { BadRequestException, Injectable } from "@nestjs/common";
import * as bcrypt from "bcryptjs";

export const BCRYPT_COST = 12;
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD_LENGTH = 8;

export function isPasswordWithinPolicy(password: string): boolean {
  return (
    Array.from(password).length >= MIN_PASSWORD_LENGTH &&
    Buffer.byteLength(password, "utf8") <= MAX_PASSWORD_BYTES
  );
}

export async function hashAdminPassword(password: string): Promise<string> {
  if (!isPasswordWithinPolicy(password)) {
    throw new BadRequestException("Password does not meet the requirements");
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

@Injectable()
export class AdminPasswordService {
  private readonly dummyHash = bcrypt.hash(
    "vidsave-nonexistent-account-marker",
    BCRYPT_COST,
  );

  async verify(
    password: string,
    passwordHash: string | undefined,
  ): Promise<boolean> {
    const validLength = isPasswordWithinPolicy(password);
    const hash =
      passwordHash && validLength ? passwordHash : await this.dummyHash;
    const matches = await bcrypt.compare(password, hash);
    return Boolean(passwordHash && validLength && matches);
  }
}
