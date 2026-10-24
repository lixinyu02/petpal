// Adapted from the same-owner Codex Remote component library; see docs/openui-reference.json.
import {
  autoClose, createParser, evaluateElementProps, isReactiveAssign,
  parseExpression, split, tokenize,
} from "@openuidev/lang-core";
import { OPENUI_LIMITS, normalizeOpenUITableRows, openUILibrary } from "./library.mjs";

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const actions = new Set(["UseInPrompt", "Set", "Reset", "Action"]);
const literalKinds = new Set(["Str", "Num", "Bool", "Null"]);
const error = (code, message) => ({ code, message, source: "parser" });
const parser = createParser(openUILibrary.toJSONSchema(), openUILibrary.root);

export function copyBoundedData(value, maxBytes = OPENUI_LIMITS.state) {
  const seen = new Set();
  let nodes = 0;
  function visit(item, depth) {
    if (++nodes > 5000 || depth > OPENUI_LIMITS.depth) throw new Error("OpenUI state exceeds complexity limits");
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "string") {
      if (item.length > OPENUI_LIMITS.text) throw new Error("OpenUI text exceeds length limit");
      return item;
    }
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || seen.has(item)) throw new Error("OpenUI state must be finite JSON data");
    seen.add(item);
    const result = Array.isArray(item) ? [] : {};
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      throw new Error("OpenUI state must be plain JSON data");
    }
    for (const [key, entry] of Object.entries(item)) {
      if (forbiddenKeys.has(key)) throw new Error("Reserved OpenUI property");
      result[key] = visit(entry, depth + 1);
    }
    seen.delete(item);
    return result;
  }
  const result = visit(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).length > maxBytes) throw new Error("OpenUI data exceeds size limit");
  return result;
}

// This uses the SDK's own lexer and expression parser; it is a permission and
// resource gate, not a second implementation of OpenUI Lang.
function inspectSource(source, complete) {
  if (typeof source !== "string") return { errors: [error("invalid-source", "OpenUI source must be a string")] };
  if (source.length > OPENUI_LIMITS.source || new TextEncoder().encode(source).length > OPENUI_LIMITS.source) {
    return { errors: [error("source-limit", "OpenUI source exceeds 64 KiB")] };
  }
  const tokens = tokenize(source);
  if (tokens.length > OPENUI_LIMITS.tokens) return { errors: [error("token-limit", "OpenUI source is too complex")] };
  // Token values are the public const enum in pinned lang-core 1.0.1.
  let depth = 0;
  for (const token of tokens) {
    if ([1, 3, 5].includes(token.t) && ++depth > OPENUI_LIMITS.depth) {
      return { errors: [error("depth-limit", "OpenUI nesting is too deep")] };
    }
    if ([2, 4, 6].includes(token.t)) depth--;
    if (complete && depth < 0) return { errors: [error("unbalanced-source", "OpenUI has an unmatched closing bracket")] };
  }
  const statements = split(tokens);
  if (statements.length > OPENUI_LIMITS.statements) return { errors: [error("statement-limit", "OpenUI has too many statements")] };
  const errors = [];
  const identifiers = new Set();
  const declaredState = new Set(statements.filter(statement => statement.id.startsWith("$")).map(statement => statement.id));
  const references = new Map();
  const expressions = new Map();
  let astNodes = 0;
  for (const statement of statements) {
    if (identifiers.has(statement.id)) errors.push(error("duplicate-statement", `Duplicate statement: ${statement.id}`));
    identifiers.add(statement.id);
    if (forbiddenKeys.has(statement.id.replace(/^\$/, ""))) errors.push(error("reserved-name", "Reserved statement name"));
    const ast = parseExpression(statement.tokens);
    expressions.set(statement.id, ast);
    if (complete && statement.id === "root" && !(ast?.k === "Comp" && ast.name === "Panel" && !ast.fn)) {
      errors.push(error("invalid-root", "root must call Panel"));
    }
    if (complete && statement.id.startsWith("$") && !literalKinds.has(ast?.k)) {
      errors.push(error("invalid-state", "Initial $variable values must be string, number, boolean or null literals"));
    }
    const refs = new Set();
    const pending = [{ value: ast, depth: 0 }];
    while (pending.length) {
      const { value, depth: nodeDepth } = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (++astNodes > OPENUI_LIMITS.astNodes || nodeDepth > OPENUI_LIMITS.depth) {
        return { errors: [error("ast-limit", "OpenUI expressions are too complex")] };
      }
      if (value.k === "Comp") {
        const component = Object.hasOwn(openUILibrary.components, value.name);
        if (!(component && !value.fn) && !actions.has(value.name)) {
          errors.push(error("unsupported-call", `Unsupported OpenUI call: ${value.name}`));
        }
        if (value.name === "Set" && complete && (value.args.length !== 2 || value.args[0]?.k !== "StateRef" || !literalKinds.has(value.args[1]?.k))) {
          errors.push(error("invalid-action", "@Set requires a declared $variable and a literal value"));
        }
        if (value.name === "Reset" && complete && (!value.args.length || value.args.some(arg => arg.k !== "StateRef"))) {
          errors.push(error("invalid-action", "@Reset requires one or more declared $variables"));
        }
      }
      if (["RuntimeRef", "Assign", "Ph"].includes(value.k)) errors.push(error("unsupported-expression", `Unsupported OpenUI expression: ${value.k}`));
      if (value.k === "StateRef" && complete && !declaredState.has(value.n)) errors.push(error("undeclared-state", `Undeclared state: ${value.n}`));
      if (value.k === "Ref") refs.add(value.n);
      if (value.k === "Member" && forbiddenKeys.has(value.field)) errors.push(error("reserved-name", "Reserved property access"));
      if (value.k === "Index" && value.index?.k === "Str" && forbiddenKeys.has(value.index.v)) errors.push(error("reserved-name", "Reserved property access"));
      if (value.k === "Obj" && value.entries.some(([key]) => forbiddenKeys.has(key))) errors.push(error("reserved-name", "Reserved object property"));
      if (value.k === "Str" && value.v.length > OPENUI_LIMITS.text) errors.push(error("text-limit", "OpenUI text exceeds 12000 characters"));
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) for (const item of child) pending.push({ value: item, depth: nodeDepth + 1 });
        else if (child && typeof child === "object") pending.push({ value: child, depth: nodeDepth + 1 });
      }
    }
    references.set(statement.id, refs);
  }
  // Resolve cycles before calling the SDK's permissive tree resolver.
  const completeRefs = new Set();
  function visit(id, active = new Set()) {
    if (completeRefs.has(id)) return false;
    if (active.has(id)) return true;
    const next = new Set(active).add(id);
    for (const ref of references.get(id) ?? []) if (visit(ref, next)) return true;
    completeRefs.add(id);
    return false;
  }
  if ([...references.keys()].some(id => visit(id))) errors.push(error("cyclic-reference", "OpenUI references must not contain cycles"));
  if (errors.length) return { errors };
  // A short DAG can expand exponentially (a=Stack([b,b]), b=...). Count its
  // projected component instances with memoized, saturating arithmetic before
  // letting the SDK materialize the root tree.
  const sizes = new Map();
  function expressionSize(value) {
    if (!value || typeof value !== "object") return 0;
    if (value.k === "Ref") return statementSize(value.n);
    let size = value.k === "Comp" && Object.hasOwn(openUILibrary.components, value.name) ? 1 : 0;
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          size += expressionSize(item);
          if (size > OPENUI_LIMITS.nodes) return OPENUI_LIMITS.nodes + 1;
        }
      } else if (child && typeof child === "object") size += expressionSize(child);
      if (size > OPENUI_LIMITS.nodes) return OPENUI_LIMITS.nodes + 1;
    }
    return size;
  }
  function statementSize(id) {
    if (!sizes.has(id)) sizes.set(id, expressionSize(expressions.get(id)));
    return sizes.get(id);
  }
  if (statementSize("root") > OPENUI_LIMITS.nodes) errors.push(error("tree-limit", "OpenUI expanded tree is too large"));
  if (complete && autoClose(source).wasIncomplete) errors.push(error("incomplete-source", "OpenUI source is incomplete"));
  return { errors };
}

export function validateOpenUI(source, { streaming = false } = {}) {
  try {
    const gate = inspectSource(source, !streaming);
    if (gate.errors.length) return { valid: false, errors: gate.errors };
    // Incomplete roots and forward references are normal while streaming. The
    // SDK renders their valid subset; strict tree checks run on completion.
    if (streaming) return { valid: true, errors: [] };
    const result = parser.parse(source);
    const errors = [...(result.meta.errors ?? [])];
    if (result.meta.incomplete) errors.push(error("incomplete-source", "OpenUI source is incomplete"));
    if (result.meta.unresolved.length) errors.push(error("unresolved-reference", `Unresolved references: ${result.meta.unresolved.join(", ")}`));
    if (result.meta.orphaned.length) errors.push(error("orphaned-statement", `Unused statements: ${result.meta.orphaned.join(", ")}`));
    if (!result.root || result.root.typeName !== "Panel") errors.push(error("invalid-root", "A complete Panel root is required"));
    if (result.queryStatements.length || result.mutationStatements.length) errors.push(error("tool-disabled", "Remote tools are disabled for this renderer"));
    if (errors.length) return { valid: false, errors };
    copyBoundedData(result.stateDeclarations);
    const ctx = { getState: key => result.stateDeclarations[key], resolveRef: () => null,
      actions: openUILibrary.toJSONSchema().actions };
    const evaluationErrors = [];
    const tree = evaluateElementProps(result.root, { ctx, library: openUILibrary, store: null, errors: evaluationErrors });
    errors.push(...evaluationErrors);
    let count = 0;
    const pending = [{ value: tree, depth: 0 }];
    const fieldNames = new Set();
    while (pending.length) {
      const { value: node, depth } = pending.pop();
      if (++count > OPENUI_LIMITS.nodes || depth > OPENUI_LIMITS.depth) {
        errors.push(error("tree-limit", "OpenUI rendered tree is too large")); break;
      }
      if (node === null || typeof node === "boolean" || typeof node === "number" && Number.isFinite(node)) continue;
      if (typeof node === "string") {
        if (node.length > OPENUI_LIMITS.text) errors.push(error("text-limit", "OpenUI text exceeds 12000 characters"));
        continue;
      }
      const definition = Object.hasOwn(openUILibrary.components, node?.typeName) ? openUILibrary.components[node.typeName] : null;
      if (node?.type !== "element" || !definition || node.partial) {
        errors.push(error("invalid-node", "OpenUI contains an invalid or incomplete component")); continue;
      }
      const props = { ...node.props };
      for (const [key, value] of Object.entries(props)) {
        if (isReactiveAssign(value)) props[key] = ctx.getState(value.target);
      }
      // ActionPlan is already parsed and evaluated by the official runtime;
      // its allowed calls were checked in the raw SDK AST above.
      const layout = ["Panel", "Stack"].includes(node.typeName);
      const schema = node.typeName === "Button" ? definition.props.omit({ action: true })
        : layout ? definition.props.omit({ children: true }) : definition.props;
      const parsed = schema.safeParse(node.typeName === "Button" ? { label: props.label } : props);
      if (!parsed.success) errors.push(error("invalid-props", `${node.typeName}: ${parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`));
      if (["Field", "Select", "Checkbox"].includes(node.typeName)) {
        if (fieldNames.has(props.name)) errors.push(error("duplicate-field", `Duplicate field name: ${props.name}`));
        fieldNames.add(props.name);
      }
      if (node.typeName === "Table" && normalizeOpenUITableRows(props.columns, props.rows) === null) {
        errors.push(error("table-shape", "Every Table row must match the column count"));
      }
      if (node.typeName === "Button" && props.action !== undefined) {
        const steps = props.action?.steps;
        if (!Array.isArray(steps) || !steps.length || steps.length > 20) {
          errors.push(error("invalid-action", "Buttons require an SDK action plan containing at most 20 allowed steps"));
        } else for (const step of steps) {
          if (step.type === "custom_action" && step.name === "UseInPrompt") {
            if (!openUILibrary.actions.UseInPrompt.params.safeParse(step.params ?? {}).success) errors.push(error("invalid-action", "UseInPrompt requires optional plain text"));
          } else if (step.type === "reset" && Array.isArray(step.targets) && step.targets.length && step.targets.every(target => Object.hasOwn(result.stateDeclarations, target))) {
            // SDK reset only restores declared local state.
          } else if (step.type === "set" && Object.hasOwn(result.stateDeclarations, step.target) && literalKinds.has(step.valueAST?.k)) {
            // SDK set is constrained to a scalar literal by the source gate.
          } else errors.push(error("unsupported-action", "Only UseInPrompt and bounded local state actions are supported"));
        }
      }
      if (layout) {
        if (!Array.isArray(props.children) || props.children.length > OPENUI_LIMITS.nodes) errors.push(error("invalid-children", "Layout children must be a bounded array of components"));
        for (const child of Array.isArray(props.children) ? props.children : []) pending.push({ value: child, depth: depth + 1 });
      }
    }
    return { valid: errors.length === 0, errors };
  } catch (exception) {
    return { valid: false, errors: [error("parse-exception", exception instanceof Error ? exception.message : "OpenUI parse failed")] };
  }
}
