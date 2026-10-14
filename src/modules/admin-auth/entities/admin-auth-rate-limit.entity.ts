import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "admin_auth_rate_limits" })
export class AdminAuthRateLimit {
  @PrimaryColumn({ type: "varchar", length: 64 })
  bucketHash!: string;

  @Column({ type: "integer", default: 0 })
  attemptCount!: number;

  @Column({ type: "timestamptz" })
  windowStartedAt!: Date;

  @Column({ type: "timestamptz", nullable: true })
  blockedUntil!: Date | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
