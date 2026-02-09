import { DataSource } from "typeorm";
import "reflect-metadata";
import { config } from "dotenv";
config();
const {
  NODE_ENV,
  POSTGRES_USER,
  POSTGRES_PASSWORD,
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_DB,
} = process.env;
export const dataSource = new DataSource({
  type: "postgres",
  host: POSTGRES_HOST,
  username: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  port: +POSTGRES_PORT!,
  database: POSTGRES_DB,
  logger: "file",
  synchronize: NODE_ENV === "development" ? true : false,
  logging: NODE_ENV === "development" || NODE_ENV === "test" ? false : false,
  entities: ["src/entity/**/*.ts"],
  migrations: ["src/migrations/*.ts"],
});