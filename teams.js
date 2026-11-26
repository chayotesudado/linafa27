/*
 * Linafa 27 team data. Edit freely — add real squads here for your own use.
 *
 * Team fields:
 *   name, short (3 letters for the scoreboard)
 *   formation: "4-4-2" | "4-3-3" | "4-5-1" | "3-5-2" | "5-3-2"
 *   style: how the team plays (defaults to "balanced"):
 *     "positional"  short passes, wide wingers, swarm after losing it, high line. Weak to balls over the top.
 *     "gegenpress"  charge the ball the moment it's lost, then straight forward. Tires as each half goes on.
 *     "lowblock"    two deep, narrow lines and two forwards kept up; win it, go long, sprint. Gives away possession.
 *     "direct"      long balls to the forwards, crowd the knock-down, shoot from anywhere, centre-backs up for corners.
 *     "manmark"     everyone follows his man all over the pitch, lots of tackles. Beat one man and it falls apart.
 *     "flair"       crowd the ball, dribbles and tricks, sudden switches. The far side is left empty.
 *     The knobs behind each style are in STYLES in sim.js.
 *   kit / kit2 (away kit, used on a colour clash) / gkKit:
 *     { shirt, shorts, socks, stripes? }   (CSS colours; stripes = vertical stripe colour)
 *   players: 11 starters. The first "GK" listed goes in goal; the rest fill the
 *     formation slots in order: defenders left→right, then midfielders, then forwards.
 *
 * Player formats (mix as you like):
 *   ["Surname", "POS", rating]                         POS = GK | DF | MF | FW, rating 1-99
 *   { name: "Surname", pos: "FW", rating: 80, pace: 92, shooting: 85, passing: 70,
 *     tackling: 30, keeping: 10, number: 9 }           any stat overrides the one derived from rating
 */
window.TEAMS = [
  {
    name: "Zapote United", short: "ZAP", formation: "4-4-2", style: "gegenpress",
    kit:   { shirt: "#d0202a", shorts: "#ffffff", socks: "#d0202a" },
    kit2:  { shirt: "#f2f2f2", shorts: "#1a1a1a", socks: "#f2f2f2" },
    gkKit: { shirt: "#1fae4b", shorts: "#1a1a1a", socks: "#1fae4b" },
    players: [
      ["D. Marrow", "GK", 80],
      ["L. Okafor", "DF", 78], ["S. Brennan", "DF", 82], ["T. Vidal", "DF", 81], ["J. Harte", "DF", 77],
      ["R. Calloway", "MF", 80], ["M. Yildiz", "MF", 84], ["A. Petrov", "MF", 83], ["K. Asante", "MF", 81],
      ["J. Lindqvist", "FW", 85], ["E. Moreau", "FW", 83],
    ],
  },
  {
    name: "Atlético Turrubari", short: "ATB", formation: "4-3-3", style: "positional",
    kit:   { shirt: "#eeeeee", stripes: "#cc1e2e", shorts: "#1d3a8a", socks: "#cc1e2e" },
    kit2:  { shirt: "#2a2a2a", shorts: "#2a2a2a", socks: "#2a2a2a" },
    gkKit: { shirt: "#e85da8", shorts: "#1a1a1a", socks: "#e85da8" },
    players: [
      ["J. Arrieta", "GK", 84],
      ["M. Solano", "DF", 80], ["D. Ibáñez", "DF", 83], ["P. Quintero", "DF", 82], ["A. Lozano", "DF", 79],
      ["R. Olmedo", "MF", 85], ["S. Echeverría", "MF", 83], ["T. Barrios", "MF", 82],
      ["C. Medrano", "FW", 84], ["L. Arriaga", "FW", 86], ["H. Robledo", "FW", 81],
    ],
  },
  {
    name: "Barrio La Lona", short: "BLO", formation: "4-5-1", style: "lowblock",
    kit:   { shirt: "#f5c400", shorts: "#111111", socks: "#f5c400" },
    kit2:  { shirt: "#f4f4f4", shorts: "#111111", socks: "#f4f4f4" },
    gkKit: { shirt: "#2a6cd6", shorts: "#111111", socks: "#2a6cd6" },
    players: [
      ["K. Brandt", "GK", 79],
      ["J. Weiler", "DF", 77], ["N. Hofmann", "DF", 79], ["L. Vukas", "DF", 78], ["T. Ahlers", "DF", 76],
      ["F. Kessler", "MF", 78], ["M. Öztürk", "MF", 80], ["S. Lang", "MF", 81], ["P. Reinholt", "MF", 79], ["E. Sandberg", "MF", 77],
      ["R. Kowalczyk", "FW", 83],
    ],
  },
  {
    name: "Deportivo Puerto Vargas", short: "DPV", formation: "4-3-3", style: "flair",
    kit:   { shirt: "#6cb6e8", shorts: "#ffffff", socks: "#6cb6e8" },
    kit2:  { shirt: "#1b2a4a", shorts: "#1b2a4a", socks: "#1b2a4a" },
    gkKit: { shirt: "#f08a1c", shorts: "#1a1a1a", socks: "#f08a1c" },
    players: [
      ["P. Szymański", "GK", 77],
      ["C. Doherty", "DF", 75], ["H. Nakamura", "DF", 78], ["B. Adeyemi", "DF", 79], ["F. Rossi", "DF", 74],
      ["O. Grant", "MF", 77], ["I. Kovač", "MF", 80], ["N. Dube", "MF", 76],
      ["Z. Hallett", "FW", 78], ["V. Castro", "FW", 82], ["W. Pryce", "FW", 77],
    ],
  },
  {
    name: "Atletico Ciudad Colon", short: "ACC", formation: "3-5-2", style: "manmark",
    kit:   { shirt: "#eeeeee", stripes: "#1c8a46", shorts: "#1c8a46", socks: "#eeeeee" },
    kit2:  { shirt: "#1a1a1a", shorts: "#1a1a1a", socks: "#1a1a1a" },
    gkKit: { shirt: "#e5e52e", shorts: "#1a1a1a", socks: "#e5e52e" },
    players: [
      ["T. Carvalho", "GK", 74],
      ["R. Antunes", "DF", 73], ["D. Mendes", "DF", 75], ["J. Paiva", "DF", 72],
      ["N. Brito", "MF", 73], ["F. Correia", "MF", 86], ["A. Teixeira", "MF", 75], ["G. Lobo", "MF", 74], ["V. Sequeira", "MF", 72],
      ["P. Matias", "FW", 77], ["L. Bastos", "FW", 95],
    ],
  },
  {
    name: "Inter Hojancha", short: "HOJ", formation: "4-4-2", style: "direct",
    kit:   { shirt: "#1f4fbf", shorts: "#ffffff", socks: "#1f4fbf" },
    kit2:  { shirt: "#f2d22e", shorts: "#1f4fbf", socks: "#f2d22e" },
    gkKit: { shirt: "#8a8a8a", shorts: "#1a1a1a", socks: "#8a8a8a" },
    players: [
      ["G. Thorne", "GK", 72],
      ["A. McBride", "DF", 71], ["E. Svensson", "DF", 73], ["T. Ogunleye", "DF", 72], ["R. Finch", "DF", 69],
      ["S. Delaney", "MF", 72], ["M. Ferreira", "MF", 74], ["C. Whitlock", "MF", 81], ["D. Haas", "MF", 70],
      ["L. Quinn", "FW", 75], ["B. Mensah", "FW", 68],
    ],
  },
  {
    name: "Uruguay de Coronado", short: "URU", formation: "5-3-2", style: "lowblock",
    kit:   { shirt: "#1d2c6b", shorts: "#1d2c6b", socks: "#ffffff" },
    kit2:  { shirt: "#f07a1a", shorts: "#1d2c6b", socks: "#f07a1a" },
    gkKit: { shirt: "#c92a2a", shorts: "#1a1a1a", socks: "#c92a2a" },
    players: [
      ["V. Orlov", "GK", 71],
      ["I. Sokolov", "DF", 70], ["A. Morozov", "DF", 72], ["P. Zaitsev", "DF", 71], ["M. Belov", "DF", 70], ["D. Kuznetsov", "DF", 69],
      ["S. Volkov", "MF", 71], ["N. Popa", "MF", 70], ["G. Vasić", "MF", 72],
      ["Y. Hrytsenko", "FW", 73], ["B. Tamm", "FW", 70],
    ],
  },
  {
    name: "Ciudad Neily FC", short: "NEI", formation: "4-4-2", style: "direct",
    kit:   { shirt: "#7a1f3d", shorts: "#ffffff", socks: "#7a1f3d" },
    kit2:  { shirt: "#8fc7ea", shorts: "#7a1f3d", socks: "#8fc7ea" },
    gkKit: { shirt: "#222222", shorts: "#222222", socks: "#222222" },
    players: [
      ["O. Pemberton", "GK", 68],
      ["H. Ashby", "DF", 67], ["C. Rourke", "DF", 69], ["W. Ndlovu", "DF", 68], ["S. Kerr", "DF", 66],
      ["J. Fairley", "MF", 68], ["A. Moss", "MF", 70], ["E. Tran", "MF", 67], ["F. Holroyd", "MF", 68],
      ["N. Sutcliffe", "FW", 71], ["R. Aguda", "FW", 69],
    ],
  },
];
