import { validate } from "class-validator";
import { CreateAdminDto } from "../dto/admin-auth.dto";
import { isPasswordWithinPolicy } from "./admin-password.service";

describe("administrator password policy", () => {
  it("accepts eight characters and rejects seven", () => {
    expect(isPasswordWithinPolicy("abcdefgh")).toBe(true);
    expect(isPasswordWithinPolicy("abcdefg")).toBe(false);
  });

  it("counts Unicode characters and preserves the 72-byte bcrypt limit", () => {
    expect(isPasswordWithinPolicy("я".repeat(8))).toBe(true);
    expect(isPasswordWithinPolicy("я".repeat(7))).toBe(false);
    expect(isPasswordWithinPolicy("я".repeat(36))).toBe(true);
    expect(isPasswordWithinPolicy("я".repeat(37))).toBe(false);
  });

  it("allows eight-character passwords in the create-admin API", async () => {
    const dto = new CreateAdminDto();
    dto.email = "admin@example.test";
    dto.password = "abcdefgh";
    expect(await validate(dto)).toHaveLength(0);
    dto.password = "abcdefg";
    expect(
      (await validate(dto)).some((error) => error.property === "password"),
    ).toBe(true);
  });
});
