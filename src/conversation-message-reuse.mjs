// API snapshots contain JSON data. Compare every field, including fields added
// by a newer server, without tying rendering to a hand-maintained field list.
function isPlainObject(value) {
  const prototype = Object.getPrototypeOf(value);
  // Accept plain JSON objects from another browser/VM realm as well.
  return prototype === null || Object.getPrototypeOf(prototype) === null && Object.hasOwn(prototype, 'constructor') && prototype.constructor?.name === 'Object';
}

function sameJsonData(left, right) {
  const pending = [[left, right]], seenLeft = new Set(), seenRight = new Set();
  while (pending.length) {
    const [a, b] = pending.pop();
    if (a === b && (a === null || typeof a === 'string' || typeof a === 'boolean' || typeof a === 'number' && Number.isFinite(a))) continue;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    // Malformed/non-JSON values and cycles cannot establish a reusable snapshot.
    if (seenLeft.has(a) || seenRight.has(b)) return false;
    seenLeft.add(a); seenRight.add(b);
    const arrays = Array.isArray(a);
    if (arrays !== Array.isArray(b)) return false;
    if (arrays) {
      if (a.length !== b.length || Object.keys(a).length !== a.length || Object.keys(b).length !== b.length) return false;
      for (let index = 0; index < a.length; index++) pending.push([a[index], b[index]]);
    } else {
      if (!isPlainObject(a) || !isPlainObject(b)) return false;
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false;
        pending.push([a[key], b[key]]);
      }
    }
  }
  return true;
}

const messageId = message => message && typeof message === 'object' && !Array.isArray(message) && typeof message.id === 'string' && message.id ? message.id : null;

/** Reuse unchanged JSON messages while keeping the incoming snapshot authoritative. */
export function reuseConversationMessages(before, incoming) {
  if (!before || !incoming || typeof incoming.id !== 'string' || !incoming.id || before.id !== incoming.id || !Array.isArray(before.messages) || !Array.isArray(incoming.messages)) return incoming;
  const previous = before.messages, messages = incoming.messages;
  if (previous === messages) return incoming;
  let result = null, byId = null, used = null, sameOrder = previous.length === messages.length;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index], id = messageId(message), aligned = previous[index];
    let candidate = null, candidateIndex = index;
    if (id && messageId(aligned) === id) {
      // Appends and content updates stay on this path; they need no ID map.
      if (!used?.has(index) && (aligned === message || sameJsonData(aligned, message))) candidate = aligned;
    } else if (id) {
      if (!byId) {
        byId = new Map(); used = new Set();
        for (let oldIndex = 0; oldIndex < previous.length; oldIndex++) {
          const oldId = messageId(previous[oldIndex]);
          if (oldId) byId.set(oldId, byId.has(oldId) ? null : oldIndex);
          if (oldIndex < index && (result ? result[oldIndex] : messages[oldIndex]) === previous[oldIndex]) used.add(oldIndex);
        }
      }
      const oldIndex = byId.get(id);
      // Duplicate IDs are ambiguous on a reorder; never guess which row owns one.
      if (oldIndex != null && !used.has(oldIndex) && sameJsonData(previous[oldIndex], message)) {
        candidate = previous[oldIndex]; candidateIndex = oldIndex;
      }
    }
    if (candidate) used?.add(candidateIndex);
    const next = candidate || message;
    if (!candidate || next !== aligned) sameOrder = false;
    if (!result && next !== message) result = messages.slice(0, index);
    result?.push(next);
  }
  if (sameOrder) return {...incoming, messages: previous};
  return result ? {...incoming, messages: result} : incoming;
}
