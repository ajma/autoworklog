/**
 * Packages the extension into dist/auto-work-log.zip, excluding dev files.
 * Run with: npm run pack
 */

import archiver from "archiver";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const distDir = path.join(root, "dist");

fs.mkdirSync(distDir, { recursive: true });

const outPath = path.join(distDir, "auto-work-log.zip");
const output = fs.createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.pipe(output);

const files = ["manifest.json", "background.js", "popup.html", "popup.js", "options.html", "options.js", "utils.js", "styles.css"];
for (const file of files) {
  archive.file(path.join(root, file), { name: file });
}
archive.directory(path.join(root, "icons"), "icons");

output.on("close", () => {
  console.log(`Packed: dist/auto-work-log.zip (${(archive.pointer() / 1024).toFixed(1)} KB)`);
});
archive.on("error", (err) => {
  throw err;
});

archive.finalize();
