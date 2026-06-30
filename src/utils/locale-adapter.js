/**
 * locale-adapter.js
 * Resolves UI text by locale so no code path is hardcoded to a single language.
 * Locale is read from flow.config.json ("locale": "en" | "fr" | "pt").
 * Falls back to "en" if locale is missing or key not found.
 */

import { get } from './config.js';

const TRANSLATIONS = {
  // Project management
  new_project: { en: 'New project', fr: 'Nouveau projet', pt: 'Novo projeto' },
  edit:        { en: 'Edit',        fr: 'Modifier',        pt: 'Editar' },
  delete:      { en: 'Delete',      fr: 'Supprimer',       pt: 'Excluir' },
  create:      { en: 'Create',      fr: 'Créer',           pt: 'Criar' },
  confirm:     { en: 'Confirm',     fr: 'Confirmer',       pt: 'Confirmar' },
  cancel:      { en: 'Cancel',      fr: 'Annuler',         pt: 'Cancelar' },

  // Sidebar sections
  sidebar_all_media:  { en: 'All Media',  fr: 'Tous les médias', pt: 'Todos os Mídias' },
  sidebar_videos:     { en: 'Videos',     fr: 'Vidéos',          pt: 'Vídeos' },
  sidebar_characters: { en: 'Characters', fr: 'Personnages',      pt: 'Personagens' },
  sidebar_scenes:     { en: 'Scenes',     fr: 'Scènes',          pt: 'Cenas' },
  sidebar_tools:      { en: 'Tools',      fr: 'Outils',          pt: 'Ferramentas' },
  sidebar_trash:      { en: 'Trash',      fr: 'Corbeille',       pt: 'Lixeira' },

  // Generation tabs
  tab_image: { en: 'Image', fr: 'Image', pt: 'Imagem' },
  tab_video: { en: 'Video', fr: 'Vidéo', pt: 'Vídeo' },

  // Generation states
  gen_queued:  { en: 'Queued',     fr: 'En attente',  pt: 'Na fila' },
  gen_ready:   { en: 'Ready',      fr: 'Prêt',        pt: 'Pronto' },
  gen_failed:  { en: 'Failed',     fr: 'Échec',       pt: 'Falhou' },
  gen_accept:  { en: 'Accept',     fr: 'Accepter',    pt: 'Aceitar' },
  gen_approve: { en: 'Approve',    fr: 'Approuver',   pt: 'Aprovar' },

  // Generation button
  btn_generate: { en: 'Generate', fr: 'Générer', pt: 'Gerar' },
  btn_download: { en: 'Download', fr: 'Télécharger', pt: 'Baixar' },
  btn_retry:    { en: 'Retry',    fr: 'Réessayer',   pt: 'Tentar novamente' },

  // Project name patterns
  project_default_name: {
    en: 'Project',
    fr: 'Projet',
    pt: 'Projeto',
  },
};

let _locale = null;

/**
 * Returns the current locale, reading once from config and caching.
 */
function getLocale() {
  if (!_locale) {
    _locale = get('locale', 'en').toLowerCase();
    if (!['en', 'fr', 'pt'].includes(_locale)) _locale = 'en';
  }
  return _locale;
}

/**
 * Translate a key to the configured locale.
 * Falls back to English if key or locale not found.
 * @param {string} key - Key from TRANSLATIONS map
 * @returns {string}
 */
export function t(key) {
  const locale = getLocale();
  const entry = TRANSLATIONS[key];
  if (!entry) {
    return key; // passthrough if key not registered
  }
  return entry[locale] || entry['en'] || key;
}

/**
 * Returns an array of all translations for a given key across all locales.
 * Useful for building multi-locale selectors.
 * @param {string} key
 * @returns {string[]}
 */
export function tAll(key) {
  const entry = TRANSLATIONS[key];
  if (!entry) return [key];
  return [...new Set(Object.values(entry))];
}

/**
 * Build a Playwright has-text selector that matches any locale for a key.
 * Example: selectorForKey('new_project') →
 *   'button:has-text("New project"), button:has-text("Nouveau projet"), button:has-text("Novo projeto")'
 * @param {string} tag - HTML tag or role selector (e.g., 'button', 'a')
 * @param {string} key - Key from TRANSLATIONS map
 * @returns {string}
 */
export function multiLocaleSelector(tag, key) {
  return tAll(key).map(text => `${tag}:has-text("${text}")`).join(', ');
}

/**
 * Reset cached locale (useful for tests).
 */
export function resetLocaleCache() {
  _locale = null;
}
