(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WeeklightI18n = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const dictionary = Object.create(null);
  let currentLanguage = 'zh-CN';
  function normalizeLanguage(value, fallback = 'zh-CN') {
    return value === 'en' || value === 'zh-CN' ? value : fallback;
  }
  function register(entries) {
    for (const [key, value] of Object.entries(entries)) {
      if (typeof value !== 'string') throw new TypeError('Translations must be strings');
      if (Object.hasOwn(dictionary, key) && dictionary[key] !== value) throw new Error('Conflicting translation: ' + key);
      dictionary[key] = value;
    }
  }
  function t(key, values = {}, language = currentLanguage) {
    const text = normalizeLanguage(language) === 'en' && Object.hasOwn(dictionary, key) ? dictionary[key] : String(key);
    return text.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name) => Object.hasOwn(values, name) ? String(values[name]) : placeholder);
  }
  function apply(root = document) {
    if (root.documentElement) root.documentElement.lang = currentLanguage;
    for (const [attribute, target] of [['data-i18n', null], ['data-i18n-placeholder', 'placeholder'], ['data-i18n-title', 'title'], ['data-i18n-aria-label', 'aria-label']]) {
      const nodes = [...root.querySelectorAll('[' + attribute + ']')];
      if (root.matches?.('[' + attribute + ']')) nodes.unshift(root);
      for (const node of nodes) {
        const value = t(node.getAttribute(attribute));
        if (target) node.setAttribute(target, value);
        else node.textContent = value;
      }
    }
  }
  function setLanguage(value) {
    const next = normalizeLanguage(value);
    if (next === currentLanguage) return next;
    currentLanguage = next;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      apply(document);
      window.dispatchEvent(new Event('weeklight-language-changed'));
    }
    return next;
  }
  function formatDate(value, options = {}, language = currentLanguage) {
    // Parse date-only values at local noon to avoid shifting days through UTC.
    const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T12:00:00') : value;
    return new Intl.DateTimeFormat(normalizeLanguage(language) === 'en' ? 'en-US' : 'zh-CN', options).format(date);
  }
  function translateError(value, language = currentLanguage) {
    const message = String(value?.message ?? value ?? '').replace(/^Error invoking remote method '[^']+': Error: /, '');
    if (Object.hasOwn(dictionary, message)) return t(message, {}, language);
    const original = Object.keys(dictionary).find(key => dictionary[key] === message);
    if (original) return t(original, {}, language);
    // A window may retain an IPC error while another window changes language.
    // Recognize only our error templates, preserving unknown system details.
    for (const [key, english] of Object.entries(dictionary)) {
      if (!/\{(?:error|detail|status)\}/.test(key)) continue;
      for (const template of [key, english]) {
        const names = [];
        const parts = template.split(/(\{[a-zA-Z][\w]*\})/g).map(part => {
          if (/^\{[a-zA-Z][\w]*\}$/.test(part)) { names.push(part.slice(1,-1)); return '([\\s\\S]*?)'; }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        });
        const match = new RegExp('^' + parts.join('') + '$').exec(message);
        if (!match) continue;
        const values = Object.fromEntries(names.map((name,index) => [name, ['error','detail'].includes(name) && match[index+1] !== message ? translateError(match[index+1],language) : match[index+1]]));
        return t(key, values, language);
      }
    }
    return message;
  }
  return Object.freeze({ register, normalizeLanguage, t, setLanguage, getLanguage: () => currentLanguage, formatDate, apply, translateError });
});
