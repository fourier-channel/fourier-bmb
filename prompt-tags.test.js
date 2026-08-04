"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { extractCreatorTags, pngTextChunks, promptToTags } = require("./prompt-tags");

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.from([0, 0, 0, 0])]); // dummy CRC
}
function png(chunks) { return Buffer.concat([SIG, ...chunks]); }
function tEXt(keyword, text) { return chunk("tEXt", Buffer.from(keyword + "\0" + text, "latin1")); }

test("A1111: content vs quality/meta split; weights/lora/negatives dropped", () => {
  const params =
    "masterpiece, best quality, highres, 1girl, solo, twintails, blue_hair, (smile:1.2), <lora:foo:0.8>\n" +
    "Negative prompt: bad hands, lowres\n" +
    "Steps: 20, Sampler: Euler a";
  const r = extractCreatorTags(png([tEXt("parameters", params), chunk("IEND", Buffer.alloc(0))]), "image/png");
  assert.ok(r.tags.includes("1girl") && r.tags.includes("twintails") && r.tags.includes("blue_hair"));
  assert.ok(r.tags.includes("smile"), "weight stripped to bare tag");
  assert.ok(r.meta.includes("masterpiece") && r.meta.includes("best_quality") && r.meta.includes("highres"), "quality/meta classified, not dropped");
  assert.ok(!r.tags.includes("masterpiece"), "quality term kept out of content bucket");
  assert.ok(!r.tags.includes("bad_hands"), "negative prompt excluded");
  assert.ok(!r.tags.concat(r.meta).some((t) => t.includes("lora")), "lora token removed");
});

test("ComfyUI: positive CLIP text chosen over the shorter negative", () => {
  const graph = JSON.stringify({
    "3": { class_type: "CLIPTextEncode", inputs: { text: "masterpiece, 1girl, hoodie, backpack, monochrome" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "lowres, bad" } },
  });
  const r = extractCreatorTags(png([tEXt("prompt", graph), chunk("IEND", Buffer.alloc(0))]), "image/png");
  assert.ok(r.tags.includes("1girl") && r.tags.includes("hoodie") && r.tags.includes("backpack"));
  assert.ok(r.meta.includes("masterpiece"));
  assert.ok(!r.tags.includes("lowres"), "negative CLIP text not chosen");
});

test("zTXt (compressed) parameters inflate and read as content", () => {
  const comp = zlib.deflateSync(Buffer.from("landscape, scenery, no_humans, wide_shot", "utf8"));
  const data = Buffer.concat([Buffer.from("parameters\0", "latin1"), Buffer.from([0]), comp]);
  const r = extractCreatorTags(png([chunk("zTXt", data), chunk("IEND", Buffer.alloc(0))]), "image/png");
  assert.deepEqual(r.tags, ["landscape", "scenery", "no_humans", "wide_shot"]);
  assert.deepEqual(r.meta, []);
});

test("non-AI image (no text chunks) -> empty tags and meta", () => {
  assert.deepEqual(extractCreatorTags(png([chunk("IEND", Buffer.alloc(0))]), "image/png"), { tags: [], meta: [] });
});

test("non-PNG / null bytes -> empty (never throws)", () => {
  assert.deepEqual(extractCreatorTags(Buffer.from("ffd8ffe0", "hex"), "image/jpeg"), { tags: [], meta: [] });
  assert.deepEqual(extractCreatorTags(null, ""), { tags: [], meta: [] });
});

test("promptToTags dedupes content and respects max (meta not counted against max)", () => {
  assert.deepEqual(promptToTags("1girl, 1girl, solo", {}).tags, ["1girl", "solo"]);
  assert.equal(promptToTags("a_tag, b_tag, c_tag", { max: 2 }).tags.length, 2);
});

test("pngTextChunks returns {} for a truncated buffer", () => {
  assert.deepEqual(pngTextChunks(Buffer.from([1, 2, 3])), {});
});
