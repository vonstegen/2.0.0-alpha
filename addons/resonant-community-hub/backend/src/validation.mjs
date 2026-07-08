// Input validation for write endpoints (spec §6: "All write endpoints:
// rate-limited, auth-guarded, input-validated"). Each validator returns a
// normalized value or throws ValidationError with a 400-shaped payload. Keeping
// validation pure and separate keeps the handlers thin and the rules unit-testable.

export class ValidationError extends Error {
  /** @param {string} message @param {{ field?: string }} [opts] */
  constructor(message, { field } = {}) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
    this.code = "invalid_input";
    this.field = field ?? null;
  }
}

const RSVP_STATES = new Set(["going", "interested", "no"]);
const CLAIM_ACTIONS = new Set(["claim", "unclaim"]);

function str(value, field, { required = false, max = 2000, trim = true } = {}) {
  if (value == null) {
    if (required) throw new ValidationError(`\`${field}\` is required.`, { field });
    return null;
  }
  if (typeof value !== "string") {
    throw new ValidationError(`\`${field}\` must be a string.`, { field });
  }
  const out = trim ? value.trim() : value;
  if (required && out.length === 0) {
    throw new ValidationError(`\`${field}\` must not be empty.`, { field });
  }
  if (out.length > max) {
    throw new ValidationError(`\`${field}\` exceeds ${max} characters.`, { field });
  }
  return out.length === 0 ? null : out;
}

function isoOrThrow(value, field, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) throw new ValidationError(`\`${field}\` is required.`, { field });
    return null;
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) {
    throw new ValidationError(`\`${field}\` must be an ISO-8601 timestamp.`, { field });
  }
  return new Date(t).toISOString();
}

function asObject(body, label = "request body") {
  if (body == null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError(`${label} must be a JSON object.`);
  }
  return body;
}

/** POST /v1/events — create event (spec FR-E2). */
export function validateCreateEvent(body) {
  const b = asObject(body);
  const title = str(b.title, "title", { required: true, max: 200 });
  const description = str(b.description, "description", { max: 5000 });
  const startsAt = isoOrThrow(b.startsAt, "startsAt", { required: true });
  const endsAt = isoOrThrow(b.endsAt, "endsAt");
  if (endsAt && endsAt < startsAt) {
    throw new ValidationError("`endsAt` must be at or after `startsAt`.", { field: "endsAt" });
  }
  const location = str(b.location, "location", { max: 500 });
  const url = str(b.url, "url", { max: 2000 });
  if (!location && !url) {
    throw new ValidationError("Provide at least one of `location` or `url`.", { field: "location" });
  }
  if (url && !/^https?:\/\//i.test(url)) {
    throw new ValidationError("`url` must be an http(s) URL.", { field: "url" });
  }
  return { title, description, startsAt, endsAt, location, url };
}

/** POST /v1/events/:id/rsvp (spec FR-E3). */
export function validateRsvp(body) {
  const b = asObject(body);
  const state = str(b.state, "state", { required: true, max: 20 });
  if (!RSVP_STATES.has(state)) {
    throw new ValidationError("`state` must be one of: going, interested, no.", { field: "state" });
  }
  return { state };
}

/** POST /v1/tasks/:id/claim (spec FR-T2). Defaults to claim. */
export function validateClaim(body) {
  const b = asObject(body);
  const action = b.action == null ? "claim" : str(b.action, "action", { max: 20 });
  if (!CLAIM_ACTIONS.has(action)) {
    throw new ValidationError("`action` must be `claim` or `unclaim`.", { field: "action" });
  }
  return { action };
}

/**
 * PUT /v1/presence (spec FR-P1). Two shapes:
 *   - clear:  { clear: true }  (or an empty body) -> remove presence.
 *   - set:    { status, note? } -> upsert presence (status required).
 */
export function validatePresence(body) {
  const b = asObject(body);
  const wantsClear = b.clear === true || (b.status == null && b.note == null && b.clear == null);
  if (wantsClear) return { clear: true };
  const status = str(b.status, "status", { required: true, max: 120 });
  const note = str(b.note, "note", { max: 280 });
  return { clear: false, status, note };
}
