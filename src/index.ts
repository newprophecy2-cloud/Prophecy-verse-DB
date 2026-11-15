
export interface Env {
  DB: D1Database;
  API_TOKEN: string;
  ALLOWED_ORIGINS?: string;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(
    columnName?: string
  ): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
  };
  error?: string;
}

interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  primaryKeys: ColumnInfo[];
}

type JsonObject = Record<string, unknown>;

const API_PREFIX = "/v1";
const MAX_BODY_SIZE = 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const SYSTEM_TABLE_PREFIX = "sqlite_";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handlePreflight(request, env);
    }

    try {
      validateEnvironment(env);

      if (!authenticate(request, env)) {
        return json(
          { success: false, error: "Unauthorized" },
          401,
          request,
          env
        );
      }

      if (!url.pathname.startsWith(API_PREFIX)) {
        return json(
          { success: false, error: "Route not found" },
          404,
          request,
          env
        );
      }

      const path = url.pathname
        .slice(API_PREFIX.length)
        .split("/")
        .filter(Boolean)
        .map(decodePathSegment);

      if (path.length === 0) {
        return json(
          {
            success: true,
            service: "Prophecy Verse Database API",
            version: 1,
            operations: [
              "list_tables",
              "get_table_schema",
              "list_records",
              "get_record",
              "create_record",
              "update_record",
              "delete_record",
              "upsert_record",
              "bulk_insert",
            ],
          },
          200,
          request,
          env
        );
      }

      if (path[0] !== "tables") {
        return json(
          { success: false, error: "Unknown endpoint" },
          404,
          request,
          env
        );
      }

      // GET /v1/tables
      if (path.length === 1 && request.method === "GET") {
        return await listTables(env, request);
      }

      if (path.length < 2) {
        return json(
          { success: false, error: "Table name required" },
          400,
          request,
          env
        );
      }

      const tableName = path[1];

      const table = await getTableInfo(env.DB, tableName);

      if (!table) {
        return json(
          {
            success: false,
            error: "Table not found",
            table: tableName,
          },
          404,
          request,
          env
        );
      }

      // GET /v1/tables/:table
      if (path.length === 2) {
        switch (request.method) {
          case "GET":
            return await listRecords(
              request,
              env,
              table
            );

          case "POST":
            return await createRecord(
              request,
              env,
              table
            );

          case "PUT":
            return await upsertRecord(
              request,
              env,
              table
            );

          default:
            return methodNotAllowed(request, env);
        }
      }

      // POST /v1/tables/:table/bulk
      if (path.length === 3 && path[2] === "bulk") {
        if (request.method !== "POST") {
          return methodNotAllowed(request, env);
        }

        return await bulkInsert(
          request,
          env,
          table
        );
      }

      // POST /v1/tables/:table/upsert
      if (path.length === 3 && path[2] === "upsert") {
        if (
          request.method !== "POST" &&
          request.method !== "PUT"
        ) {
          return methodNotAllowed(request, env);
        }

        return await upsertRecord(
          request,
          env,
          table
        );
      }

      // GET /v1/tables/:table/:id
      // PATCH /v1/tables/:table/:id
      // PUT /v1/tables/:table/:id
      // DELETE /v1/tables/:table/:id
      if (path.length === 3) {
        const id = path[2];

        switch (request.method) {
          case "GET":
            return await getRecord(
              request,
              env,
              table,
              id
            );

          case "PATCH":
            return await updateRecord(
              request,
              env,
              table,
              id
            );

          case "PUT":
            return await updateRecord(
              request,
              env,
              table,
              id
            );

          case "DELETE":
            return await deleteRecord(
              request,
              env,
              table,
              id
            );

          default:
            return methodNotAllowed(request, env);
        }
      }

      return json(
        { success: false, error: "Route not found" },
        404,
        request,
        env
      );
    } catch (error) {
      console.error("Database API error:", error);

      if (error instanceof HttpError) {
        return json(
          {
            success: false,
            error: error.message,
          },
          error.status,
          request,
          env
        );
      }

      return json(
        {
          success: false,
          error: "Internal database error",
        },
        500,
        request,
        env
      );
    }
  },
};

// --------------------------------------------------
// ERROR HANDLING
// --------------------------------------------------

class HttpError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

// --------------------------------------------------
// ENVIRONMENT AND AUTHENTICATION
// --------------------------------------------------

function validateEnvironment(env: Env): void {
  if (!env.DB) {
    throw new HttpError("D1 database binding is missing", 500);
  }

  if (!env.API_TOKEN || env.API_TOKEN.length < 24) {
    throw new HttpError(
      "API_TOKEN is missing or too short",
      500
    );
  }
}

function authenticate(
  request: Request,
  env: Env
): boolean {
  const authorization = request.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const suppliedToken = authorization.slice(7);

  if (suppliedToken.length !== env.API_TOKEN.length) {
    return false;
  }

  // Constant-time-style comparison for equal-length tokens.
  let difference = 0;

  for (let i = 0; i < suppliedToken.length; i++) {
    difference |=
      suppliedToken.charCodeAt(i) ^
      env.API_TOKEN.charCodeAt(i);
  }

  return difference === 0;
}

// --------------------------------------------------
// CORS
// --------------------------------------------------

function corsHeaders(
  request: Request,
  env: Env
): Record<string, string> {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods":
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };

  if (origin && (allowed.includes("*") || allowed.includes(origin))) {
    headers["Access-Control-Allow-Origin"] =
      allowed.includes("*") ? "*" : origin;
  }

  return headers;
}

function handlePreflight(
  request: Request,
  env: Env
): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, env),
  });
}

function json(
  data: unknown,
  status: number,
  request: Request,
  env: Env
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request, env),
    },
  });
}

function methodNotAllowed(
  request: Request,
  env: Env
): Response {
  return json(
    { success: false, error: "Method not allowed" },
    405,
    request,
    env
  );
}

// --------------------------------------------------
// PATH AND SQL IDENTIFIER SAFETY
// --------------------------------------------------

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError("Invalid URL encoding");
  }
}

function quoteIdentifier(identifier: string): string {
  if (!identifier || identifier.includes("\0")) {
    throw new HttpError("Invalid SQL identifier");
  }

  return `"${identifier.replace(/"/g, '""')}"`;
}

// --------------------------------------------------
// DYNAMIC SCHEMA DETECTION
// --------------------------------------------------

async function listTables(
  env: Env,
  request: Request
): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table'
       AND name NOT LIKE ?
     ORDER BY name ASC`
  )
    .bind(`${SYSTEM_TABLE_PREFIX}%`)
    .all<{ name: string }>();

  const tables = result.results || [];

  return json(
    {
      success: true,
      count: tables.length,
      tables: tables.map((item) => item.name),
    },
    200,
    request,
    env
  );
}

async function getTableInfo(
  db: D1Database,
  tableName: string
): Promise<TableInfo | null> {
  if (!tableName || tableName.startsWith(SYSTEM_TABLE_PREFIX)) {
    return null;
  }

  const exists = await db.prepare(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name = ?`
  )
    .bind(tableName)
    .first<{ name: string }>();

  if (!exists) {
    return null;
  }

  const result = await db.prepare(
    `PRAGMA table_info(${quoteIdentifier(tableName)})`
  ).all<ColumnInfo>();

  const columns = result.results || [];

  if (columns.length === 0) {
    return null;
  }

  return {
    name: tableName,
    columns,
    primaryKeys: columns
      .filter((column) => column.pk > 0)
      .sort((a, b) => a.pk - b.pk),
  };
}

async function getTableSchema(
  request: Request,
  env: Env,
  table: TableInfo
): Promise<Response> {
  return json(
    {
      success: true,
      table: table.name,
      columns: table.columns,
      primary_keys: table.primaryKeys.map(
        (column) => column.name
      ),
    },
    200,
    request,
    env
  );
}

// --------------------------------------------------
// REQUEST BODY VALIDATION
// --------------------------------------------------

async function readJsonBody(
  request: Request
): Promise<unknown> {
  const contentLength = Number(
    request.headers.get("Content-Length") || 0
  );

  if (contentLength > MAX_BODY_SIZE) {
    throw new HttpError("Request body too large", 413);
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).length > MAX_BODY_SIZE) {
    throw new HttpError("Request body too large", 413);
  }

  if (!text.trim()) {
    throw new HttpError("Request body is required");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError("Invalid JSON body");
  }
}

function ensureObject(value: unknown): JsonObject {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new HttpError("Expected a JSON object");
  }

  return value as JsonObject;
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (
    typeof value === "string" ||
    typeof value === "number"
  ) {
    if (
      typeof value === "number" &&
      !Number.isFinite(value)
    ) {
      throw new HttpError("Invalid numeric value");
    }

    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  throw new HttpError("Unsupported data value");
}

function validateFields(
  table: TableInfo,
  data: JsonObject
): string[] {
  const allowed = new Set(
    table.columns.map((column) => column.name)
  );

  const fields = Object.keys(data);

  if (fields.length === 0) {
    throw new HttpError("No data fields provided");
  }

  const unknown = fields.filter(
    (field) => !allowed.has(field)
  );

  if (unknown.length > 0) {
    throw new HttpError(
      `Unknown column(s): ${unknown.join(", ")}`
    );
  }

  return fields;
}

// --------------------------------------------------
// QUERY FILTERS
// --------------------------------------------------

function parseWhere(
  url: URL,
  table: TableInfo
): {
  sql: string;
  values: unknown[];
} {
  const raw = url.searchParams.get("where");

  if (!raw) {
    return { sql: "", values: [] };
  }

  let where: unknown;

  try {
    where = JSON.parse(raw);
  } catch {
    throw new HttpError("Invalid where JSON");
  }

  const conditions = ensureObject(where);
  const allowed = new Set(
    table.columns.map((column) => column.name)
  );

  const clauses: string[] = [];
  const values: unknown[] = [];

  for (const [column, value] of Object.entries(conditions)) {
    if (!allowed.has(column)) {
      throw new HttpError(`Unknown filter column: ${column}`);
    }

    const identifier = quoteIdentifier(column);

    if (value === null) {
      clauses.push(`${identifier} IS NULL`);
      continue;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        clauses.push("1 = 0");
        continue;
      }

      if (value.length > 100) {
        throw new HttpError("Too many filter values");
      }

      clauses.push(
        `${identifier} IN (${value.map(() => "?").join(", ")})`
      );

      values.push(...value.map(normalizeValue));
      continue;
    }

    clauses.push(`${identifier} = ?`);
    values.push(normalizeValue(value));
  }

  return {
    sql: clauses.length
      ? `WHERE ${clauses.join(" AND ")}`
      : "",
    values,
  };
}

// --------------------------------------------------
// READ RECORDS
// --------------------------------------------------

async function listRecords(
  request: Request,
  env: Env,
  table: TableInfo
): Promise<Response> {
  const url = new URL(request.url);

  const filter = parseWhere(url, table);

  const requestedColumns = url.searchParams.get("columns");

  let columns = table.columns.map((item) => item.name);

  if (requestedColumns) {
    columns = requestedColumns
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    const allowed = new Set(
      table.columns.map((item) => item.name)
    );

    if (
      columns.length === 0 ||
      columns.some((column) => !allowed.has(column))
    ) {
      throw new HttpError("Invalid selected columns");
    }
  }

  const sort = url.searchParams.get("sort");
  const order = (
    url.searchParams.get("order") || "ASC"
  ).toUpperCase();

  let orderSql = "";

  if (sort) {
    if (
      !table.columns.some((column) => column.name === sort)
    ) {
      throw new HttpError("Invalid sort column");
    }

    if (order !== "ASC" && order !== "DESC") {
      throw new HttpError("Order must be ASC or DESC");
    }

    orderSql =
      `ORDER BY ${quoteIdentifier(sort)} ${order}`;
  }

  const limit = parseIntegerParameter(
    url.searchParams.get("limit"),
    DEFAULT_LIMIT,
    1,
    MAX_LIMIT
  );

  const offset = parseIntegerParameter(
    url.searchParams.get("offset"),
    0,
    0,
    10000000
  );

  const countQuery = await env.DB.prepare(
    `SELECT COUNT(*) AS total
     FROM ${quoteIdentifier(table.name)}
     ${filter.sql}`
  )
    .bind(...filter.values)
    .first<{ total: number }>();

  const sql = `
    SELECT ${columns.map(quoteIdentifier).join(", ")}
    FROM ${quoteIdentifier(table.name)}
    ${filter.sql}
    ${orderSql}
    LIMIT ? OFFSET ?
  `;

  const result = await env.DB.prepare(sql)
    .bind(...filter.values, limit, offset)
    .all();

  return json(
    {
      success: true,
      table: table.name,
      total: Number(countQuery?.total || 0),
      limit,
      offset,
      count: result.results?.length || 0,
      data: result.results || [],
    },
    200,
    request,
    env
  );
}

async function getRecord(
  request: Request,
  env: Env,
  table: TableInfo,
  id: string
): Promise<Response> {
  const primaryKey = requireSinglePrimaryKey(table);

  const result = await env.DB.prepare(
    `SELECT *
     FROM ${quoteIdentifier(table.name)}
     WHERE ${quoteIdentifier(primaryKey.name)} = ?
     LIMIT 1`
  )
    .bind(convertId(id, primaryKey))
    .first();

  if (!result) {
    throw new HttpError("Record not found", 404);
  }

  return json(
    {
      success: true,
      table: table.name,
      data: result,
    },
    200,
    request,
    env
  );
}

// --------------------------------------------------
// CREATE RECORD
// --------------------------------------------------

async function createRecord(
  request: Request,
  env: Env,
  table: TableInfo
): Promise<Response> {
  const body = ensureObject(await readJsonBody(request));

  const fields = validateFields(table, body);

  const sql = `
    INSERT INTO ${quoteIdentifier(table.name)}
    (${fields.map(quoteIdentifier).join(", ")})
    VALUES (${fields.map(() => "?").join(", ")})
  `;

  const values = fields.map((field) =>
    normalizeValue(body[field])
  );

  const result = await env.DB.prepare(sql)
    .bind(...values)
    .run();

  if (!result.success) {
    throw new HttpError("Insert failed", 500);
  }

  let insertedRecord: unknown = null;

  if (table.primaryKeys.length === 1) {
    const pk = table.primaryKeys[0];

    const insertedId =
      body[pk.name] ??
      result.meta?.last_row_id;

    if (insertedId !== undefined) {
      insertedRecord = await env.DB.prepare(
        `SELECT *
         FROM ${quoteIdentifier(table.name)}
         WHERE ${quoteIdentifier(pk.name)} = ?
         LIMIT 1`
      )
        .bind(normalizeValue(insertedId))
        .first();
    }
  }

  return json(
    {
      success: true,
      message: "Record created",
      table: table.name,
      data: insertedRecord,
      changes: result.meta?.changes ?? 1,
    },
    201,
    request,
    env
  );
}

// --------------------------------------------------
// UPDATE RECORD
// --------------------------------------------------

async function updateRecord(
  request: Request,
  env: Env,
  table: TableInfo,
  id: string
): Promise<Response> {
  const primaryKey = requireSinglePrimaryKey(table);

  const body = ensureObject(await readJsonBody(request));

  const fields = validateFields(table, body);

  if (fields.includes(primaryKey.name)) {
    throw new HttpError(
      "Primary key cannot be changed through this endpoint"
    );
  }

  const setSql = fields
    .map((field) => `${quoteIdentifier(field)} = ?`)
    .join(", ");

  const values = fields.map((field) =>
    normalizeValue(body[field])
  );

  const result = await env.DB.prepare(
    `UPDATE ${quoteIdentifier(table.name)}
     SET ${setSql}
     WHERE ${quoteIdentifier(primaryKey.name)} = ?`
  )
    .bind(...values, convertId(id, primaryKey))
    .run();

  if (!result.success) {
    throw new HttpError("Update failed", 500);
  }

  if (!result.meta?.changes) {
    throw new HttpError("Record not found", 404);
  }

  const updated = await env.DB.prepare(
    `SELECT *
     FROM ${quoteIdentifier(table.name)}
     WHERE ${quoteIdentifier(primaryKey.name)} = ?
     LIMIT 1`
  )
    .bind(convertId(id, primaryKey))
    .first();

  return json(
    {
      success: true,
      message: "Record updated",
      table: table.name,
      data: updated,
      changes: result.meta.changes,
    },
    200,
    request,
    env
  );
}

// --------------------------------------------------
// DELETE RECORD
// --------------------------------------------------

async function deleteRecord(
  request: Request,
  env: Env,
  table: TableInfo,
  id: string
): Promise<Response> {
  const primaryKey = requireSinglePrimaryKey(table);

  const result = await env.DB.prepare(
    `DELETE FROM ${quoteIdentifier(table.name)}
     WHERE ${quoteIdentifier(primaryKey.name)} = ?`
  )
    .bind(convertId(id, primaryKey))
    .run();

  if (!result.success) {
    throw new HttpError("Delete failed", 500);
  }

  if (!result.meta?.changes) {
    throw new HttpError("Record not found", 404);
  }

  return json(
    {
      success: true,
      message: "Record deleted",
      table: table.name,
      changes: result.meta.changes,
    },
    200,
    request,
    env
  );
}

// --------------------------------------------------
// UPSERT RECORD
// --------------------------------------------------

async function upsertRecord(
  request: Request,
  env: Env,
  table: TableInfo
): Promise<Response> {
  const body = ensureObject(await readJsonBody(request));

  const fields = validateFields(table, body);

  if (table.primaryKeys.length === 0) {
    throw new HttpError(
      "Upsert requires a primary key"
    );
  }

  for (const pk of table.primaryKeys) {
    if (body[pk.name] === undefined) {
      throw new HttpError(
        `Missing primary key field: ${pk.name}`
      );
    }
  }

  const conflictColumns = table.primaryKeys
    .map((column) => quoteIdentifier(column.name))
    .join(", ");

  const updateFields = fields.filter(
    (field) =>
      !table.primaryKeys.some((pk) => pk.name === field)
  );

  let conflictSql = "DO NOTHING";

  if (updateFields.length > 0) {
    conflictSql = `DO UPDATE SET ${updateFields
      .map(
        (field) =>
          `${quoteIdentifier(field)} = excluded.${quoteIdentifier(field)}`
      )
      .join(", ")}`;
  }

  const sql = `
    INSERT INTO ${quoteIdentifier(table.name)}
    (${fields.map(quoteIdentifier).join(", ")})
    VALUES (${fields.map(() => "?").join(", ")})
    ON CONFLICT (${conflictColumns})
    ${conflictSql}
  `;

  const result = await env.DB.prepare(sql)
    .bind(
      ...fields.map((field) =>
        normalizeValue(body[field])
      )
    )
    .run();

  if (!result.success) {
    throw new HttpError("Upsert failed", 500);
  }

  const whereSql = table.primaryKeys
    .map((pk) => `${quoteIdentifier(pk.name)} = ?`)
    .join(" AND ");

  const record = await env.DB.prepare(
    `SELECT *
     FROM ${quoteIdentifier(table.name)}
     WHERE ${whereSql}
     LIMIT 1`
  )
    .bind(
      ...table.primaryKeys.map((pk) =>
        normalizeValue(body[pk.name])
      )
    )
    .first();

  return json(
    {
      success: true,
      message: "Record saved",
      table: table.name,
      data: record,
    },
    200,
    request,
    env
  );
}

// --------------------------------------------------
// BULK INSERT
// --------------------------------------------------

async function bulkInsert(
  request: Request,
  env: Env,
  table: TableInfo
): Promise<Response> {
  const body = await readJsonBody(request);

  if (!Array.isArray(body)) {
    throw new HttpError("Expected an array of records");
  }

  if (body.length === 0) {
    throw new HttpError("No records provided");
  }

  if (body.length > 100) {
    throw new HttpError(
      "Maximum 100 records per bulk request"
    );
  }

  const statements: D1PreparedStatement[] = [];

  for (const item of body) {
    const record = ensureObject(item);
    const fields = validateFields(table, record);

    const sql = `
      INSERT INTO ${quoteIdentifier(table.name)}
      (${fields.map(quoteIdentifier).join(", ")})
      VALUES (${fields.map(() => "?").join(", ")})
    `;

    statements.push(
      env.DB.prepare(sql).bind(
        ...fields.map((field) =>
          normalizeValue(record[field])
        )
      )
    );
  }

  const results = await env.DB.batch(statements);

  const failed = results.some(
    (result) => !result.success
  );

  if (failed) {
    throw new HttpError(
      "Bulk insert failed; database batch was not successful",
      500
    );
  }

  return json(
    {
      success: true,
      message: "Bulk insert completed",
      table: table.name,
      count: results.length,
    },
    201,
    request,
    env
  );
}

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function requireSinglePrimaryKey(
  table: TableInfo
): ColumnInfo {
  if (table.primaryKeys.length !== 1) {
    throw new HttpError(
      "This operation requires exactly one primary key. Use collection filters for composite keys.",
      400
    );
  }

  return table.primaryKeys[0];
}

function convertId(
  id: string,
  primaryKey: ColumnInfo
): unknown {
  if (!id) {
    throw new HttpError("Record ID is required");
  }

  const type = (primaryKey.type || "").toUpperCase();

  if (
    type.includes("INT") &&
    /^-?\d+$/.test(id)
  ) {
    const value = Number(id);

    if (!Number.isSafeInteger(value)) {
      throw new HttpError("Invalid integer ID");
    }

    return value;
  }

  return id;
}

function parseIntegerParameter(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (value === null) {
    return fallback;
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new HttpError("Invalid pagination parameter");
  }

  return parsed;
}
