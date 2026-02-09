import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "favorite_tests", schema: "achilles" })
export class FavTest {
  @PrimaryGeneratedColumn("uuid")
  fav_id: string;

  @Column({ name: "test_id", type: "uuid" })
  test_id: string;

  @Column({ name: "user_id", type: "varchar" })
  user_id: string;

  @CreateDateColumn({ name: "created_at" })
  createAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updateAt: Date;
}