// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a free text of the device nor what the user typed: only our own
// words, error kinds and the values we checked.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  // Rounded first: 59.99 s is told "1 min", never "60 s".
  if (Math.round(ms / 1000) >= 60) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error kind of src/alfa/client.js. */
const REASON = {
  unreachable: {
    en: 'no Modbus TCP connection (is Modbus enabled, is another Modbus client connected?)',
    fr: 'pas de connexion Modbus TCP (Modbus est-il activé, un autre client Modbus est-il connecté ?)',
  },
  timeout: { en: 'no answer in time', fr: 'pas de réponse à temps' },
  closed: { en: 'connection closed by the device', fr: 'connexion fermée par l’appareil' },
  protocol: {
    en: 'an answer that is not the one asked (is it an Alfa?)',
    fr: 'une réponse qui n’est pas celle demandée (est-ce bien un Alfa ?)',
  },
  exception: { en: 'Modbus request refused', fr: 'requête Modbus refusée' },
  late: { en: 'read too slow', fr: 'lecture trop lente' },
  busy: { en: 'a read already runs', fr: 'une lecture est déjà en cours' },
};

export function reason(err) {
  const text = REASON[err?.kind] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const code = err?.kind === 'exception' && Number.isInteger(err.code) ? ` (${err.code})` : '';
  return { en: `${text.en}${code}`, fr: `${text.fr}${code}` };
}

const kwh = (value) => Math.round(value * 1000) / 1000;
const NAMES = {
  import_index: { en: 'Energy drawn', fr: 'Énergie prélevée' },
  export_index: { en: 'Energy fed', fr: 'Énergie injectée' },
  production_index: { en: 'Energy produced', fr: 'Énergie produite' },
};
const COUNTED = {
  import_index: { en: 'as consumption', fr: 'comme consommation' },
  export_index: { en: 'as energy fed (never billed)', fr: 'comme injection (jamais facturée)' },
  production_index: { en: 'as production', fr: 'comme production' },
};

/** `ago` ms ago, or undefined for a read made by this click. */
const when = (ago) =>
  ago === undefined
    ? { en: 'Read now', fr: 'Lu à l’instant' }
    : { en: `Last read ${delay(ago).en} ago`, fr: `Dernière lecture il y a ${delay(ago).fr}` };

const join = (lang, first, notes) => [first[lang], ...notes.map((n) => n[lang])].join(' ');
const withNotes = (first, notes) => ({
  en: join('en', first, notes),
  fr: join('fr', first, notes),
});

/** The next read. */
const nextRead = (next) => ({
  en: ` Next read in ${delay(next).en}.`,
  fr: ` Prochaine lecture dans ${delay(next).fr}.`,
});

/** A Unix time (s) as a UTC date and time, minutes only. */
const utc = (s) => `${new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

export const T = {
  withNotes,
  incomplete: {
    en: 'Enter the address of your Sinapsi Alfa (its IP address on your network, e.g. 192.168.1.50).',
    fr: 'Saisissez l’adresse de votre Sinapsi Alfa (son adresse IP sur votre réseau, ex. 192.168.1.50).',
  },
  badAddress: {
    en: 'The address is not valid: enter the IP address or the host name of the Alfa, with a port only if it is not 502 (e.g. 192.168.1.50).',
    fr: 'L’adresse n’est pas valide : saisissez l’adresse IP ou le nom d’hôte de l’Alfa, avec un port seulement s’il n’est pas 502 (ex. 192.168.1.50).',
  },
  configFailed: (wait) => ({
    en: `The configuration of the integration could not be read from Gladys: new try in ${delay(wait).en}.`,
    fr: `La configuration de l’intégration n’a pas pu être lue depuis Gladys : nouvel essai dans ${delay(wait).fr}.`,
  }),
  unreachable: (address, err, wait, notes = []) =>
    withNotes(
      {
        en: `The Sinapsi Alfa at ${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
        fr: `Le Sinapsi Alfa à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
      },
      notes,
    ),
  warmup: (address, notes = []) =>
    withNotes(
      {
        en: `The Sinapsi Alfa at ${address} answers but is still starting (its registers read 0): nothing is published until it gives its values.`,
        fr: `Le Sinapsi Alfa à l’adresse ${address} répond mais démarre encore (ses registres valent 0) : rien n’est publié tant qu’il ne donne pas ses valeurs.`,
      },
      notes,
    ),
  waiting: (address, notes = []) =>
    withNotes(
      {
        en: `Waiting for the first answer of the Sinapsi Alfa at ${address}.`,
        fr: `En attente de la première réponse du Sinapsi Alfa à l’adresse ${address}.`,
      },
      notes,
    ),
  ok: (address, notes = []) =>
    withNotes(
      {
        en: `Connected to the Sinapsi Alfa at ${address}.`,
        fr: `Connecté au Sinapsi Alfa à l’adresse ${address}.`,
      },
      notes,
    ),
  notes: {
    noDevice: {
      en: 'Create its device from the "Discover" tab to receive its values.',
      fr: 'Créez son appareil depuis l’onglet « Découverte » pour recevoir ses valeurs.',
    },
    configFailed: {
      en: 'The configuration could not be read again from Gladys: the last one received is used meanwhile, new tries go on.',
      fr: 'La configuration n’a pas pu être relue depuis Gladys : la dernière reçue sert en attendant, les essais continuent.',
    },
    frozen: (after) => ({
      en: `No register of the Alfa has changed for ${delay(after).en} or more: nothing is sent until one does.`,
      fr: `Aucun registre de l’Alfa n’a changé depuis ${delay(after).fr} ou plus : rien n’est envoyé tant qu’aucun ne bouge.`,
    }),
    storeUnreadable: {
      en: 'The state file of the integration in /data cannot be read: it is left as it is (never written over), so a held index may be forgotten. Remove sinapsi-alfa-state.json from the /data volume to start afresh.',
      fr: 'Le fichier d’état de l’intégration dans /data est illisible : il est laissé tel quel (jamais écrasé), donc un index retenu peut être oublié. Supprimez sinapsi-alfa-state.json du volume /data pour repartir de zéro.',
    },
    noImport: {
      en: 'The Alfa gives no energy drawn (its register says "not available"): no consumption index.',
      fr: 'L’Alfa ne donne pas l’énergie prélevée (son registre indique « non disponible ») : pas d’index de consommation.',
    },
    noProductionData: {
      en: 'The Alfa gives no production total while energy was fed to the grid (no production data): production and home power are not sent.',
      fr: 'L’Alfa ne donne pas de total de production alors que de l’énergie a été injectée (pas de données de production) : la production et la puissance du logement ne sont pas envoyées.',
    },
    productionBelowExport: {
      en: 'The production total of the Alfa is below the energy fed to the grid (a production meter replaced, or two meters that differ): the values are sent as read.',
      fr: 'Le total de production de l’Alfa est inférieur à l’énergie injectée (un compteur de production remplacé, ou deux compteurs qui diffèrent) : les valeurs sont envoyées telles que lues.',
    },
    /** The batches not read this time: `[{ start, why }]`. */
    missed: (list) => {
      const NAMES = {
        203: { en: 'tariff band', fr: 'tranche horaire' },
        780: { en: 'cut-off warning', fr: 'avis de coupure' },
        921: { en: 'production', fr: 'production' },
      };
      const WHY = {
        refused: { en: 'refused by the Alfa', fr: 'refusés par l’Alfa' },
        silent: {
          en: 'not answered, left out for a few reads',
          fr: 'sans réponse, laissés de côté quelques lectures',
        },
        skipped: {
          en: 'left out after a silence, tried again soon',
          fr: 'laissés de côté après un silence, réessayés bientôt',
        },
        not_tried: {
          en: 'not tried after a silence in this read',
          fr: 'non essayés après un silence dans cette lecture',
        },
      };
      const parts = list.map(({ start, why }) => {
        const name = NAMES[start] ?? { en: String(start), fr: String(start) };
        const w = WHY[why] ?? WHY.silent;
        return { en: `${name.en} (${w.en})`, fr: `${name.fr} (${w.fr})` };
      });
      const band = list.some(({ start }) => start === 203)
        ? {
            en: ' Without the band, a start of the Alfa is told by its import total alone.',
            fr: ' Sans la tranche, un démarrage de l’Alfa n’est repéré que par son total prélevé.',
          }
        : { en: '', fr: '' };
      return {
        en: `Registers not read this time: ${parts.map((p) => p.en).join(', ')}; the other values go on.${band.en}`,
        fr: `Registres non lus cette fois : ${parts.map((p) => p.fr).join(', ')} ; les autres valeurs continuent.${band.fr}`,
      };
    },
    bandUnknown: {
      en: 'The Alfa gives a tariff band outside F1 to F6: it is not sent.',
      fr: 'L’Alfa donne une tranche horaire hors de F1 à F6 : elle n’est pas envoyée.',
    },
    cutoffStale: (at) => ({
      en: `The meter keeps an old cut-off warning, dated ${utc(at)}: it is not sent as a warning.`,
      fr: `Le compteur garde un ancien avis de coupure, daté du ${utc(at)} : il n’est pas envoyé comme avis.`,
    }),
    /** `nowS`: the wall time (Unix s), only to word a time already past. */
    cutoff: ({ at, left }, nowS) =>
      at < nowS
        ? {
            en: `Cut-off warning from the meter, dated ${utc(at)} (already past).`,
            fr: `Avis de coupure du compteur, daté du ${utc(at)} (déjà passé).`,
          }
        : {
            en: `Cut-off warning from the meter: supply cut planned at ${utc(at)}${left === undefined ? '' : ` (${delay(left * 1000).en} left when read)`}. Lower your consumption.`,
            fr: `Avis de coupure du compteur : coupure prévue à ${utc(at)}${left === undefined ? '' : ` (${delay(left * 1000).fr} restantes à la lecture)`}. Réduisez votre consommation.`,
          },
    /** An index held, `{ key, direction, from, to }`. */
    held: ({ key, direction, from, to }) => {
      const name = NAMES[key];
      return direction === 'down'
        ? {
            en: `${name.en} index held back (the last accepted value is sent again): it dropped from ${kwh(from)} to ${kwh(to)} kWh. If it is right (a new meter, a reset), click "Accept the held index" twice in the configuration of the integration (the first click shows it, the second accepts it). Saving the configuration accepts nothing.`,
            fr: `Index « ${name.fr} » retenu (la dernière valeur acceptée est renvoyée) : il a baissé de ${kwh(from)} à ${kwh(to)} kWh. Si c’est juste (un nouveau compteur, une remise à zéro), cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic l’affiche, le second l’accepte). Enregistrer la configuration n’accepte rien.`,
          }
        : {
            en: `${name.en} index held back (the last accepted value is sent again): it jumped from ${kwh(from)} to ${kwh(to)} kWh (${kwh(to - from)} kWh would be counted at once ${COUNTED[key].en}). If it is right, click "Accept the held index" twice in the configuration of the integration (the first click shows it, the second accepts it). Saving the configuration accepts nothing.`,
            fr: `Index « ${name.fr} » retenu (la dernière valeur acceptée est renvoyée) : il a sauté de ${kwh(from)} à ${kwh(to)} kWh (${kwh(to - from)} kWh seraient comptés d’un coup ${COUNTED[key].fr}). Si c’est juste, cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic l’affiche, le second l’accepte). Enregistrer la configuration n’accepte rien.`,
          };
    },
  },
  accept: {
    nothing: {
      en: 'No index is held back: nothing to accept.',
      fr: 'Aucun index n’est retenu : rien à accepter.',
    },
    /** The first click: what a second click would accept. */
    confirm: (list, within, margin) => {
      const items = list.map(({ key, direction, from, to }) =>
        direction === 'down'
          ? {
              en: `${NAMES[key].en}: from ${kwh(from)} down to ${kwh(to)} kWh (0 kWh counted)`,
              fr: `${NAMES[key].fr} : de ${kwh(from)} à ${kwh(to)} kWh (0 kWh compté)`,
            }
          : {
              en: `${NAMES[key].en}: from ${kwh(from)} to ${kwh(to)} kWh (${kwh(to - from)} kWh counted at once ${COUNTED[key].en})`,
              fr: `${NAMES[key].fr} : de ${kwh(from)} à ${kwh(to)} kWh (${kwh(to - from)} kWh comptés d’un coup ${COUNTED[key].fr})`,
            },
      );
      return {
        en: `A second click accepts these values, plus what may flow between the two clicks (at most ${kwh(margin)} kWh each): ${items.map((i) => i.en).join('; ')}. Click "Accept the held index" again, after a few seconds and within ${delay(within).en}, to accept them; accept only if this energy was real.`,
        fr: `Un second clic accepte ces valeurs, plus ce qui a pu passer entre les deux clics (au plus ${kwh(margin)} kWh chacune) : ${items.map((i) => i.fr).join(' ; ')}. Cliquez de nouveau sur « Accepter l’index retenu », après quelques secondes et dans les ${delay(within).fr}, pour les accepter ; n’acceptez que si cette énergie est réelle.`,
      };
    },
    done: (accepted, changed) => {
      const taken = accepted.map(({ key, to }) => ({
        en: `${NAMES[key].en} ${kwh(to)} kWh`,
        fr: `${NAMES[key].fr} ${kwh(to)} kWh`,
      }));
      const left = changed.map(({ key }) => NAMES[key]);
      const parts = { en: [], fr: [] };
      if (taken.length > 0) {
        parts.en.push(
          `Accepted: ${taken.map((t) => t.en).join(', ')}, sent with the next new reading.`,
        );
        parts.fr.push(
          `Accepté : ${taken.map((t) => t.fr).join(', ')}, envoyé avec la prochaine nouvelle lecture.`,
        );
      }
      if (left.length > 0) {
        parts.en.push(
          `Not accepted (the held value changed since the first click, click again to see it): ${left.map((n) => n.en).join(', ')}.`,
        );
        parts.fr.push(
          `Non accepté (la valeur retenue a changé depuis le premier clic, cliquez de nouveau pour la voir) : ${left.map((n) => n.fr).join(', ')}.`,
        );
      }
      return { en: parts.en.join(' '), fr: parts.fr.join(' ') };
    },
  },
  test: {
    /** The outcome of a read, `ago` ms ago (undefined: made by this click), the next in `next` ms. */
    reading: (address, r, indexes, ago, next) => {
      const w = (v) => (v === undefined ? '?' : `${Math.round(v)} W`);
      const index = (key, lang) => {
        const i = indexes[key];
        if (i?.value === undefined) return '?';
        return `${kwh(i.value)} kWh${i.held ? (lang === 'en' ? ' (held back)' : ' (retenu)') : ''}`;
      };
      const band = r.band === undefined ? '?' : `F${r.band}`;
      const frozen = r.frozen
        ? {
            en: ' (values not renewed by the device)',
            fr: ' (valeurs non renouvelées par l’appareil)',
          }
        : { en: '', fr: '' };
      return {
        en: `${when(ago).en}: Alfa at ${address}, drawn ${w(r.importPower)}, fed ${w(r.exportPower)}, produced ${w(r.productionPower)}, home ${w(r.consumptionPower)}, band ${band}; energy drawn ${index('import_index', 'en')}, fed ${index('export_index', 'en')}, produced ${index('production_index', 'en')}${frozen.en}.${nextRead(next).en}`,
        fr: `${when(ago).fr} : Alfa à l’adresse ${address}, prélevé ${w(r.importPower)}, injecté ${w(r.exportPower)}, produit ${w(r.productionPower)}, logement ${w(r.consumptionPower)}, tranche ${band} ; énergie prélevée ${index('import_index', 'fr')}, injectée ${index('export_index', 'fr')}, produite ${index('production_index', 'fr')}${frozen.fr}.${nextRead(next).fr}`,
      };
    },
    warmup: (address, ago, next) => ({
      en: `${when(ago).en}: the Alfa at ${address} answers but is still starting (its registers read 0): nothing published.${nextRead(next).en}`,
      fr: `${when(ago).fr} : l’Alfa à l’adresse ${address} répond mais démarre encore (ses registres valent 0) : rien publié.${nextRead(next).fr}`,
    }),
    failed: (address, err, ago, next) => ({
      en: `${when(ago).en}: the Alfa at ${address} could not be read (${reason(err).en}).${nextRead(next).en}`,
      fr: `${when(ago).fr} : l’Alfa à l’adresse ${address} n’a pas pu être lu (${reason(err).fr}).${nextRead(next).fr}`,
    }),
    notYet: (next, interval) => ({
      en: `No read yet with this configuration: the first one comes in ${delay(next).en} (never more than one every ${delay(interval).en}).`,
      fr: `Pas encore de lecture avec cette configuration : la première vient dans ${delay(next).fr} (jamais plus d’une toutes les ${delay(interval).fr}).`,
    }),
    slow: {
      en: 'The Alfa is slow to answer: look at the integration status in a minute.',
      fr: 'L’Alfa tarde à répondre : regardez l’état de l’intégration dans une minute.',
    },
  },
};
