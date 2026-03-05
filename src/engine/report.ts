import * as fs from "fs/promises";
import * as path from "path";

export async function writeJsonReport(reportPath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(data, null, 2), "utf8");
}

export async function writeReportBundle(reportPath: string, data: unknown): Promise<void> {
  await writeJsonReport(reportPath, data);

  const mdPath = reportPath.replace(/\.json$/i, ".md");
  const stamp = new Date().toISOString();
  const summary = [
    "# AI Client Migration Report",
    "",
    `- Generated At: ${stamp}`,
    `- JSON Report: ${path.basename(reportPath)}`,
    "",
    "## Payload",
    "```json",
    JSON.stringify(data, null, 2),
    "```",
    ""
  ].join("\n");

  await fs.writeFile(mdPath, summary, "utf8");
}
