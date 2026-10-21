import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin, requestUsername } from "@/lib/auth";
import { connectDB, loadRecords, Record, recordKinds, replaceRecords, writeRecord, removeRecord } from "@/lib/db";

export const runtime = "nodejs";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function authorized(request: NextRequest) {
  return (await requestUsername(request)) !== null;
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return error("Please log in again.", 401);
  try {
    const records = await loadRecords();
    return NextResponse.json({ ...records, app: "rsf-billing", version: 1, exported: new Date().toISOString() });
  } catch (cause) {
    console.error("Could not read billing records", cause);
    return error("Could not load billing records from MongoDB.", 503);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return error("Invalid request origin.", 403);
  if (!(await authorized(request))) return error("Please log in again.", 401);
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request body.", 400);
    const input = body as Record<string, unknown>;
    if (input.action === "restore") {
      if (input.backup && typeof input.backup === "object" && !Array.isArray(input.backup)) {
        const backup = input.backup as Record<string, unknown>;
        if (backup.app !== "rsf-billing") return error("This file is not a backup from the billing app.", 400);
        for (const kind of ["parties", "items", "docs"]) {
          const records = backup[kind];
          if (records !== undefined && (!records || typeof records !== "object" || Array.isArray(records))) return error(`Backup ${kind} data is invalid.`, 400);
          if (records && typeof records === "object" && !Array.isArray(records)) {
            for (const [id, value] of Object.entries(records)) {
              if (!id || id.length > 160 || !value || typeof value !== "object" || Array.isArray(value)) return error(`Backup ${kind} contains an invalid record.`, 400);
              if ("id" in value && (value as Record<string, unknown>).id !== id) return error(`Backup ${kind} contains a mismatched record ID.`, 400);
            }
          }
        }
        if (backup.co !== undefined && (!backup.co || typeof backup.co !== "object" || Array.isArray(backup.co))) return error("Backup company settings are invalid.", 400);
        const count = await replaceRecords(backup);
        return NextResponse.json({ ok: true, count });
      }
      return error("Invalid backup file.", 400);
    }
    if (input.action === "reset") {
      await connectDB();
      await Record.deleteMany({});
      return NextResponse.json({ ok: true });
    }
    const kind = input.kind;
    const id = input.id;
    if (typeof kind !== "string" || !recordKinds.includes(kind as (typeof recordKinds)[number])) return error("Unknown record type.", 400);
    if (typeof id !== "string" || !id.trim() || id.length > 160) return error("Invalid record ID.", 400);
    if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) return error("Invalid record data.", 400);
    if (kind !== "company" && (input.data as Record<string, unknown>).id !== id) return error("Record ID does not match its data.", 400);
    await writeRecord(kind as (typeof recordKinds)[number], id, input.data);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("Could not save billing record", cause);
    return error("Could not save this record to MongoDB.", 503);
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) return error("Invalid request origin.", 403);
  if (!(await authorized(request))) return error("Please log in again.", 401);
  const kind = request.nextUrl.searchParams.get("kind");
  const id = request.nextUrl.searchParams.get("id");
  if (!kind || !recordKinds.includes(kind as (typeof recordKinds)[number]) || !id || id.length > 160) return error("Invalid record type or ID.", 400);
  try {
    await connectDB();
    await removeRecord(kind as (typeof recordKinds)[number], id);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    console.error("Could not delete billing record", cause);
    return error("Could not delete this record from MongoDB.", 503);
  }
}
