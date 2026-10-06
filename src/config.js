// Settings you are likely to tweak while experimenting. Everything else reads from here.

// A "spike" = the HR chance is at least this many times the league average.
// Spikes make the meter glow/pulse and buzz the phone (Android only).
export const SPIKE_MULTIPLE = 2;

// How often the game screen asks MLB for fresh data (milliseconds). Keep it 5000-10000.
export const POLL_MS = 7000;

// Demo mode replays one plate appearance every this many milliseconds.
export const DEMO_STEP_MS = 4000;

// Safety cap so a weird input can never show an absurd chance.
export const MAX_PROBABILITY = 0.6;

export const MLB_API = "https://statsapi.mlb.com/api";
export const DEMO_GAME_FILE = "public/data/demo_game.json";
export const RATES_FILE = "public/data/rates.json";
export const VENUES_FILE = "public/data/venues.json";
export const TEAM_COLORS_FILE = "public/data/team-colors.json";
