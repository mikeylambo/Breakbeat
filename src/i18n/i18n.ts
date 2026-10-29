/**
 * i18n — the core (core.ts) plus every bundled language table. UI code imports from here; headless
 * modules import core.ts, which works without the tables (English).
 */

import de from '../../content/i18n/de.json';
import es from '../../content/i18n/es.json';
import ja from '../../content/i18n/ja.json';
import ptBR from '../../content/i18n/pt-BR.json';
import { registerTable } from './core.js';

registerTable('es', es);
registerTable('pt-BR', ptBR);
registerTable('de', de);
registerTable('ja', ja);

export * from './core.js';
