import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB, User } from "../lib/db";

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal so the password can be hidden.");
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Password reset cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && value.length < 200) value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  await connectDB();
  try {
    const users = await User.find({}).limit(2);
    if (users.length === 0) throw new Error("No admin account exists yet. Open the app to create the first account.");
    if (users.length !== 1) throw new Error("Expected one admin account. Contact your database administrator instead of resetting an arbitrary account.");

    const password = await readHidden("Enter a new admin password (minimum 12 characters; input is hidden): ");
    if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
    const confirmation = await readHidden("Confirm the new password: ");
    if (password !== confirmation) throw new Error("Passwords do not match.");

    users[0].passwordHash = await bcrypt.hash(password, 12);
    users[0].failedLogins = 0;
    users[0].lockedUntil = null;
    await users[0].save();
    process.stdout.write(`Admin password reset successfully.\nAdmin username: ${users[0].username}\nYour business records were not changed.\n`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : "Admin password reset failed."}\n`);
  process.exitCode = 1;
});
