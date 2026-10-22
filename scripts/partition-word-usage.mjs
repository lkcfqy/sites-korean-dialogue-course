import fs from "node:fs";
import crypto from "node:crypto";
import { buildDepthStatistics } from "./build-depth-statistics.mjs";
const usage = JSON.parse(fs.readFileSync("data/vocabulary-usage.json", "utf8"));
const directory = "public/word-usage";
fs.mkdirSync(directory, { recursive: true });
const paths = {},
  keep = new Set();
for (const [word, senses] of Object.entries(usage)) {
  const raw =
    JSON.stringify({
      word,
      senses,
      license: "CC BY-SA 2.0 KR",
      release: "2026-09-19",
    }) + "\n";
  const name =
    crypto.createHash("sha256").update(raw).digest("hex").slice(0, 20) +
    ".json";
  if (keep.has(name)) throw new Error("Usage hash collision");
  keep.add(name);
  paths[word] = `/word-usage/${name}`;
  const file = `${directory}/${name}`;
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== raw)
    fs.writeFileSync(file, raw);
}
// Only stale generated assets in this compiler-owned directory are removed.
for (const name of fs.readdirSync(directory))
  if (name.endsWith(".json") && !keep.has(name))
    fs.unlinkSync(`${directory}/${name}`);
const index = JSON.stringify(paths) + "\n";
if (
  !fs.existsSync("data/word-usage-paths.json") ||
  fs.readFileSync("data/word-usage-paths.json", "utf8") !== index
)
  fs.writeFileSync("data/word-usage-paths.json", index);
console.log(
  `Partitioned ${keep.size} word contexts; no full dictionary in the runtime bundle.`,
);
buildDepthStatistics();
