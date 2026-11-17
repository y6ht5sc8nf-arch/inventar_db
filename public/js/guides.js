// Foto-Leitfäden pro Kategorie. req = Pflichtfoto.
// Die Slot-IDs der Bücher entsprechen denen des bisherigen Bücher-Artifacts (Übernahme in Phase 6).
export const CATEGORIES = [
  {
    id: "buch", label: "Buch", hint: "z. B. Goethe, Faust I", setable: false,
    slots: [
      { id: "cover", label: "Einband vorne", req: true },
      { id: "spine", label: "Buchrücken", req: true },
      { id: "title", label: "Titelblatt", req: true, tip: "Die Seite mit Titel, Autor und Verlag" },
      { id: "imprint", label: "Impressum", req: true, tip: "Meist die Rückseite des Titelblatts" },
      { id: "back", label: "Einband hinten", tip: "Hier ist oft der ISBN-Strichcode" },
      { id: "prov", label: "Exlibris / Stempel" },
      { id: "sign", label: "Widmung / Signatur" },
      { id: "colophon", label: "Kolophon", tip: "Druckvermerk am Buchende" },
      { id: "illus", label: "Illustration" },
      { id: "damage", label: "Schäden" },
    ],
  },
  {
    id: "porzellan", label: "Porzellan / Keramik", hint: "z. B. Kaffeeservice, Zwiebelmuster", setable: true,
    slots: [
      { id: "gesamt", label: "Gesamtansicht", req: true },
      { id: "boden_marke", label: "Boden mit Marke", req: true, tip: "Marke möglichst groß und scharf" },
      { id: "dekor", label: "Dekor nah" },
      { id: "schaeden", label: "Schäden" },
      { id: "set_uebersicht", label: "Set-Übersicht", tip: "Alle Teile zusammen" },
    ],
  },
  {
    id: "glas", label: "Glas", hint: "z. B. Weingläser, Vase", setable: true,
    slots: [
      { id: "gesamt", label: "Gesamtansicht", req: true },
      { id: "boden", label: "Boden", req: true },
      { id: "dekor", label: "Schliff / Dekor nah" },
      { id: "signatur", label: "Signatur" },
      { id: "schaeden", label: "Schäden" },
    ],
  },
  {
    id: "silber", label: "Besteck / Silber", hint: "z. B. Besteck für 12 Personen", setable: true,
    slots: [
      { id: "gesamt", label: "Gesamtansicht", req: true },
      { id: "punze", label: "Punzen nah", req: true, tip: "Stempel wie 800, 925, 90, 100 – ganz nah" },
      { id: "muster", label: "Muster nah" },
      { id: "monogramm", label: "Monogramm" },
      { id: "kasten", label: "Kasten" },
    ],
  },
  {
    id: "moebel", label: "Möbel", hint: "z. B. Biedermeier-Kommode", setable: false,
    slots: [
      { id: "front", label: "Front", req: true },
      { id: "seite", label: "Seite", req: true },
      { id: "rueckseite", label: "Rückseite", req: true },
      { id: "beschlaege", label: "Beschläge" },
      { id: "verbindung", label: "Schubladenverbindung" },
      { id: "etikett", label: "Marken / Etiketten" },
      { id: "schaeden", label: "Schäden" },
    ],
  },
  {
    id: "bild", label: "Bild / Grafik", hint: "z. B. Ölbild Landschaft", setable: false,
    slots: [
      { id: "vorderseite", label: "Vorderseite", req: true },
      { id: "rueckseite", label: "Rückseite", req: true },
      { id: "signatur", label: "Signatur nah" },
      { id: "etikett", label: "Etiketten" },
      { id: "rahmen", label: "Rahmen" },
      { id: "schaeden", label: "Schäden" },
    ],
  },
  {
    id: "schmuck", label: "Schmuck / Uhr", hint: "z. B. Damenarmbanduhr", setable: false,
    slots: [
      { id: "gesamt", label: "Gesamtansicht", req: true },
      { id: "punze", label: "Punzen / Marke", req: true },
      { id: "werk", label: "Werk (Uhr)" },
      { id: "verschluss", label: "Verschluss" },
      { id: "etui", label: "Etui" },
    ],
  },
  {
    id: "papiere", label: "Papiere / Fotos / Briefe", hint: "z. B. Feldpostbriefe 1916", setable: false,
    slots: [
      { id: "seite", label: "Beispielseite", req: true },
      { id: "seite_2", label: "Weitere Seite" },
      { id: "seite_3", label: "Weitere Seite" },
      { id: "umschlag", label: "Umschlag" },
      { id: "stempel", label: "Stempel" },
    ],
  },
  {
    id: "sonstiges", label: "Sonstiges", hint: "z. B. Nähmaschine", setable: false,
    slots: [
      { id: "gesamt", label: "Gesamtansicht", req: true },
      { id: "typenschild", label: "Typenschild" },
      { id: "schaeden", label: "Schäden" },
    ],
  },
];

export const QUICK = {
  id: "schnell", label: "Fach / Schublade", hint: "z. B. Besteckschublade",
  slots: [
    { id: "uebersicht_1", label: "Übersicht", req: true, tip: "Ganzes Fach von vorn, gut ausgeleuchtet" },
    { id: "uebersicht_2", label: "Übersicht 2", tip: "Anderer Winkel oder hintere Reihe" },
    { id: "uebersicht_3", label: "Übersicht 3" },
  ],
};

export function guideFor(mode) {
  return mode === "schnell" ? QUICK : CATEGORIES.find((c) => c.id === mode);
}

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? (id ? id : "Gemischt");
}

export const STATUS_LABEL = {
  erfasst: "erfasst",
  wartet_auf_auswertung: "wartet auf Auswertung",
  ausgewertet: "ausgewertet",
  marktgeprueft: "Markt geprüft",
  erledigt: "erledigt",
};

export const POSITION_SUGGESTIONS = [
  "Fach 1", "Fach 2", "Fach 3", "Fach 4", "Fach 5", "Fach 6",
  "Schublade 1", "Schublade 2", "Schublade 3", "Schublade 4",
  "oben", "unten", "links", "rechts", "Mitte",
];

export const CONTAINER_SUGGESTIONS = [
  "Schrank", "Vitrine", "Sideboard", "Kommode", "Regal", "Bücherregal", "Kiste", "Karton", "Nachttisch",
];
