"use strict";

// Creator-tag extraction: AI-generated images embed their generation prompt in
// PNG textual chunks. Parse it out and normalise it into Danbooru-style tags --
// the CREATOR-submitted provenance source (green in the UI). Best-effort and
// dependency-free; returns [] for anything it can't read.
//
// Supported embeddings:
//   - AUTOMATIC1111 / SD-webui : tEXt "parameters"  ("<prompt>\nNegative prompt:...\nSteps:...")
//   - ComfyUI                  : tEXt "prompt"       (JSON graph; CLIPTextEncode.text)
//   - NovelAI                  : tEXt/iTXt "Comment" (JSON with .prompt) or "Description"

const zlib = require("zlib");

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Read tEXt / zTXt / iTXt textual chunks from a PNG buffer -> { keyword: text }.
// CRCs are not validated (we only read metadata, never re-emit the file).
function pngTextChunks(buf) {
  const out = {};
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return out;
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const start = off + 8;
    const end = start + len;
    if (end > buf.length) break;
    const data = buf.subarray(start, end);
    try {
      if (type === "tEXt") {
        const z = data.indexOf(0);
        if (z > 0) out[data.toString("latin1", 0, z)] = data.toString("latin1", z + 1);
      } else if (type === "zTXt") {
        const z = data.indexOf(0);
        if (z > 0) out[data.toString("latin1", 0, z)] = zlib.inflateSync(data.subarray(z + 2)).toString("utf8");
      } else if (type === "iTXt") {
        const z = data.indexOf(0);
        if (z > 0) {
          const keyword = data.toString("latin1", 0, z);
          const compressed = data[z + 1] === 1;
          // keyword \0 compFlag compMethod langTag \0 translatedKeyword \0 text
          let p = z + 3;
          p = data.indexOf(0, p) + 1;
          p = data.indexOf(0, p) + 1;
          const text = data.subarray(p);
          out[keyword] = compressed ? zlib.inflateSync(text).toString("utf8") : text.toString("utf8");
        }
      }
    } catch (e) { /* skip a malformed chunk, keep scanning */ }
    if (type === "IEND") break;
    off = end + 4; // + CRC
  }
  return out;
}

// Pull the positive-prompt string out of whatever embedding is present.
function rawPrompt(chunks) {
  if (typeof chunks.parameters === "string") {
    const t = chunks.parameters;
    const neg = t.indexOf("\nNegative prompt:");
    const steps = t.indexOf("\nSteps:");
    const end = neg >= 0 ? neg : (steps >= 0 ? steps : t.length);
    return t.slice(0, end).trim();
  }
  if (typeof chunks.prompt === "string") {
    try {
      const graph = JSON.parse(chunks.prompt);
      const texts = [];
      for (const k in graph) {
        const node = graph[k];
        if (node && /CLIPTextEncode/i.test(node.class_type || "") &&
            node.inputs && typeof node.inputs.text === "string") {
          texts.push(node.inputs.text);
        }
      }
      // The longest CLIP text block is almost always the positive prompt.
      texts.sort((a, b) => b.length - a.length);
      if (texts.length) return texts[0].trim();
    } catch (e) { /* not JSON we understand */ }
  }
  for (const key of ["Comment", "Description"]) {
    if (typeof chunks[key] === "string") {
      try {
        const c = JSON.parse(chunks[key]);
        if (c && typeof c.prompt === "string") return c.prompt.trim();
      } catch (e) {
        if (key === "Description") return chunks[key].trim();
      }
    }
  }
  return "";
}

// Normalise a freeform prompt into Danbooru-style tags: comma-split, strip
// weights/brackets/LoRA tokens, lowercase, spaces -> underscores, dedupe.
function promptToTags(prompt, opts) {
  const max = (opts && opts.max) || 60;
  if (!prompt) return [];
  const seen = new Set();
  const tags = [];
  const cleaned = String(prompt).replace(/<[^>]*>/g, " ").replace(/\bBREAK\b/g, ",");
  for (const raw of cleaned.split(",")) {
    const t = raw
      .replace(/[()[\]{}]/g, " ")
      .replace(/:\s*[\d.]+/g, " ")   // (tag:1.2) emphasis weights
      .replace(/\\+/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_'./-]/g, "");
    if (t.length < 2 || t.length > 60) continue;
    if (/^[\d_.]+$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tags.push(t);
    if (tags.length >= max) break;
  }
  return tags;
}

// Public: image bytes -> creator (prompt-derived) tags. Never throws.
function extractCreatorTags(buffer, contentType, opts) {
  try {
    const isPng = (contentType && /png/i.test(contentType)) ||
      (Buffer.isBuffer(buffer) && buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50);
    if (isPng) return promptToTags(rawPrompt(pngTextChunks(buffer)), opts);
  } catch (e) { /* fail soft */ }
  return [];
}

module.exports = { extractCreatorTags, pngTextChunks, rawPrompt, promptToTags };
