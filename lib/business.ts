import { promises as fs } from "fs";
import path from "path";

/**
 * Reads business_info.md from the project root. This document is the ground
 * truth injected into every AI decision (copilot planning + daily optimizer).
 */
export async function readBusinessInfo(): Promise<string> {
  const file = path.join(process.cwd(), "business_info.md");
  try {
    return await fs.readFile(file, "utf-8");
  } catch {
    return "No business_info.md found. Ask the user for business context before planning.";
  }
}
