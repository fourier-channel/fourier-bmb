// Dev proof harness (not part of the bridge): exercise the exact autotag()
// that index.js calls, against a running fourier-spectrum, on a real image.
//   node dev-autotag.js [image-path] [spectrum-url]
const fs = require("fs");
const { autotag } = require("./autotagger");

async function main() {
  const path = process.argv[2] || "/home/saber/jpegtest/test.jpg";
  const url = process.argv[3] || "http://127.0.0.1:5000";
  const buffer = fs.readFileSync(path);
  const t0 = Date.now();
  const result = await autotag(buffer, {
    autotagger: { url, general_threshold: 0.5 },
  });
  console.log(`autotag(${path}) via ${url}  [${Date.now() - t0} ms]`);
  console.log("rating (booru letter):", result.rating);
  console.log("tag count            :", result.tags.length);
  console.log("tag_string (-> post) :", result.tags.join(" ").slice(0, 200));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
