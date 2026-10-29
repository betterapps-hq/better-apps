// Test databases, reached through Drizzle's own drivers so the adapter runs the queries it builds for each kind of
// database. SQLite runs in memory on node:sqlite and D1 in a local Miniflare runtime, so both run everywhere.
// PostgreSQL, Neon and MySQL need the servers in test/compose.yaml: `pnpm test:servers` starts them and runs the tests
// against them, and `pnpm test` skips those databases.
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { neon, neonConfig, Pool as NeonPool } from "@neondatabase/serverless"
import { defineFeature } from "better-apps"
import { drizzle as drizzleD1 } from "drizzle-orm/d1"
import { boolean, int, json, mysqlTable, text as mysqlText, timestamp, varchar } from "drizzle-orm/mysql-core"
import { drizzle as drizzleMysqlProxy } from "drizzle-orm/mysql-proxy"
import { drizzle as drizzleMysql } from "drizzle-orm/mysql2"
import { drizzle as drizzleNeonHttp } from "drizzle-orm/neon-http"
import { drizzle as drizzleNeonServerless } from "drizzle-orm/neon-serverless"
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres"
import * as pgCore from "drizzle-orm/pg-core"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { drizzle as drizzleSqliteProxy } from "drizzle-orm/sqlite-proxy"
import { Miniflare } from "miniflare"
import { createConnection, createPool } from "mysql2/promise"
import pg from "pg"
import type { DrizzleAdapterConfig, DrizzleDatabase } from "../src/index.js"

export const comments = defineFeature({
  id: "comments",
  schema: {
    comment: {
      fields: {
        subjectId: { type: "string", required: true },
        body: { type: "string", required: true },
        authorName: { type: "string", required: false, fieldName: "author" },
        score: { type: "number", required: true, defaultValue: 0 },
        pinned: { type: "boolean", required: true, defaultValue: false },
        tags: { type: "string[]", required: false },
        metadata: { type: "json", required: false },
        createdAt: { type: "date", required: true, defaultValue: () => new Date() },
        updatedAt: { type: "date", required: false, onUpdate: () => new Date() }
      }
    },
    reaction: {
      fields: {
        commentId: { type: "string", required: true, references: { model: "comment", field: "id" } },
        emoji: { type: "string", required: true }
      }
    }
  }
})

// The tables follow what `better-apps generate` writes for each dialect.
const comment = sqliteTable("comment", {
  id: text("id").primaryKey(),
  subjectId: text("subject_id").notNull(),
  body: text("body").notNull(),
  author: text("author"),
  score: integer("score").default(0).notNull(),
  pinned: integer("pinned", { mode: "boolean" }).default(false).notNull(),
  tags: text("tags", { mode: "json" }),
  metadata: text("metadata", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$onUpdate(() => new Date())
})
const reaction = sqliteTable("reaction", {
  id: text("id").primaryKey(),
  commentId: text("comment_id")
    .notNull()
    .references(() => comment.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull()
})
export const sqliteSchema = { comment, reaction }

const pgComment = pgCore.pgTable("comment", {
  id: pgCore.text("id").primaryKey(),
  subjectId: pgCore.text("subject_id").notNull(),
  body: pgCore.text("body").notNull(),
  author: pgCore.text("author"),
  score: pgCore.integer("score").default(0).notNull(),
  pinned: pgCore.boolean("pinned").default(false).notNull(),
  tags: pgCore.text("tags").array(),
  metadata: pgCore.jsonb("metadata"),
  createdAt: pgCore.timestamp("created_at").defaultNow().notNull(),
  updatedAt: pgCore.timestamp("updated_at").$onUpdate(() => new Date())
})
const pgReaction = pgCore.pgTable("reaction", {
  id: pgCore.text("id").primaryKey(),
  commentId: pgCore
    .text("comment_id")
    .notNull()
    .references(() => pgComment.id, { onDelete: "cascade" }),
  emoji: pgCore.text("emoji").notNull()
})
const pgSchema = { comment: pgComment, reaction: pgReaction }

function defineMysqlSchema(metadata: "json" | "text") {
  const comment = mysqlTable("comment", {
    id: varchar("id", { length: 36 }).primaryKey(),
    subjectId: mysqlText("subject_id").notNull(),
    body: mysqlText("body").notNull(),
    author: mysqlText("author"),
    score: int("score").default(0).notNull(),
    pinned: boolean("pinned").default(false).notNull(),
    tags: mysqlText("tags"),
    metadata: metadata === "json" ? json("metadata") : mysqlText("metadata"),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 }).$onUpdate(() => new Date())
  })
  const reaction = mysqlTable("reaction", {
    id: varchar("id", { length: 36 }).primaryKey(),
    commentId: varchar("comment_id", { length: 36 })
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    emoji: mysqlText("emoji").notNull()
  })
  return { comment, reaction }
}
const mysqlSchema = defineMysqlSchema("json")
// MySQL drivers such as mysql2 parse a json column, and the SQLite stand-in can't, so it stores metadata as text.
const mysqlStandInSchema = defineMysqlSchema("text")

const sqliteTables = [
  `CREATE TABLE comment (
    id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, body TEXT NOT NULL, author TEXT, score INTEGER DEFAULT 0 NOT NULL,
    pinned INTEGER DEFAULT false NOT NULL, tags TEXT, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER
  )`,
  `CREATE TABLE reaction (
    id TEXT PRIMARY KEY, comment_id TEXT NOT NULL REFERENCES comment(id) ON DELETE CASCADE, emoji TEXT NOT NULL
  )`
]

const postgresTables = `
  DROP TABLE IF EXISTS reaction, comment;
  CREATE TABLE comment (
    id text PRIMARY KEY, subject_id text NOT NULL, body text NOT NULL, author text, score integer DEFAULT 0 NOT NULL,
    pinned boolean DEFAULT false NOT NULL, tags text[], metadata jsonb, created_at timestamp DEFAULT now() NOT NULL,
    updated_at timestamp
  );
  CREATE TABLE reaction (
    id text PRIMARY KEY, comment_id text NOT NULL REFERENCES comment(id) ON DELETE CASCADE, emoji text NOT NULL
  );
`

const mysqlTables = `
  DROP TABLE IF EXISTS reaction, comment;
  CREATE TABLE comment (
    id varchar(36) PRIMARY KEY, subject_id text NOT NULL, body text NOT NULL, author text, score int DEFAULT 0 NOT NULL,
    pinned boolean DEFAULT false NOT NULL, tags text, metadata json,
    created_at timestamp(3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL, updated_at timestamp(3) NULL
  );
  CREATE TABLE reaction (
    id varchar(36) PRIMARY KEY, comment_id varchar(36) NOT NULL, emoji text NOT NULL,
    FOREIGN KEY (comment_id) REFERENCES comment(id) ON DELETE CASCADE
  );
`

type Method = "run" | "all" | "values" | "get" | "execute"

function open() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec(["PRAGMA foreign_keys = ON", ...sqliteTables].join(";\n"))
  const query = (sql: string, params: unknown[], method: Method) => {
    const statement = sqlite.prepare(sql)
    const values = params as SQLInputValue[]
    if (method === "run" || method === "execute") {
      const { changes, lastInsertRowid } = statement.run(...values)
      return { rows: [{ affectedRows: Number(changes), insertId: Number(lastInsertRowid) }] }
    }
    statement.setReturnArrays(true)
    // setReturnArrays makes rows arrays of values, which node:sqlite's types don't follow.
    const rows: unknown = method === "get" ? statement.get(...values) : statement.all(...values)
    return { rows: rows as unknown[] }
  }
  const atomic = async <T>(run: () => T | Promise<T>): Promise<T> => {
    sqlite.exec("BEGIN")
    try {
      const result = await run()
      sqlite.exec("COMMIT")
      return result
    } catch (error) {
      sqlite.exec("ROLLBACK")
      throw error
    }
  }
  return { sqlite, query, atomic }
}

// One local D1 runtime serves every D1 test; each test starts from empty tables.
let miniflare: Miniflare | undefined

async function openD1() {
  miniflare ??= new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] })
  const d1 = await miniflare.getD1Database("DB")
  const drop = ["DROP TABLE IF EXISTS reaction", "DROP TABLE IF EXISTS comment"]
  await d1.batch([...drop, ...sqliteTables].map((sql) => d1.prepare(sql)))
  return d1
}

const servers = process.env.BETTER_APPS_TEST_SERVERS === "1"
const unavailable = servers ? undefined : "Needs the database servers: run pnpm test:servers"
const postgresUrl = "postgres://postgres:postgres@localhost:15432/better_apps"
const mysqlUrl = "mysql://root:mysql@localhost:13306/better_apps"
// Neon's proxy takes the endpoint from the host name, so the driver connects to db.localtest.me. Requests go to the
// local proxy, so the name is never looked up.
const neonUrl = "postgres://postgres:postgres@db.localtest.me:5432/better_apps"
neonConfig.fetchEndpoint = () => "http://localhost:14444/sql"
neonConfig.wsProxy = () => "localhost:14444/v1"
neonConfig.useSecureWebSocket = false

async function resetPostgres() {
  const client = new pg.Client(postgresUrl)
  await client.connect()
  try {
    await client.query(postgresTables)
  } finally {
    await client.end()
  }
}

export interface TestDatabase {
  db: DrizzleDatabase
  provider: "pg" | "mysql" | "sqlite"
  schema: Record<string, unknown>
  /** Adapter settings the database needs. */
  config?: Partial<DrizzleAdapterConfig>
  /** Closes the connection, for a driver that holds one. */
  close?(): Promise<void>
}

export interface DatabaseTarget {
  name: string
  /** Why the tests can't reach this database, for a server that isn't running. */
  unavailable?: string | undefined
  /** Connects to the database with empty tables. */
  connect(): Promise<TestDatabase>
  /** Stops anything the tests share, such as the local D1 runtime. */
  dispose?(): Promise<void>
}

export const databases: DatabaseTarget[] = [
  {
    name: "SQLite with batch()",
    async connect() {
      const { sqlite, query, atomic } = open()
      const db = drizzleSqliteProxy(
        async (sql, params, method) => query(sql, params, method),
        (queries) => atomic(() => queries.map(({ sql, params, method }) => query(sql, params, method))),
        { schema: sqliteSchema }
      )
      return { db, provider: "sqlite", schema: sqliteSchema, close: async () => sqlite.close() }
    }
  },
  {
    // sqlite-proxy without a batch callback still has batch(), which fails, so writes take the transaction path.
    name: "SQLite with transactions",
    async connect() {
      const { sqlite, query } = open()
      const db = drizzleSqliteProxy(async (sql, params, method) => query(sql, params, method), { schema: sqliteSchema })
      return {
        db,
        provider: "sqlite",
        schema: sqliteSchema,
        config: { batch: false },
        close: async () => sqlite.close()
      }
    }
  },
  {
    name: "Cloudflare D1",
    async connect() {
      const db = drizzleD1(await openD1(), { schema: sqliteSchema })
      return { db, provider: "sqlite", schema: sqliteSchema }
    },
    async dispose() {
      await miniflare?.dispose()
      miniflare = undefined
    }
  },
  {
    // MySQL-dialect queries run on SQLite after small rewrites: SQLite has no DEFAULT in VALUES, no FOR UPDATE, and no
    // boolean parameters. It covers the adapter's MySQL query flow where no MySQL server is running.
    name: "MySQL dialect on SQLite",
    async connect() {
      const { sqlite, query, atomic } = open()
      const db = drizzleMysqlProxy(
        async (sql, params, method) =>
          query(
            sql.replaceAll(/\bdefault\b/g, "null").replace(/ for update$/, ""),
            params.map((value) => (typeof value === "boolean" ? Number(value) : value)),
            method
          ),
        { schema: mysqlStandInSchema }
      )
      // Drizzle's MySQL proxy driver has no transactions, so the test supplies them.
      Object.defineProperty(db, "transaction", { value: (run: (tx: unknown) => unknown) => atomic(() => run(db)) })
      return { db, provider: "mysql", schema: mysqlStandInSchema, close: async () => sqlite.close() }
    }
  },
  {
    // node-postgres, the driver Cloudflare's Hyperdrive documents, with transactions.
    name: "PostgreSQL",
    unavailable,
    async connect() {
      await resetPostgres()
      const pool = new pg.Pool({ connectionString: postgresUrl })
      const db = drizzlePostgres({ client: pool, schema: pgSchema })
      return { db, provider: "pg", schema: pgSchema, close: () => pool.end() }
    }
  },
  {
    // Neon's serverless driver over HTTP, as on Workers without Hyperdrive. It has batch() but no transactions.
    name: "Neon over HTTP",
    unavailable,
    async connect() {
      await resetPostgres()
      const db = drizzleNeonHttp({ client: neon(neonUrl), schema: pgSchema })
      return { db, provider: "pg", schema: pgSchema }
    }
  },
  {
    name: "Neon over WebSockets",
    unavailable,
    async connect() {
      await resetPostgres()
      const pool = new NeonPool({ connectionString: neonUrl })
      const db = drizzleNeonServerless({ client: pool, schema: pgSchema })
      return { db, provider: "pg", schema: pgSchema, close: () => pool.end() }
    }
  },
  {
    name: "MySQL",
    unavailable,
    async connect() {
      const setup = await createConnection({ uri: mysqlUrl, multipleStatements: true })
      try {
        await setup.query(mysqlTables)
      } finally {
        await setup.end()
      }
      const pool = createPool(mysqlUrl)
      const db = drizzleMysql({ client: pool, schema: mysqlSchema, mode: "default" })
      return { db, provider: "mysql", schema: mysqlSchema, close: () => pool.end() }
    }
  }
]
