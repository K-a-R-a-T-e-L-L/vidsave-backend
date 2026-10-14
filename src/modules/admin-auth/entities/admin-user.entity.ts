import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  BeforeInsert,
  BeforeUpdate,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

export enum AdminRole {
  ADMIN = "ADMIN",
  USER = "USER",
}

@Entity({ name: "admin_users" })
@Index("uq_admin_users_email", ["email"], { unique: true })
export class AdminUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 320 })
  email!: string;

  @Column({ type: "varchar", length: 255, select: false })
  passwordHash!: string;

  @Column({
    type: "enum",
    enum: AdminRole,
    enumName: "admin_users_role_enum",
    default: AdminRole.ADMIN,
  })
  role!: AdminRole;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeEmail(): void {
    this.email = normalizeAdminEmail(this.email);
  }
}

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}
