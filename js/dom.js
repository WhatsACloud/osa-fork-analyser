/**
 * Tiny element builder. Children are appended as text nodes, never parsed as HTML,
 * so repo descriptions and LLM output are safe to pass straight in.
 * @param {string} tag
 * @param {Record<string, any>} [props]  attributes; functions under on* become listeners
 * @param {...(Node | string | number | null | false | Array<any>)} children
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(
    ...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false).map((c) =>
      c instanceof Node ? c : String(c),
    ),
  );
  return node;
}

export const $ = (selector) => document.querySelector(selector);
