// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Historique des versions
// Source unique du numéro de version affiché dans l'appli (footer
// Paramètres, écran "Nouveautés") : c'est CHANGELOG[0].version qui fait foi,
// pas de constante séparée à maintenir en double.
//
// À chaque nouvelle release qui touche des fichiers cachés : ajoute une
// entrée EN TÊTE de ce tableau. Pense aussi à bumper APP_VERSION en haut de
// service-worker.js (obligatoire séparément — le navigateur ne détecte une
// mise à jour du service worker qu'en comparant les octets de
// service-worker.js lui-même, jamais ceux d'un fichier importé comme
// celui-ci, donc ce numéro-ci ne peut pas piloter le cache automatiquement).
// ════════════════════════════════════════════════════════════════════════
export const CHANGELOG = [
  {
    version: "v1.4.8.15",
    date: "2026-09-17",
    changes: [
      "Toutes les popups de l'appli sont redessinées : titre et texte centrés, boutons en forme de pilule. La relance de saisie conso manquante a maintenant 3 vrais boutons (au lieu d'un lien texte) reprenant les couleurs des cartes conso : vert \"Je saisis maintenant\", bleu \"Pas roulé\", rouge \"Plus tard\"."
    ]
  },
  {
    version: "v1.4.8.14",
    date: "2026-09-16",
    changes: [
      "Après une inscription, un écran dédié \"Inscription envoyée\" remplace le petit message temporaire d'avant — plus lisible pour un nouveau chauffeur, avec un bouton pour revenir à la connexion une fois son compte validé par l'exploitant.",
      "Nouvel écran de chargement : le gif générique (fond blanc) est remplacé par le vrai logo MémoTruck statique et une fine barre de progression animée, plus sobre et plus pro.",
      "Corrige l'écran de connexion qui paraissait scindé en deux sur les thèmes Aurora/Obsidian/Nova (dégradé du haut non raccordé aux orbes décoratives du bas) — le fond est maintenant un dégradé continu sur toute la hauteur."
    ]
  },
  {
    version: "v1.4.8.13",
    date: "2026-09-15",
    changes: [
      "Consommation : les jours sans saisie ne sont plus silencieux. Nouveau bouton \"Pas roulé\" pour signaler un jour sans sortie (avec motif facultatif), et un lien \"me redemander plus tard\" sur la relance de prise de service pour les oublis.",
      "Chaque jour reste identifiable d'un coup d'œil dans l'historique grâce à un liseré coloré et un badge : vert pour une saisie, bleu pour un jour pas roulé, rouge pour un oubli encore en attente.",
      "Une carte reste modifiable dans tous les sens : un jour \"pas roulé\" peut être repassé en vraie saisie (km/L·100) si besoin, et inversement.",
      "La relance de prise de service couvre désormais une fenêtre de 7 jours au lieu de la veille seule, pour qu'un jour oublié ne disparaisse plus jamais silencieusement."
    ]
  },
  {
    version: "v1.4.8.12",
    date: "2026-09-11",
    changes: [
      "La section Apparence (Paramètres) est maintenant une carte repliable comme la FAQ, au lieu d'afficher les 6 thèmes en liste — plus d'espace pour les boutons en bas de l'écran.",
      "Cartes de thème plus compactes et correction d'un espacement anormal entre les lignes (effet de bord du style de la FAQ)."
    ]
  },
  {
    version: "v1.4.8.11",
    date: "2026-09-11",
    changes: [
      "Message de la popup d'activation des notifications mis à jour : précise qu'une alerte n'arrive que si une date approche vraiment de son échéance, pas de notification quotidienne si tout est à jour."
    ]
  },
  {
    version: "v1.4.8.10",
    date: "2026-09-01",
    changes: [
      "Correction : dans l'historique des interventions, le mois en cours affichait \"(en cours)\", ce qui laissait croire à tort qu'une entrée (notamment un entretien) attendait une validation. Un entretien est déjà enregistré définitivement dès sa création — il n'y a jamais eu d'étape d'approbation."
    ]
  },
  {
    version: "v1.4.8.9",
    date: "2026-09-01",
    changes: [
      "Correction : un simple entretien (vidange, filtres, embrayage…) était bloqué par la même règle que les pannes signalées à l'atelier — l'onglet Entretien n'a plus l'option \"Signaler à l'atelier\", ce n'est qu'un historique personnel du véhicule.",
      "Nouveau : le panel atelier peut désormais consulter et ajouter des entretiens directement par plaque d'immatriculation, y compris pour un véhicule sans chauffeur titré."
    ]
  },
  {
    version: "v1.4.8.8",
    date: "2026-09-01",
    changes: [
      "Correction : impossible de modifier une intervention déjà prise en charge par l'atelier — le bouton modifier n'apparaît plus sur ces interventions, et un message clair explique pourquoi si le cas se présente quand même."
    ]
  },
  {
    version: "v1.4.8.7",
    date: "2026-09-01",
    changes: [
      "Correction : la date d'expiration de la carte d'identité refusait les dates à plus de 5 ans, alors qu'elle est valide 15 ans — la limite est maintenant adaptée à ce document."
    ]
  },
  {
    version: "v1.4.8.6",
    date: "2026-08-21",
    changes: [
      "Nouveau logo MémoTruck."
    ]
  },
  {
    version: "v1.4.8.5",
    date: "2026-08-19",
    changes: [
      "Sécurité : l'inscription demande maintenant directement un mot de passe, au lieu de le fixer à la première connexion."
    ]
  },
  {
    version: "v1.4.8.4",
    date: "2026-08-19",
    changes: [
      "Sécurité : migration technique vers le nouveau système de clés API Supabase (aucun changement visible pour toi)."
    ]
  },
  {
    version: "v1.4.8.3",
    date: "2026-08-19",
    changes: [
      "Sécurité : la connexion demande maintenant un mot de passe. Si c'est ta première connexion depuis cette mise à jour, le mot de passe que tu saisis devient le tien à partir de maintenant."
    ]
  },
  {
    version: "v1.4.8.2",
    date: "2026-08-18",
    changes: [
      "Nouveau : la carte « Données personnelles » permet de renseigner ton téléphone et ton adresse, modifiables depuis l'appli comme depuis le bureau — les deux restent synchronisés.",
      "Nouveau : la carte « Données personnelles » propose une carte d'identité avec date d'expiration, prise en compte dans le score de santé et les notifications comme les autres documents.",
      "Nouveau : les documents recto/verso (carte d'identité, visite médicale permis, cartes personnalisées) demandent maintenant les deux faces séparément.",
      "Correction : les pastilles d'alerte de la jauge santé passent à la ligne au lieu d'être coupées sur les écrans étroits."
    ]
  },
  {
    version: "v1.4.8.1",
    date: "2026-08-17",
    changes: [
      "Nouveau : catalogue de véhicules élargi — bennes chantier TP et céréalières, citernes hydrocarbures, porte-chars, dolly, porteurs frigo… ton entreprise peut créer et utiliser bien plus de profils de véhicules, y compris ses propres profils personnalisés.",
      "Nouveau : option hayon, indépendante du type de véhicule — si ta remorque (ou ton porteur frigo) en est équipée, sa date d'entretien apparaît directement dans la carte Véhicules.",
      "Nouveau : les remorques frigo bi-température (surgelé + frais) l'indiquent directement sur la carte Entretien Groupe Frigo.",
      "Nouveau : l'entretien groupe frigo et le nettoyage intérieur sont désormais suivis aussi sur les porteurs frigo, pas seulement sur les remorques.",
      "Nouveau : trace permanente des entretiens frigo et nettoyage — ajoute une photo du papier d'entretien à chaque enregistrement (optionnelle mais conseillée) ; elle est conservée avec la date et consultable à tout moment via « Voir l'historique », en cas de contestation d'un client plusieurs mois après.",
      "Fiabilité : les données de ton véhicule se rafraîchissent désormais automatiquement au retour au premier plan de l'appli, même après une longue mise en arrière-plan — une date modifiée côté bureau pendant ce temps s'affiche sans avoir à recharger la page."
    ]
  },
  {
    version: "v1.4.8.0",
    date: "2026-08-15",
    changes: [
      "Nouveau : option citerne — pour les remorques citerne alimentaire, note le produit et le volume (en hectolitres) de chaque compartiment directement dans l'appli, plus besoin de l'ardoise sur la cuve.",
      "Nouveau : suivi de l'entretien du groupe frigo et du nettoyage intérieur pour les remorques frigorifiques, avec alerte sur le tableau de bord santé comme pour le CT ou l'assurance.",
      "Toutes les dates se saisissent maintenant avec un calendrier — fini le jj/mm/aaaa tapé à la main.",
      "Les modifications (dates, pneus, compartiments citerne) s'affichent désormais instantanément, sans avoir à recharger l'appli.",
      "Le nom de ton entreprise et le type de chaque remorque (citerne, frigo, porte-char…) sont maintenant affichés directement sur le tableau de bord."
    ]
  },
  {
    version: "v1.4.7.1",
    date: "2026-08-03",
    changes: [
      "Nouveau logo MémoTruck."
    ]
  },
  {
    version: "v1.4.7.0",
    date: "2026-08-03",
    changes: [
      "Nouveau : ajoute jusqu'à 3 photos à une intervention (photo prise directement ou choisie dans la galerie).",
      "Nouveau : la position est capturée automatiquement en signalant une panne, un entretien ou un accident, avec l'adresse réelle affichée (plus seulement des coordonnées).",
      "Nouveau : niveau d'urgence (routine / urgent) à indiquer en signalant une intervention à l'atelier.",
      "Nouveau : recherche et filtres (type, ce mois-ci) dans l'historique des interventions.",
      "Nouveau : le commentaire laissé par le mécanicien à la clôture d'une intervention est visible dans l'historique.",
      "Le mode hors-ligne est plus fiable : les interventions (et leurs photos) créées sans réseau sont désormais envoyées automatiquement dès le retour de la connexion, sans avoir besoin de recharger l'appli."
    ]
  },
  {
    version: "v1.4.6.11",
    date: "2026-08-03",
    changes: [
      "Le statut d'une intervention signalée à l'atelier (pris en charge, terminé) se met maintenant à jour en direct dans l'historique, sans avoir à quitter puis revenir sur l'écran."
    ]
  },
  {
    version: "v1.4.6.10",
    date: "2026-08-02",
    changes: [
      "Correction : tu ne reçois plus les alertes d'échéance (VGP, CT, assurance…) des engins BTP que tu n'utilises pas — uniquement celles de ton véhicule ou engin réellement affecté."
    ]
  },
  {
    version: "v1.4.6.9",
    date: "2026-08-02",
    changes: [
      "La case « Signaler à l'atelier » dans le formulaire de création d'intervention est maintenant une carte cliquable bien visible, avec une coche claire quand elle est activée."
    ]
  },
  {
    version: "v1.4.6.8",
    date: "2026-08-02",
    changes: [
      "Le bouton « Signaler à l'atelier » est plus visible dans l'historique."
    ]
  },
  {
    version: "v1.4.6.7",
    date: "2026-08-02",
    changes: [
      "Nouveau : coche « Signaler à l'atelier » directement dans le formulaire de création d'une intervention — plus besoin d'enregistrer puis d'aller dans l'historique pour prévenir l'atelier.",
      "L'historique affiche maintenant le nom du mécanicien qui a pris en charge ou terminé une intervention."
    ]
  },
  {
    version: "v1.4.6.6",
    date: "2026-08-02",
    changes: [
      "Nouveau bouton « Signaler à l'atelier » sur tes interventions : previens directement l'atelier qu'un camion a besoin d'une intervention, et suis son avancement (à faire, pris en charge, terminé) directement dans l'historique.",
      "Disponible pour les entreprises ayant activé le panel atelier — aucun changement pour les autres."
    ]
  },
  {
    version: "v1.4.6.5",
    date: "2026-07-29",
    changes: [
      "Fiabilisation du système de mise à jour : si tu loupes plusieurs mises à jour d'affilée, tu verras maintenant le détail de toutes les nouveautés manquées, pas juste la dernière.",
      "Le contenu affiché après une mise à jour est désormais garanti à jour, même si tu avais laissé l'appli ouverte pendant qu'une nouvelle version sortait."
    ]
  },
  {
    version: "v1.4.6.4",
    date: "2026-07-29",
    changes: [
      "Nouveau système de mise à jour automatique : dès qu'une nouvelle version de l'appli est disponible, une popup t'en informe avec le détail de ce qui a changé.",
      "Un seul bouton « Mettre à jour maintenant » suffit : l'appli se met à jour et se recharge toute seule, sans rien avoir à faire de plus.",
      "Fini le désinstaller/réinstaller : la mémoire (cache) de l'ancienne version est nettoyée automatiquement à chaque mise à jour, sur Android comme sur iOS.",
      "Un nouvel écran « Nouveautés » dans Paramètres te permet de revoir l'historique des mises à jour à tout moment."
    ]
  }
];
