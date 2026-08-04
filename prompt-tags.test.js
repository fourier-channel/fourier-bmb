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

test("A1111 parameters: prompt only, weights + lora stripped, negatives/steps dropped", () => {
  const params =
    "1girl, solo, twintails, blue_hair, (smile:1.2), <lora:foo:0.8>\n" +
    "Negative prompt: bad hands, lowres\n" +
    "Steps: 20, Sampler: Euler a, CFG scale: 7";
  const tags = extractCreatorTags(png([tEXt("parameters", params), chunk("IEND", Buffer.alloc(0))]), "image/png");
  assert.ok(tags.includes("1girl"));
  assert.ok(tags.includes("twintails"));
  assert.ok(tags.includes("blue_hair"));
  assert.ok(tags.includes("smile"), "weight stripped to bare tag");
  assert.ok(!tags.includes("bad_hands"), "negative prompt excluded");
  assert.ok(!tags.some((t) => t.startsWith("steps")), "params excluded");
  assert.ok(!tags.some((t) => t.includes("lora")), "lora token removed");
});

test("ComfyUI prompt graph: picks the positive CLIP text over the shorter negative", () => {
  const graph = JSON.stringify({
    "3": { class_type: "CLIPTextEncode", inputs: { text: "masterpiece, 1girl, hoodie, backpack, monochrome" } },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "lowres, bad" } },
    "5": { class_type: "KSampler", inputs: { seed: 42 } },
  });
  const tags = extractCreatorTags(png([tEXt("prompt", graph), chunk("IEND", Buffer.alloc(0))]), "image/png");
  assert.ok(tags.includes("1girl") && tags.includes("hoodie") && tags.includes("backpack"));
  assert.ok(!tags.includes("lowres"), "negative CLIP text not chosen");
});

test("zTXt (compressed) parameters are inflated and read", () => {
  const params = "landscape, scenery, no_humans, wide_shot";
  const comp = zlib.deflateSync(Buffer.from(params, "utf8"));
  const data = Buffer.concat([Buffer.from("parameters\0", "latin1"), Buffer.from([0]), comp]); // keyword \0 method comp
  const tags = extractCreatorTags(png([chunk("zTXt", data), chunk("IEND", Buffer.alloc(0))]), "image/png");
  assert.deepEqual(tags, ["landscape", "scenery", "no_humans", "wide_shot"]);
});

test("non-AI image (no text chunks) yields no creator tags", () => {
  assert.deepEqual(extractCreatorTags(png([chunk("IEND", Buffer.alloc(0))]), "image/png"), []);
});

test("non-PNG bytes yield no creator tags (never throws)", () => {
  assert.deepEqual(extractCreatorTags(Buffer.from("ffd8ffe0", "hex"), "image/jpeg"), []);
  assert.deepEqual(extractCreatorTags(null, ""), []);
});

test("promptToTags dedupes and respects max", () => {
  assert.deepEqual(promptToTags("1girl, 1girl, solo", {}), ["1girl", "solo"]);
  assert.equal(promptToTags("a_tag, b_tag, c_tag", { max: 2 }).length, 2);
});

test("pngTextChunks returns {} for a truncated/garbage buffer", () => {
  assert.deepEqual(pngTextChunks(Buffer.from([1, 2, 3])), {});
});
