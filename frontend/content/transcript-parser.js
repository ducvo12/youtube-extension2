/*
 * Transcript parser utilities.
 *
 * This file is the format-normalization layer for captions.
 * The functions here convert supported YouTube caption formats into the single
 * segment shape used by the rest of the content script:
 *
 *   {
 *     startMs: number,
 *     durationMs: number,
 *     text: string
 *   }
 *
 * After parsing, transcript-loader code passes those segments to the caption
 * river renderer, chat context builder, and active-caption lookup logic.
 */

// Converts YouTube json3 event objects into the extension's transcript segment shape.
function parseTranscriptEvents(events = []) {
  return events
    .map((event) => ({
      startMs: event.tStartMs || 0,
      durationMs: event.dDurationMs || 0,
      text: (event.segs || [])
        .map((segment) => segment.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    }))
    .filter((segment) => segment.text);
}

// Parses a json3 caption response body.
function parseJsonTranscript(body) {
  return parseTranscriptEvents(JSON.parse(body).events);
}

// Parses an XML/srv-style caption response body.
function parseXmlTranscript(body) {
  const document = new DOMParser().parseFromString(body, "text/xml");
  const parserError = document.querySelector("parsererror");

  if (parserError) {
    throw new Error("Invalid XML transcript response");
  }

  return Array.from(document.querySelectorAll("text"))
    .map((node) => ({
      startMs: Math.round(Number(node.getAttribute("start") || 0) * 1000),
      durationMs: Math.round(Number(node.getAttribute("dur") || 0) * 1000),
      text: (node.textContent || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((segment) => segment.text);
}

// Converts a WebVTT timestamp string into milliseconds.
function parseVttTimestamp(timestamp) {
  const parts = timestamp.trim().split(":");
  const seconds = Number(parts.pop() || 0);
  const minutes = Number(parts.pop() || 0);
  const hours = Number(parts.pop() || 0);

  return Math.round(((hours * 60 * 60) + (minutes * 60) + seconds) * 1000);
}

// Parses a WebVTT caption response body.
function parseVttTranscript(body) {
  const blocks = body.replace(/\r/g, "").split("\n\n");

  return blocks
    .map((block) => {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));

      if (timingIndex === -1) {
        return null;
      }

      const [start, end] = lines[timingIndex].split("-->").map((value) => value.trim().split(" ")[0]);
      const startMs = parseVttTimestamp(start);
      const endMs = parseVttTimestamp(end);
      const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      return {
        startMs,
        durationMs: Math.max(0, endMs - startMs),
        text,
      };
    })
    .filter((segment) => segment?.text);
}

// Parses a transcript body when the caller already knows the requested format.
function parseTranscriptBody(body, format) {
  if (format === "json3") {
    return parseJsonTranscript(body);
  }

  if (format === "srv3" || !format) {
    return parseXmlTranscript(body);
  }

  return parseVttTranscript(body);
}

// MAIN FUNCTION (called by other modules to parse transcript)
// Tries likely transcript parsers until one returns usable caption segments.
function parseTranscriptBodyAuto(body) {
  const trimmedBody = body.trim();
  const parsers = [];

  if (trimmedBody.startsWith("{")) {
    parsers.push(() => parseJsonTranscript(trimmedBody));
  }

  if (trimmedBody.startsWith("<")) {
    parsers.push(() => parseXmlTranscript(trimmedBody));
  }

  parsers.push(() => parseVttTranscript(trimmedBody));
  parsers.push(() => parseJsonTranscript(trimmedBody));
  parsers.push(() => parseXmlTranscript(trimmedBody));

  for (const parser of parsers) {
    try {
      const segments = parser();

      if (segments.length) {
        return segments;
      }
    } catch (_error) {
      // Try the next format.
    }
  }

  return [];
}
