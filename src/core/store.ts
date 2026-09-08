/**
 * Run state. The container filesystem is ephemeral on App Runner, so the real
 * home is DynamoDB + S3. Local disk is the dev fallback and is chosen
 * automatically when no table is configured, which keeps the whole system
 * runnable with no AWS account at all.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { Packet } from "./schema.ts"

export type RunState = {
  run_id: string
  platform: string
  status: "queued" | "running" | "done" | "error"
  session_id: string | null
  packet: Packet | null
  error: string | null
  log: { at: string; kind: string; text: string }[]
  live_view_url: string | null
  created_at: string
  updated_at: string
  completed_at?: string
  /** set when a model outage forced us to show an earlier run's packet */
  from_cache?: { run_id: string; at: string }
}

const TABLE = process.env.RUNS_TABLE
const BUCKET = process.env.ARTIFACTS_BUCKET
const LOCAL_DIR = process.env.LOCAL_RUNS_DIR ?? join(process.cwd(), "runs")

export const usingAws = () => Boolean(TABLE)

let ddb: any = null
let s3: any = null

async function ddbClient() {
  if (ddb) return ddb
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb")
  const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb")
  ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
  return ddb
}

async function s3Client() {
  if (s3) return s3
  const { S3Client } = await import("@aws-sdk/client-s3")
  s3 = new S3Client({})
  return s3
}

function localPath(id: string) {
  mkdirSync(LOCAL_DIR, { recursive: true })
  return join(LOCAL_DIR, `${id}.json`)
}

export async function put(run: RunState): Promise<void> {
  run.updated_at = new Date().toISOString()
  if (!usingAws()) {
    writeFileSync(localPath(run.run_id), JSON.stringify(run, null, 2))
    return
  }
  const { PutCommand } = await import("@aws-sdk/lib-dynamodb")
  const c = await ddbClient()
  // DynamoDB rejects items over 400KB; the packet is small but the log is not
  // bounded, so keep only the tail.
  const trimmed = { ...run, log: run.log.slice(-200) }
  await c.send(new PutCommand({ TableName: TABLE, Item: trimmed }))
}

export async function get(id: string): Promise<RunState | null> {
  if (!usingAws()) {
    const p = localPath(id)
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null
  }
  const { GetCommand } = await import("@aws-sdk/lib-dynamodb")
  const c = await ddbClient()
  const r = await c.send(new GetCommand({ TableName: TABLE, Key: { run_id: id } }))
  return (r.Item as RunState) ?? null
}

export async function recent(limit = 20): Promise<RunState[]> {
  if (!usingAws()) {
    mkdirSync(LOCAL_DIR, { recursive: true })
    const files = readdirSync(LOCAL_DIR).filter((f) => f.endsWith(".json"))
    const runs = files.map((f) => JSON.parse(readFileSync(join(LOCAL_DIR, f), "utf8")) as RunState)
    return runs.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit)
  }
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb")
  const c = await ddbClient()
  const r = await c.send(new ScanCommand({ TableName: TABLE, Limit: limit }))
  return ((r.Items as RunState[]) ?? []).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Returns a URL the frontend can render, or a local path when running offline. */
export async function putArtifact(key: string, body: Buffer | string, contentType: string): Promise<string> {
  if (!BUCKET) {
    const dir = join(LOCAL_DIR, "artifacts")
    mkdirSync(dir, { recursive: true })
    const p = join(dir, key.replace(/\//g, "_"))
    writeFileSync(p, body as any)
    return `/artifacts/${key.replace(/\//g, "_")}`
  }
  const { PutObjectCommand } = await import("@aws-sdk/client-s3")
  const c = await s3Client()
  await c.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body as any, ContentType: contentType }))
  const region = process.env.AWS_REGION ?? "us-east-1"
  return `https://${BUCKET}.s3.${region}.amazonaws.com/${key}`
}

/** Tools only know their opencode sessionID, so map it back to the run. */
export async function getBySession(sessionId: string): Promise<RunState | null> {
  if (!usingAws()) {
    for (const r of await recent(200)) if (r.session_id === sessionId) return r
    return null
  }
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb")
  const c = await ddbClient()
  const r = await c.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "session_id = :s",
      ExpressionAttributeValues: { ":s": sessionId },
      Limit: 5,
    }),
  )
  return ((r.Items as RunState[]) ?? [])[0] ?? null
}
