// Opt-in translations for the web demo (?lang=en|es|de); the app itself is French.
// Classic script sharing the page's global scope (see index.html for the load order).
'use strict';

// ── Demo i18n ────────────────────────────────────────────────────────────────
// Opt-in via ?lang= (used only by the marketing site's embedded demo preview).
// With no param the app stays French, so the real desktop app is unchanged.
const LANG   = (new URLSearchParams(location.search).get('lang') || 'fr').slice(0, 2);
const LOCALE = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES', de: 'de-DE' }[LANG] || 'fr-FR';
const _I18N = {
  en: {
    'Nouvelle version disponible': 'New version available', 'Télécharger': 'Download', 'Fermer': 'Close',
    'Souvenirs': 'Memories', 'Carte': 'Map',
    'Aucun souvenir trouvé': 'No memories found', 'Aucun média trouvé': 'No media found',
    'Chargement des souvenirs…': 'Loading memories…', 'Chargement des médias…': 'Loading media…',
    'Rechercher dans les souvenirs…': 'Search your memories…', 'Rechercher dans les médias…': 'Search your media…',
    'Tous tes souvenirs Snapchat, triés par jour, du plus récent au plus ancien.': 'All your Snapchat memories, sorted by day, newest to oldest.',
    'Les photos et vidéos échangées en conversation, rassemblées au même endroit.': 'The photos and videos shared in chats, gathered in one place.',
    'Chaque souvenir replacé sur la carte, là où tu l’as vécu.': 'Every memory back on the map, where you lived it.',
    'Tes conversations comme dans Snapchat : photos, vidéos et vocaux à leur place, et leurs stats.': 'Your conversations like in Snapchat: photos, videos and voice notes in their place, plus their stats.',
    'Ta vie Snapchat en chiffres : photos, vidéos, lieux et calendrier d’activité.': 'Your Snapchat life in numbers: photos, videos, places and activity calendar.',
    "Aujourd'hui": 'Today', 'Hier': 'Yesterday',
    'Ce jour-là': 'On this day', 'Au hasard': 'Random', 'Souvenir surprise': 'Surprise memory',
    'Il y a 1 an': '1 year ago', 'Il y a {n} ans': '{n} years ago',
    'Ton {s} {y}': 'Your {s} {y}', 'hiver': 'winter', 'printemps': 'spring', 'été': 'summer', 'automne': 'autumn',
    'Voyage': 'Trip', 'Voyage à {c}': 'Trip to {c}', '{n} souvenirs': '{n} memories', 'Période intense': 'Busy stretch', '{n} médias': '{n} media',
    'souvenirs': 'memories', '{c} pays · {v} villes': '{c} countries · {v} cities',
    'Photos': 'Photos', 'Vidéos': 'Videos', 'Temps vidéo': 'Video time', 'Pays': 'Countries',
    'Par année': 'By year', 'Saisonnalité (par mois, toutes années)': 'Seasonality (by month, all years)',
    "Calendrier d'activité": 'Activity calendar', 'Top lieux': 'Top places', 'Records': 'Records',
    'Jour le plus actif :': 'Busiest day:', 'Année record :': 'Record year:',
    '{n} lieux · {t} souvenirs': '{n} places · {t} memories',
    'Les Chat Media n’ont pas de position : ils n’apparaissent pas sur la carte.': 'Chat Media have no location, so they do not appear on the map.',
    'Calcul des statistiques… (première fois, ~1 min)': 'Computing stats… (first time, ~1 min)',
  },
  es: {
    'Nouvelle version disponible': 'Nueva versión disponible', 'Télécharger': 'Descargar', 'Fermer': 'Cerrar',
    'Souvenirs': 'Recuerdos', 'Carte': 'Mapa',
    'Aucun souvenir trouvé': 'No se encontraron recuerdos', 'Aucun média trouvé': 'No se encontraron medios',
    'Chargement des souvenirs…': 'Cargando recuerdos…', 'Chargement des médias…': 'Cargando medios…',
    'Rechercher dans les souvenirs…': 'Busca en tus recuerdos…', 'Rechercher dans les médias…': 'Busca en tus medios…',
    'Tous tes souvenirs Snapchat, triés par jour, du plus récent au plus ancien.': 'Todos tus recuerdos de Snapchat, ordenados por día, de lo más reciente a lo más antiguo.',
    'Les photos et vidéos échangées en conversation, rassemblées au même endroit.': 'Las fotos y vídeos compartidos en los chats, reunidos en un solo lugar.',
    'Chaque souvenir replacé sur la carte, là où tu l’as vécu.': 'Cada recuerdo de nuevo en el mapa, donde lo viviste.',
    'Tes conversations comme dans Snapchat : photos, vidéos et vocaux à leur place, et leurs stats.': 'Tus conversaciones como en Snapchat: fotos, vídeos y notas de voz en su sitio, y sus estadísticas.',
    'Ta vie Snapchat en chiffres : photos, vidéos, lieux et calendrier d’activité.': 'Tu vida en Snapchat en cifras: fotos, vídeos, lugares y calendario de actividad.',
    "Aujourd'hui": 'Hoy', 'Hier': 'Ayer',
    'Ce jour-là': 'Este día', 'Au hasard': 'Al azar', 'Souvenir surprise': 'Recuerdo sorpresa',
    'Il y a 1 an': 'Hace 1 año', 'Il y a {n} ans': 'Hace {n} años',
    'Ton {s} {y}': 'Tu {s} {y}', 'hiver': 'invierno', 'printemps': 'primavera', 'été': 'verano', 'automne': 'otoño',
    'Voyage': 'Viaje', 'Voyage à {c}': 'Viaje a {c}', '{n} souvenirs': '{n} recuerdos', 'Période intense': 'Racha intensa', '{n} médias': '{n} medios',
    'souvenirs': 'recuerdos', '{c} pays · {v} villes': '{c} países · {v} ciudades',
    'Photos': 'Fotos', 'Vidéos': 'Vídeos', 'Temps vidéo': 'Tiempo de vídeo', 'Pays': 'Países',
    'Par année': 'Por año', 'Saisonnalité (par mois, toutes années)': 'Estacionalidad (por mes, todos los años)',
    "Calendrier d'activité": 'Calendario de actividad', 'Top lieux': 'Lugares top', 'Records': 'Récords',
    'Jour le plus actif :': 'Día más activo:', 'Année record :': 'Año récord:',
    '{n} lieux · {t} souvenirs': '{n} lugares · {t} recuerdos',
    'Les Chat Media n’ont pas de position : ils n’apparaissent pas sur la carte.': 'Los Chat Media no tienen ubicación, así que no aparecen en el mapa.',
    'Calcul des statistiques… (première fois, ~1 min)': 'Calculando estadísticas… (la primera vez, ~1 min)',
  },
  de: {
    'Nouvelle version disponible': 'Neue Version verfügbar', 'Télécharger': 'Herunterladen', 'Fermer': 'Schließen',
    'Souvenirs': 'Erinnerungen', 'Carte': 'Karte',
    'Aucun souvenir trouvé': 'Keine Erinnerungen gefunden', 'Aucun média trouvé': 'Keine Medien gefunden',
    'Chargement des souvenirs…': 'Erinnerungen werden geladen…', 'Chargement des médias…': 'Medien werden geladen…',
    'Rechercher dans les souvenirs…': 'Durchsuche deine Erinnerungen…', 'Rechercher dans les médias…': 'Durchsuche deine Medien…',
    'Tous tes souvenirs Snapchat, triés par jour, du plus récent au plus ancien.': 'Alle deine Snapchat-Erinnerungen, nach Tagen sortiert, von neu nach alt.',
    'Les photos et vidéos échangées en conversation, rassemblées au même endroit.': 'Die in Chats geteilten Fotos und Videos, an einem Ort gesammelt.',
    'Chaque souvenir replacé sur la carte, là où tu l’as vécu.': 'Jede Erinnerung zurück auf der Karte, wo du sie erlebt hast.',
    'Tes conversations comme dans Snapchat : photos, vidéos et vocaux à leur place, et leurs stats.': 'Deine Chats wie in Snapchat: Fotos, Videos und Sprachnachrichten an ihrem Platz, plus ihre Statistiken.',
    'Ta vie Snapchat en chiffres : photos, vidéos, lieux et calendrier d’activité.': 'Dein Snapchat-Leben in Zahlen: Fotos, Videos, Orte und Aktivitätskalender.',
    "Aujourd'hui": 'Heute', 'Hier': 'Gestern',
    'Ce jour-là': 'An diesem Tag', 'Au hasard': 'Zufall', 'Souvenir surprise': 'Überraschungs-Erinnerung',
    'Il y a 1 an': 'Vor 1 Jahr', 'Il y a {n} ans': 'Vor {n} Jahren',
    'Ton {s} {y}': 'Dein {s} {y}', 'hiver': 'Winter', 'printemps': 'Frühling', 'été': 'Sommer', 'automne': 'Herbst',
    'Voyage': 'Reise', 'Voyage à {c}': 'Reise nach {c}', '{n} souvenirs': '{n} Erinnerungen', 'Période intense': 'Volle Phase', '{n} médias': '{n} Medien',
    'souvenirs': 'Erinnerungen', '{c} pays · {v} villes': '{c} Länder · {v} Städte',
    'Photos': 'Fotos', 'Vidéos': 'Videos', 'Temps vidéo': 'Videozeit', 'Pays': 'Länder',
    'Par année': 'Nach Jahr', 'Saisonnalité (par mois, toutes années)': 'Saisonalität (nach Monat, alle Jahre)',
    "Calendrier d'activité": 'Aktivitätskalender', 'Top lieux': 'Top-Orte', 'Records': 'Rekorde',
    'Jour le plus actif :': 'Aktivster Tag:', 'Année record :': 'Rekordjahr:',
    '{n} lieux · {t} souvenirs': '{n} Orte · {t} Erinnerungen',
    'Les Chat Media n’ont pas de position : ils n’apparaissent pas sur la carte.': 'Chat Media haben keinen Ort und erscheinen daher nicht auf der Karte.',
    'Calcul des statistiques… (première fois, ~1 min)': 'Statistiken werden berechnet… (beim ersten Mal, ~1 Min.)',
  },
};
const _T = _I18N[LANG] || {};
function t(fr) { return _T[fr] !== undefined ? _T[fr] : fr; }
function tf(fr, vars) { let s = t(fr); for (const k in vars) s = s.split('{' + k + '}').join(vars[k]); return s; }
