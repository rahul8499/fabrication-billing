import mongoose, { Schema, type AnyBulkWriteOperation } from "mongoose";

const uri = process.env.MONGODB_URI;

type CachedConnection = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const globalForMongoose = globalThis as typeof globalThis & { mongooseCache?: CachedConnection };
const cache = globalForMongoose.mongooseCache ?? { conn: null, promise: null };
globalForMongoose.mongooseCache = cache;

export async function connectDB() {
  if (!uri) throw new Error("MONGODB_URI is not configured.");
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(uri, { bufferCommands: false, serverSelectionTimeoutMS: 10000 })
      .catch((error: unknown) => {
        cache.promise = null;
        throw error;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 64 },
  passwordHash: { type: String, required: true },
  failedLogins: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

const recordSchema = new Schema({
  kind: { type: String, required: true, enum: ["company", "parties", "items", "docs"] },
  recordId: { type: String, required: true, maxlength: 160 },
  payload: { type: Schema.Types.Mixed, required: true },
}, { timestamps: true, versionKey: false });
recordSchema.index({ kind: 1, recordId: 1 }, { unique: true });

export const User = mongoose.models.User || mongoose.model("User", userSchema);
export const Record = mongoose.models.Record || mongoose.model("Record", recordSchema);

export type RecordKind = "company" | "parties" | "items" | "docs";
export const recordKinds: RecordKind[] = ["company", "parties", "items", "docs"];

export async function loadRecords() {
  await connectDB();
  const records = await Record.find({}).lean();
  const result: Record<string, Record<string, unknown>> = { parties: {}, items: {}, docs: {} };
  for (const row of records) {
    if (row.kind === "company") result.company = row.payload as Record<string, unknown>;
    else result[row.kind][row.recordId] = row.payload as Record<string, unknown>;
  }
  return result;
}

export async function writeRecord(kind: RecordKind, id: string, payload: unknown) {
  await connectDB();
  await Record.findOneAndUpdate(
    { kind, recordId: id },
    { $set: { payload } },
    { upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );
}

export async function removeRecord(kind: RecordKind, id: string) {
  await connectDB();
  await Record.deleteOne({ kind, recordId: id });
}

export async function replaceRecords(input: Record<string, unknown>) {
  await connectDB();
  const ops: AnyBulkWriteOperation[] = [];
  for (const kind of ["parties", "items", "docs"] as const) {
    const values = input[kind];
    if (values === undefined) continue;
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(`Invalid ${kind} backup data.`);
    for (const [id, payload] of Object.entries(values)) {
      if (!id || id.length > 160 || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error(`Invalid ${kind} record in backup.`);
      if ("id" in payload && payload.id !== id) throw new Error(`Mismatched ${kind} record ID in backup.`);
      ops.push({
        updateOne: {
          filter: { kind, recordId: id },
          update: { $set: { payload } },
          upsert: true,
        },
      });
    }
  }
  if (input.co !== undefined && (!input.co || typeof input.co !== "object" || Array.isArray(input.co))) throw new Error("Invalid company settings in backup.");
  if (input.co) {
    ops.push({
      updateOne: {
        filter: { kind: "company", recordId: "company" },
        update: { $set: { payload: input.co } },
        upsert: true,
      },
    });
  }
  if (ops.length) await Record.bulkWrite(ops, { ordered: true });
  return ops.length;
}
