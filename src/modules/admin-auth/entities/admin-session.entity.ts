import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { AdminUser } from "./admin-user.entity";

@Entity({ name: "admin_sessions" })
@Index("idx_admin_sessions_user_id", ["user"])
@Index("idx_admin_sessions_refresh_expires_at", ["refreshExpiresAt"])
@Index("idx_admin_sessions_revoked_at", ["revokedAt"])
export class AdminSession {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @ManyToOne(() => AdminUser, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: AdminUser;

  @Column({ type: "varchar", length: 64, unique: true })
  refreshTokenHash!: string;

  @Column({ type: "uuid" })
  accessJti!: string;

  @Column({ type: "timestamptz" })
  accessExpiresAt!: Date;

  @Column({ type: "timestamptz" })
  refreshExpiresAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
