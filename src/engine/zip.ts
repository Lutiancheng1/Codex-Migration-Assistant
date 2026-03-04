import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { pipeline } from "stream/promises";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import { listFilesRecursive } from "./fileTree";

function asPosix(relPath: string): string {
  return relPath.split(path.sep).join(path.posix.sep);
}

export async function createZipFromDirectory(sourceDir: string, zipPath: string): Promise<void> {
  const files = await listFilesRecursive(sourceDir);
  await fsp.mkdir(path.dirname(zipPath), { recursive: true });

  const zip = new yazl.ZipFile();
  const output = fs.createWriteStream(zipPath);
  const streamPromise = pipeline(zip.outputStream, output);

  for (const file of files) {
    const rel = asPosix(path.relative(sourceDir, file));
    zip.addFile(file, rel);
  }

  zip.end();
  await streamPromise;
}

function safeResolve(baseDir: string, zipEntryPath: string): string {
  const cleaned = zipEntryPath.replace(/\\/g, "/");
  const target = path.resolve(baseDir, cleaned);
  const baseWithSep = baseDir.endsWith(path.sep) ? baseDir : `${baseDir}${path.sep}`;
  if (target !== baseDir && !target.startsWith(baseWithSep)) {
    throw new Error(`Unsafe zip entry path: ${zipEntryPath}`);
  }
  return target;
}

export async function extractZipToDirectory(zipPath: string, targetDir: string): Promise<void> {
  await fsp.mkdir(targetDir, { recursive: true });

  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, file) => {
      if (err || !file) {
        reject(err ?? new Error("Failed to open zip file"));
        return;
      }
      resolve(file);
    });
  });

  await new Promise<void>((resolve, reject) => {
    zipFile.readEntry();

    zipFile.on("entry", (entry) => {
      const isDir = /\/$/.test(entry.fileName);
      let destPath: string;
      try {
        destPath = safeResolve(targetDir, entry.fileName);
      } catch (err) {
        reject(err);
        return;
      }

      if (isDir) {
        fsp
          .mkdir(destPath, { recursive: true })
          .then(() => zipFile.readEntry())
          .catch(reject);
        return;
      }

      fsp
        .mkdir(path.dirname(destPath), { recursive: true })
        .then(() => {
          zipFile.openReadStream(entry, (err, readStream) => {
            if (err || !readStream) {
              reject(err ?? new Error(`Failed to read zip entry: ${entry.fileName}`));
              return;
            }

            const out = fs.createWriteStream(destPath);
            pipeline(readStream, out)
              .then(() => zipFile.readEntry())
              .catch(reject);
          });
        })
        .catch(reject);
    });

    zipFile.once("end", () => {
      zipFile.close();
      resolve();
    });

    zipFile.once("error", (err) => {
      zipFile.close();
      reject(err);
    });
  });
}
