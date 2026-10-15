const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");

function assertSafeModelArchiveEntry(entry, expectedRoot) {
  const name = entry.path.replace(/^\.\//, "");
  const parts = name.split("/");
  if (
    !["File", "Directory"].includes(entry.type) ||
    /[\\:\x00-\x1f]/.test(name) ||
    parts[0] !== expectedRoot ||
    parts.some((part) => part === ".." || part === "." || /[. ]$/.test(part)) ||
    parts.slice(0, -1).includes("")
  )
    throw new Error("Unsafe model archive entry");
}

async function validateModelArchive(archivePath, expectedRoot) {
  const tar = require("tar");
  const unbzip2 = require("unbzip2-stream");
  let count = 0;
  let size = 0;
  const parser = tar.t({
    strict: true,
    onReadEntry(entry) {
      try {
        assertSafeModelArchiveEntry(entry, expectedRoot);
        count += 1;
        size += entry.size;
        if (count > 100000 || size > 200 * 1024 ** 3)
          throw new Error("Model archive exceeds limits");
      } catch (error) {
        parser.abort(error);
      }
    },
  });
  await pipeline(fs.createReadStream(archivePath), unbzip2(), parser);
  if (!count) throw new Error("Empty model archive");
}

module.exports = { assertSafeModelArchiveEntry, validateModelArchive };
