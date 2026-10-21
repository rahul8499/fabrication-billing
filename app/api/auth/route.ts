import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { createSession, isSameOrigin, requestUsername, SESSION_COOKIE } from "@/lib/auth";
import { connectDB, loadRecords, User } from "@/lib/db";

export const runtime = "nodejs";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const username = await requestUsername(request);
    await connectDB();
    const initialized = (await User.countDocuments()) > 0;
    const records = username ? await loadRecords() : {};
    return NextResponse.json({ initialized, authenticated: Boolean(username), username, ...records });
  } catch (cause) {
    console.error("Authentication status could not be loaded", cause);
    return error("Database is unavailable or not configured.", 503);
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return error("Invalid request origin.", 403);
  try {
    await connectDB();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return error("Invalid request.", 400);
    const input = body as Record<string, unknown>;
    const action = input.action;

    if (action === "logout") {
      const response = NextResponse.json({ ok: true });
      response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
      return response;
    }

    const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!/^[a-z0-9._-]{3,64}$/.test(username)) return error("Username must be 3–64 characters (letters, numbers, dot, underscore, hyphen).", 400);
    if (password.length < 12 || password.length > 200) return error("Password must be at least 12 characters.", 400);

    let user = await User.findOne({ username });
    if (action === "setup") {
      if (await User.countDocuments()) return error("Initial account has already been created. Please log in.", 409);
      const passwordHash = await bcrypt.hash(password, 12);
      try {
        user = await User.create({ username, passwordHash });
      } catch (cause) {
        if (cause && typeof cause === "object" && "code" in cause && cause.code === 11000) return error("Initial account has already been created. Please log in.", 409);
        throw cause;
      }
    } else if (action === "login") {
      if (!user) return error("Username or password is incorrect.", 401);
      if (user.lockedUntil && user.lockedUntil > new Date()) return error("Too many failed attempts. Try again in 15 minutes.", 429);
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        const failedLogins = user.failedLogins + 1;
        await User.updateOne({ _id: user._id }, {
          $set: { failedLogins, lockedUntil: failedLogins >= 8 ? new Date(Date.now() + 15 * 60 * 1000) : null },
        });
        return error("Username or password is incorrect.", failedLogins >= 8 ? 429 : 401);
      }
      await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null } });
    } else if (action === "change-password") {
      const current = await requestUsername(request);
      const currentUser = current ? await User.findOne({ username: current }) : null;
      if (!currentUser || typeof input.currentPassword !== "string" || !(await bcrypt.compare(input.currentPassword, currentUser.passwordHash))) {
        return error("Current password is incorrect.", 401);
      }
      currentUser.passwordHash = await bcrypt.hash(password, 12);
      await currentUser.save();
      const response = NextResponse.json({ ok: true });
      response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
      return response;
    } else {
      return error("Unknown authentication action.", 400);
    }

    const token = await createSession(username);
    const response = NextResponse.json({ ok: true, username });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch (cause) {
    console.error("Authentication request failed", cause);
    return error("Could not complete authentication. Check server configuration.", 503);
  }
}
