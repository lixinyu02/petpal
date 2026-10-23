// Rendering candidates are pure. Only the owning component's committed layout
// effect may publish one as the next comparison snapshot.
const sameProps = (before, after) => {
  if (before === after) return true;
  const keys = Object.keys(before);
  if (keys.length !== Object.keys(after).length) return false;
  return keys.every(key => Object.hasOwn(after, key) && Object.is(before[key], after[key]));
};
const usableId = id => typeof id === 'string' && id.length > 0;

/** Preserve one flat keyed sibling list; a Fragment block would remount rows
 * moved across block boundaries. Message data follows React's immutable-props
 * contract, as do inputs. The pure properties function must derive every row
 * prop from its message and complete inputs, not changing captured state.
 * Every input/actual row prop, including callbacks, participates in reuse. */
export function prepareChatElements(previous, scope, messages, inputs, properties, createElement) {
  const before = previous?.scope === scope ? previous : null;
  // Compare complete shared inputs once, rather than allocating and comparing
  // one props object per unchanged row on every streamed character update.
  const sameInputs = before && before.properties === properties && sameProps(before.inputs, inputs);
  const sameFactory = before?.createElement === createElement;
  const sameProjection = sameInputs && sameFactory;
  const sameIds = before && before.ids.length === messages.length && messages.every((message, index) => Object.is(message.id, before.ids[index]));
  const ids = sameIds ? before.ids : messages.map(message => message.id);
  let ambiguous = sameIds ? before.ambiguous : null;
  if (!ambiguous) {
    ambiguous = new Set();
    const seen = new Set();
    for (const id of ids) {
      if (!usableId(id) || seen.has(id)) ambiguous.add(id);
      seen.add(id);
    }
  }
  let entries = null, elements = null, byId = null;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index], id = ids[index], aligned = before?.entries[index];
    let candidate = null;
    if (!ambiguous.has(id) && before && !before.ambiguous.has(id)) {
      if (aligned?.id === id) candidate = aligned;
      else {
        if (!byId) byId = new Map(before.entries.filter(entry => !before.ambiguous.has(entry.id)).map(entry => [entry.id, entry]));
        candidate = byId.get(id);
      }
    }
    let entry;
    if (candidate && candidate.message === message && sameProjection) entry = candidate;
    else {
      const props = properties(message, inputs);
      entry = candidate && candidate.message === message && sameFactory && sameProps(candidate.props, props)
        ? candidate : { id, message, props, element: createElement(`${scope}:${id}`, props) };
    }
    if (!entries && entry !== aligned) entries = before ? before.entries.slice(0, index) : [];
    entries?.push(entry);
    if (!elements && entry.element !== before?.elements[index]) elements = before ? before.elements.slice(0, index) : [];
    elements?.push(entry.element);
  }
  // Truncation may preserve every remaining entry, but must release deleted
  // elements instead of keeping them alive in the next committed snapshot.
  if (!entries && before?.entries.length !== messages.length) entries = before ? before.entries.slice(0, messages.length) : [];
  if (!elements && before?.elements.length !== messages.length) elements = before ? before.elements.slice(0, messages.length) : [];
  if (before && sameProjection && sameIds && !entries && !elements) return before;
  // A changed projection/input can yield identical actual props (for example,
  // speech for an off-screen conversation). Still publish its new metadata.
  return { scope, inputs, properties, createElement, ids, ambiguous, entries: entries || before?.entries || [], elements: elements || before?.elements || [] };
}
